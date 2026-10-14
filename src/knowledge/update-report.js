'use strict';
const crypto=require('crypto'),{extractPatchNotes}=require('./patch-notes');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const pointer=s=>String(s).replace(/~/g,'~0').replace(/\//g,'~1');
const knownDomains=new Set(['classes','monsters','maps','items','crafting','quests','systems']);
const capabilityMap={classes:['class','skills'],monsters:['boss','pets','combat'],maps:['travel'],items:['equipment','economy','cards'],crafting:['craft','refine','enchant'],quests:['quests'],systems:['party','guild','dungeon','tower','economy','premium']};
const sectionRules={html:{routes:/MAP_LINKS|FIELD_GATES|targetMap|worldMap/,investment:/refine|enchant|forge|EXCHANGE|weaponOpts|data-cardin/i,combat:/MONSTER_SKILLS|mskill|ground_aoe|cone_breath|castSkill|autoSkill/,quests:/QUEST|qIndex|qHave|questReward/,activities:/tower|dungeon|guild|Eclipse|AST_TOWER/i,patchNotes:/PATCH_NOTES/},world:{equipment:/EQUIPMENT|REFINE|FORGE|ARSENAL/,classes:/JOBS|HIGH_CLASSES|ASCEND|SKILLS/,monsters:/MONSTERS|MONSTER_SKILLS/,maps:/MAPS|REGIONS|GATES/},network:{transport:/WebSocket|onmessage|addEventListener|send\(/,protocol:/case\s*['"]|handlers|register|dispatch|NET\./,save:/save|revision|resave|delta/i}};
const count=()=>({added:0,removed:0,changed:0});
const addCounts=(a,b)=>{for(const k of Object.keys(a))a[k]+=b[k];};
const finiteLimit=(n,fallback,max)=>Number.isInteger(n)&&n>0?Math.min(n,max):fallback;
function preview(value,depth=0,budget={characters:1200}){
 if(budget.characters<=0)return {value:'[preview budget exhausted]',truncated:true};
 if(value===undefined)return {value:null,truncated:false};
 if(value===null||typeof value==='boolean'||typeof value==='number')return {value:Number.isFinite(value)||typeof value!=='number'?value:String(value),truncated:false};
 if(typeof value==='string'){const n=Math.min(400,budget.characters),truncated=value.length>n;budget.characters-=Math.min(n,value.length);return {value:truncated?value.slice(0,n)+'…':value,truncated};}
 if(typeof value!=='object')return {value:'[unsupported '+typeof value+']',truncated:true};
 if(depth>=2)return {value:{type:Array.isArray(value)?'array':'object',entries:Object.keys(value).length,previewOmitted:true},truncated:true};
 const keys=Object.keys(value),out=Array.isArray(value)?[]:Object.create(null);let truncated=keys.length>8;
 for(const k of keys.slice(0,8)){if(budget.characters<=0){truncated=true;break;}const key=k.length>80?k.slice(0,80)+'…':k;budget.characters-=key.length;const p=preview(value[k],depth+1,budget);out[key]=p.value;truncated||=p.truncated||key!==k;}
 return {value:out,truncated};
}
function stableIdentity(values){
 if(!values.length||values.length>10000||values.some(v=>!v||typeof v!=='object'||Array.isArray(v)))return null;
 for(const field of ['id','resultId','key','name','result']){const keys=values.map(v=>v[field]);if(keys.every(k=>typeof k==='string'&&k)&&new Set(keys).size===keys.length)return field;}
 return null;
}
function semantic(before,after,prefix,budget){
 const counts=count(),examples=[],beforeSeen=new WeakSet(),afterSeen=new WeakSet();let complete=true,visited=0,examplesOmitted=0;const errors=[];
 function record(kind,b,a,bp,ap){counts[kind]++;if(examples.length>=8||budget.examples>=budget.maxExamples||(bp?.length||0)>4096||(ap?.length||0)>4096){examplesOmitted++;return;}const bv=preview(b),av=preview(a);examples.push({kind,path:ap??bp,beforePath:bp??null,afterPath:ap??null,before:bv.value,after:av.value,beforeTruncated:bv.truncated,afterTruncated:av.truncated});budget.examples++;}
 function walk(b,a,bp,ap,depth=0){
  if(budget.nodes>=budget.maxNodes||depth>40){complete=false;return;}
  budget.nodes++;visited++;if(b===a)return;
  if(b===undefined){record('added',b,a,null,ap);return;}if(a===undefined){record('removed',b,a,bp,null);return;}
  const bo=b!==null&&typeof b==='object',ao=a!==null&&typeof a==='object';
  if(!bo||!ao||Array.isArray(b)!==Array.isArray(a)){record('changed',b,a,bp,ap);return;}
  if(beforeSeen.has(b)||afterSeen.has(a)){complete=false;errors.push('cyclic_or_shared_ancestor');return;}
  beforeSeen.add(b);afterSeen.add(a);
  try{
   if(Array.isArray(b)&&Array.isArray(a)){
    // Keep item identity through reorder, but retain exact old/new JSON pointers.
    const field=stableIdentity(b.length?b:a);const canMatch=field&&(!a.length||stableIdentity(a)===field)&&(!b.length||stableIdentity(b)===field);
    if(canMatch){const bm=new Map(b.map((v,i)=>[v[field],{v,i}])),am=new Map(a.map((v,i)=>[v[field],{v,i}]));for(const k of new Set([...bm.keys(),...am.keys()])){if(budget.nodes>=budget.maxNodes){complete=false;break;}const x=bm.get(k),y=am.get(k);walk(x?.v,y?.v,x?bp+'/'+x.i:null,y?ap+'/'+y.i:null,depth+1);}return;}
   }
   const keys=[...new Set([...Object.keys(b),...Object.keys(a)])].sort();
   for(const k of keys){if(budget.nodes>=budget.maxNodes){complete=false;break;}walk(Object.hasOwn(b,k)?b[k]:undefined,Object.hasOwn(a,k)?a[k]:undefined,bp+'/'+pointer(k),ap+'/'+pointer(k),depth+1);}
  }finally{beforeSeen.delete(b);afterSeen.delete(a);}
 }
 walk(before,after,prefix,prefix);
 return {counts,examples,coverage:{complete,visitedNodes:visited,countsAreLowerBounds:!complete,examplesTruncated:examplesOmitted>0,examplesOmitted},errors};
}
function wikiData(input){
 try{if(typeof input==='string'){if(input.length>8000000)return {status:'oversized'};input=JSON.parse(input);}if(!input||typeof input!=='object'||Array.isArray(input))return {status:input==null?'missing':'unsupported'};return {status:'available',data:input};}catch{return {status:'invalid_json'};}
}
function sourceChange(kind,before,after,baseline){
 const valid=s=>typeof s==='string'&&s.length>0&&s.length<=8000000;
 const bp=valid(before),ap=valid(after),beforeHash=bp?digest(before):null,afterHash=ap?digest(after):null;
 const status=!ap?typeof after==='string'&&after.length>8000000?'oversized':'missing':baseline?'baseline':!bp?'previous_missing':beforeHash===afterHash?'unchanged':'changed';
 const sections=[];if(bp&&ap){const bl=before.split('\n'),al=after.split('\n');for(const [name,rule]of Object.entries(sectionRules[kind])){const x=digest(bl.filter(l=>rule.test(l)).join('\n')),y=digest(al.filter(l=>rule.test(l)).join('\n'));sections.push({name,beforeHash:x,afterHash:y,changed:x!==y});}}
 return {status,beforeHash,afterHash,changed:status==='changed',beforeCharacters:typeof before==='string'?before.length:null,afterCharacters:typeof after==='string'?after.length:null,sections,unclassifiedChange:status==='changed'&&!sections.some(s=>s.changed),sectionCoverage:'keyword-line fingerprints are review hints; complete source hashes detect remaining changes',serverVerified:false};
}
function analyse({previous=null,current={},build=null,previousBuild=null}={},options={}){
 const baseline=!previous,currentData=current||{},old=previous||{},budget={nodes:0,examples:0,maxNodes:finiteLimit(options.maxNodes,50000,100000),maxExamples:finiteLimit(options.maxExamples,48,100)};
 const sources=Object.fromEntries(['html','world','network'].map(k=>[k,sourceChange(k,old[k],currentData[k],baseline)]));
 const p=wikiData(old.wiki),c=wikiData(currentData.wiki),domains=[],total=count();
 const names=[...new Set([...Object.keys(p.data||{}),...Object.keys(c.data||{})])].sort(),maxDomains=128;
 const comparable=c.status==='available'&&(baseline||p.status==='available');
 for(const name of names.slice(0,maxDomains)){
  let row;if(!comparable)row={counts:count(),examples:[],coverage:{complete:false,visitedNodes:0,countsAreLowerBounds:true,examplesTruncated:false,examplesOmitted:0},errors:['wiki_side_unavailable']};
  else if(baseline)row={counts:count(),examples:[],coverage:{complete:true,visitedNodes:0,countsAreLowerBounds:false,examplesTruncated:false,examplesOmitted:0},errors:[]};
  else row=semantic(Object.hasOwn(p.data,name)?p.data[name]:undefined,Object.hasOwn(c.data,name)?c.data[name]:undefined,'/wiki/'+pointer(name),budget);
  addCounts(total,row.counts);domains.push({domain:name,knownDomain:knownDomains.has(name),metadata:name==='_source',status:!comparable?'unavailable':baseline?'baseline':Object.values(row.counts).some(Boolean)?'changed':'unchanged',...row});
 }
 const wikiCoverage={status:!comparable?'unavailable':baseline?'baseline':'compared',previous:p.status,current:c.status,totalDomains:names.length,domainsCompared:comparable?domains.length:0,visitedNodes:budget.nodes,complete:comparable&&names.length<=maxDomains&&domains.every(d=>d.coverage.complete),truncated:names.length>maxDomains||domains.some(d=>!d.coverage.complete||d.coverage.examplesTruncated),omittedDomains:names.slice(maxDomains,maxDomains+12),omittedDomainCount:Math.max(0,names.length-maxDomains),countsAreLowerBounds:!comparable||names.length>maxDomains||domains.some(d=>!d.coverage.complete)};
 const wikiDiff={status:wikiCoverage.status,counts:total,domains,examples:domains.flatMap(d=>d.examples),coverage:wikiCoverage};
 const patchCurrent=extractPatchNotes(currentData.html),patchPrevious=baseline?null:extractPatchNotes(old.html);
 let patchDiff={counts:count(),examples:[],coverage:{complete:false,countsAreLowerBounds:true,examplesTruncated:false},errors:[]};
 if(patchCurrent.coverage.complete&&(baseline||patchPrevious?.coverage.complete))patchDiff=baseline?{...patchDiff,coverage:{complete:true,countsAreLowerBounds:false,examplesTruncated:false}}:semantic(patchPrevious.notes,patchCurrent.notes,'/patchNotes',{nodes:0,examples:0,maxNodes:10000,maxExamples:12});
 const patchNotes={status:patchDiff.coverage.complete?baseline?'baseline':'compared':'unavailable',current:patchCurrent,previous:patchPrevious,diff:patchDiff};
 const tasks=[],affected=new Set();
 function task(domain,capabilities,reason,checks){capabilities.forEach(x=>affected.add(x));tasks.push({id:digest(JSON.stringify([build,previousBuild,domain,reason])).slice(0,20),domain,capabilities,status:'review_required',reason,checks,automaticApproval:false});}
 for(const d of domains){if(d.metadata)continue;if(d.status==='changed'||d.status==='baseline')task('wiki:'+d.domain,capabilityMap[d.domain]||['unknown-domain'],d.knownDomain?'ตรวจข้อมูล '+d.domain+' ที่เพิ่ม/เปลี่ยน/ลบกับ client รุ่นนี้':'พบหมวดข้อมูลที่ยังไม่มีการเชื่อมกลไก: '+d.domain,['compare_exact_paths','verify_loaded_client_rules','test_adapter_and_resource_guards','confirm_actual_outcome']);}
 for(const [kind,s]of Object.entries(sources))if(s.status==='changed'||s.status==='previous_missing'||s.status==='missing'||s.status==='oversized')task('source:'+kind,kind==='network'?['network-protocol','party','trade','guild','tower']:kind==='world'?['class','equipment','craft','combat']:['client-ui','travel','craft','combat'],s.changed?'source hash เปลี่ยน; ตรวจ handler และส่วนที่จัดหมวดไม่ครบ':'ยังไม่มี source ครบสองฝั่งสำหรับตรวจ '+kind,['inspect_source_diff_without_execution','verify_protocol_or_handler','run_regression_tests','retain_existing_capability_gates']);
 if(!wikiCoverage.complete)task('coverage:wiki',['unknown-domain'],'การตรวจ Wiki ยังไม่ครบ ต้องอ่านข้อมูลที่ขาดก่อนรับรอง',['recover_missing_or_truncated_inputs','repeat_bounded_comparison']);
 if(!patchDiff.coverage.complete)task('coverage:patch-notes',['release-notes'],'ยังอ่านข่าวครบสองฝั่งไม่ได้',['inspect_literal_schema','preserve_last_successful_news']);
 if(Object.values(patchDiff.counts).some(Boolean))task('patch-notes',['release-notes'],'ข่าวเป็นคำประกาศ ต้องเทียบกับกฎและผลเกมก่อนเปิดความสามารถ',['map_announced_changes_to_rules','verify_runtime_visibility_gates','confirm_client_and_server_outcomes']);
 const sourceComplete=Object.values(sources).every(s=>['baseline','changed','unchanged'].includes(s.status));
 return {version:1,build,previousBuild,baseline,coverage:{complete:sourceComplete&&wikiCoverage.complete&&patchDiff.coverage.complete,sourceStatus:Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,s.status])),wiki:wikiCoverage,patchNotes:patchDiff.coverage},sourceChanges:sources,wikiDiff,patchNotes,affectedCapabilities:[...affected].sort(),reviewTasks:tasks,serverVerified:false,authorizesActions:false,limits:['Counts describe changed atomic JSON paths or added/removed subtrees, not a count of game features.','Source section fingerprints are hints, not semantic execution or proof of server behavior.','Patch note runtime conditions are recorded without evaluation.','Review tasks propose checks; they never grant an adapter or spending approval.']};
}
function summarize(report){
 if(!report||typeof report!=='object')return null;
 const shortExample=e=>{const b=preview(e.before,0,{characters:300}),a=preview(e.after,0,{characters:300});return {...e,before:b.value,after:a.value,beforeTruncated:e.beforeTruncated||b.truncated,afterTruncated:e.afterTruncated||a.truncated,...Object.fromEntries(['path','beforePath','afterPath'].map(k=>[k,typeof e[k]==='string'?e[k].slice(0,300):e[k]])),pathTruncated:['path','beforePath','afterPath'].some(k=>typeof e[k]==='string'&&e[k].length>300)};};
 let left=24;const domains=(report.wikiDiff?.domains||[]).map(d=>{const examples=(d.examples||[]).slice(0,Math.min(3,left)).map(shortExample);left-=examples.length;return {...d,domain:String(d.domain).slice(0,160),domainTruncated:String(d.domain).length>160,examples,coverage:{...d.coverage,examplesTruncated:d.coverage?.examplesTruncated||examples.length<(d.examples||[]).length}};});
 const noteSummary=side=>side?{...side,notes:(side.notes||[]).slice(0,3).map(n=>({id:String(n.id).slice(0,100),date:typeof n.date==='string'?n.date.slice(0,100):null,title:String(n.title).slice(0,220),sub:typeof n.sub==='string'?n.sub.slice(0,300):null,launch:n.launch===true,items:(n.items||[]).slice(0,3).map(i=>({t:String(i.t).slice(0,180),d:String(i.d).slice(0,400),runtimeGateUnevaluated:!!i.when}))})),detailsTruncated:(side.notes||[]).length>3||(side.notes||[]).some(n=>n.items?.length>3)}:null;
 return {...report,detailsTruncated:true,summaryScope:'bounded runtime view; full archived report contains remaining details',reviewTasks:(report.reviewTasks||[]).slice(0,12).map(t=>({...t,domain:String(t.domain).slice(0,180),reason:String(t.reason).slice(0,400)})),reviewTaskCount:report.reviewTasks?.length||0,wikiDiff:{...report.wikiDiff,domains,examples:domains.flatMap(d=>d.examples),detailsTruncated:true},patchNotes:{...report.patchNotes,current:noteSummary(report.patchNotes?.current),previous:noteSummary(report.patchNotes?.previous),diff:{...report.patchNotes?.diff,examples:(report.patchNotes?.diff?.examples||[]).slice(0,5).map(shortExample),detailsTruncated:true}}};
}
module.exports={analyse,summarize};
