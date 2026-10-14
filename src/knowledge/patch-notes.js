'use strict';

// Parse only data syntax. The downloaded client is never evaluated, even in a VM.
function declaration(source){
 let best=null;
 for(let i=0;i<source.length;i++){
  const ch=source[i],next=source[i+1];
  if(ch==='/'&&next==='/'){const end=source.indexOf('\n',i+2);i=end<0?source.length:end;continue;}
  if(ch==='/'&&next==='*'){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+1;continue;}
  if(ch==='/'&&(/[=(:,\[!&|?{};]\s*$/.test(source.slice(Math.max(0,i-80),i))||/\b(?:return|throw|case|typeof|void|delete|yield)\s*$/.test(source.slice(Math.max(0,i-80),i)))){let bracket=false;for(i++;i<source.length;i++){if(source[i]==='\\'){i++;continue;}if(source[i]==='[')bracket=true;if(source[i]===']')bracket=false;if(source[i]==='/'&&!bracket)break;if(source[i]==='\n')break;}continue;}
  if(ch==='\''||ch==='"'||ch==='`'){const quote=ch;for(i++;i<source.length;i++){if(source[i]==='\\'){i++;continue;}if(source[i]===quote)break;}continue;}
  if(ch!=='c'||i>0&&/[\w$]/.test(source[i-1]))continue;
  const m=/^const\s+(PATCH_NOTES_ALL|PATCH_NOTES)\s*=\s*/.exec(source.slice(i,i+100));
  if(!m)continue;
  const found={name:m[1],start:i+m[0].length};
  if(m[1]==='PATCH_NOTES_ALL')return found;
  if(!best)best=found;
 }
 return best;
}
function literal(source,{maxNodes=30000,maxDepth=32}={}){
 let at=0,nodes=0,runtimeGates=0;
 const error=m=>{const e=new Error(m+' at character '+at);e.code='unsupported_literal';e.offset=at;throw e;};
 function space(){for(;;){while(/\s/.test(source[at]||'')&&at<source.length)at++;if(source.slice(at,at+2)==='//'){const n=source.indexOf('\n',at+2);at=n<0?source.length:n;continue;}if(source.slice(at,at+2)==='/*'){const n=source.indexOf('*/',at+2);if(n<0)error('Unterminated comment');at=n+2;continue;}break;}}
 function string(){const quote=source[at++];let value='';while(at<source.length){const c=source[at++];if(c===quote)return value;if(c==='\n'||c==='\r')error('Unescaped newline');if(c!=='\\'){value+=c;continue;}const e=source[at++],simple={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0','\\':'\\',"'":"'",'"':'"','/':'/'};if(Object.hasOwn(simple,e)){if(e==='0'&&/[0-9]/.test(source[at]||''))error('Octal escape');value+=simple[e];}else if(e==='\n'){}else if(e==='\r'){if(source[at]==='\n')at++;}else if(e==='x'||e==='u'){let width=e==='x'?2:4,hex;if(e==='u'&&source[at]==='{'){const end=source.indexOf('}',++at);hex=end<0?'':source.slice(at,end);if(!/^[\da-f]{1,6}$/i.test(hex)||parseInt(hex,16)>0x10ffff)error('Unicode escape');at=end+1;}else{hex=source.slice(at,at+width);if(!new RegExp('^[\\da-f]{'+width+'}$','i').test(hex))error('String escape');at+=width;}value+=String.fromCodePoint(parseInt(hex,16));}else error('Unsupported string escape');}error('Unterminated string');}
 function value(depth=0){space();if(++nodes>maxNodes||depth>maxDepth)error('Literal complexity limit');const c=source[at];
  if(c==='\''||c==='"')return string();
  if(c==='['){at++;const out=[];space();if(source[at]===']'){at++;return out;}for(;;){out.push(value(depth+1));space();if(source[at]===']'){at++;return out;}if(source[at++]!==',')error('Array separator');space();if(source[at]===']'){at++;return out;}}}
  if(c==='{'){at++;const out=Object.create(null);space();if(source[at]==='}'){at++;return out;}for(;;){space();let key;if(source[at]==='\''||source[at]==='"')key=string();else{const m=/^[A-Za-z_$][\w$]*/.exec(source.slice(at));if(!m)error('Literal object key');key=m[0];at+=key.length;}if(Object.hasOwn(out,key))error('Duplicate object key');space();if(source[at++]!==':')error('Object colon');space();const gate=key==='when'&&/^\(\s*\)\s*=>\s*!!\s*(AsteriaWorld(?:\??\.[A-Za-z_$][\w$]*)+)\s*(?=[,}])/.exec(source.slice(at));if(gate){out[key]={kind:'runtime_visibility_gate',expression:gate[0].trim(),evaluated:false};at+=gate[0].length;runtimeGates++;}else out[key]=value(depth+1);space();if(source[at]==='}'){at++;return out;}if(source[at++]!==',')error('Object separator');space();if(source[at]==='}'){at++;return out;}}}
  const number=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at));if(number){at+=number[0].length;const n=Number(number[0]);if(!Number.isFinite(n))error('Non-finite number');return n;}
  for(const [name,v]of [['true',true],['false',false],['null',null]])if(source.slice(at,at+name.length)===name&&!/[\w$]/.test(source[at+name.length]||'')){at+=name.length;return v;}
  if(source.slice(at,at+3)==='__L'&&!/[\w$]/.test(source[at+3]||'')){
   at+=3;space();
   if(source[at]==='`'){
    at++;let text='';
    while(at<source.length){const ch=source[at++];if(ch==='`')return text;
     if(ch==='$'&&source[at]==='{')error('Dynamic localization template');
     if(ch!=='\\'){text+=ch;continue;}
     const escaped=source[at++],escapes={n:'\n',r:'\r',t:'\t','`':'`','\\':'\\','$':'$'};
     if(!Object.hasOwn(escapes,escaped))error('Unsupported localization template escape');
     text+=escapes[escaped];
    }
    error('Unterminated localization template');
   }
   if(source[at++]!=='(')error('Localization call');space();if(!['\'','"'].includes(source[at]))error('Localization requires one literal string');const v=string();space();if(source[at++]!==')')error('Localization requires one literal string');return v;
  }
  error('Expression is not data syntax');
 }
 const data=value();space();if(source[at]!==';')error('Literal declaration must end with semicolon');
 return {data,characters:at+1,nodes,runtimeGates};
}
function extractPatchNotes(html,{maxNotes=1000,maxCharacters=1000000}={}){
 const out={status:'missing',declaration:null,notes:[],coverage:{complete:false,notesParsed:0,notesReturned:0,truncated:false,inputCharacters:typeof html==='string'?html.length:0,parsedCharacters:0},errors:[]};
 if(typeof html!=='string'){out.errors.push({code:'missing_source',message:'Client HTML is unavailable'});return out;}
 if(html.length>8000000){out.status='truncated';out.coverage.truncated=true;out.errors.push({code:'source_limit',message:'Client exceeds 8000000 characters'});return out;}
 maxNotes=Number.isInteger(maxNotes)&&maxNotes>0?Math.min(1000,maxNotes):100;
 maxCharacters=Number.isInteger(maxCharacters)&&maxCharacters>0?Math.min(1000000,maxCharacters):200000;
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m=>m[1]);
 const candidates=(scripts.length?scripts:[html]).map(source=>({source,found:declaration(source)})).filter(x=>x.found).sort((a,b)=>Number(b.found.name==='PATCH_NOTES_ALL')-Number(a.found.name==='PATCH_NOTES_ALL'));
 if(!candidates.length){out.errors.push({code:'missing_declaration',message:'PATCH_NOTES literal declaration not found'});return out;}
 const {source,found}=candidates[0];out.declaration=found.name;
 try{
  const parsed=literal(source.slice(found.start,found.start+maxCharacters));out.coverage.parsedCharacters=parsed.characters;out.coverage.runtimeGates=parsed.runtimeGates;out.coverage.runtimeVisibilityVerified=false;
  if(!Array.isArray(parsed.data)||parsed.data.some(n=>!n||typeof n!=='object'||Array.isArray(n)||typeof n.id!=='string'||!n.id||typeof n.title!=='string'||!Array.isArray(n.items)||n.items.some(x=>!x||typeof x!=='object'||typeof x.t!=='string'||typeof x.d!=='string')))throw Object.assign(Error('Unsupported patch note schema'),{code:'unknown_note_schema'});
  if(new Set(parsed.data.map(n=>n.id)).size!==parsed.data.length)throw Object.assign(Error('Duplicate patch note IDs'),{code:'duplicate_note_id'});
  out.coverage.notesParsed=parsed.data.length;out.notes=parsed.data.slice(0,maxNotes);out.coverage.notesReturned=out.notes.length;out.coverage.truncated=parsed.data.length>maxNotes;out.coverage.complete=!out.coverage.truncated;out.status=out.coverage.complete?'parsed':'truncated';
  out.scope=found.name==='PATCH_NOTES_ALL'?'authored notes including launch-gated entries; runtime visibility was not evaluated':'authored literal notes; runtime visibility was not evaluated';
 }catch(e){out.status='unsupported';out.coverage.parsedCharacters=e.offset||0;out.errors.push({code:e.code||'parse_error',message:String(e.message).slice(0,180)});if(e.offset>=maxCharacters-1&&source.length-found.start>maxCharacters){out.status='truncated';out.coverage.truncated=true;out.errors.push({code:'literal_window_limit',message:'Parser window bounded to '+maxCharacters+' characters'});}}
 return out;
}
module.exports={extractPatchNotes};
