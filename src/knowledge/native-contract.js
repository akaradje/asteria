'use strict';
// Approve behavior, not a list of release hashes. Source hashes remain useful
// for integrity/identity; they never substitute for these transaction guards.
const acorn=require('acorn'),crypto=require('node:crypto');
const fingerprint=n=>crypto.createHash('sha256').update(JSON.stringify(clean(n))).digest('hex');
function clean(n){if(Array.isArray(n))return n.map(clean);if(!n||typeof n!=='object')return n;return Object.fromEntries(Object.entries(n).filter(([k])=>!['start','end','loc','raw'].includes(k)).map(([k,v])=>[k,clean(v)]));}
function walk(n,fn,anc=[]){if(!n||typeof n!=='object')return;if(n.type)fn(n,anc);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(x=>walk(x,fn,[...anc,n]));else if(v&&typeof v==='object')walk(v,fn,[...anc,n]);}}
function member(n){if(n?.type==='ChainExpression')return member(n.expression);if(n?.type==='Identifier')return n.name;if(n?.type==='MemberExpression'){const k=n.computed?n.property.type==='Literal'?String(n.property.value):'?':n.property.name;return member(n.object)+'.'+k;}return null;}
function calls(n,name){const out=[];walk(n,x=>{if(x.type==='CallExpression'&&member(x.callee)===name)out.push(x)});return out;}
function ids(n){const out=new Set();walk(n,x=>{if(x.type==='Identifier')out.add(x.name)});return out;}
function ret(n){let yes=false;walk(n,x=>{if(x.type==='ReturnStatement')yes=true});return yes;}
function functions(text){
 const result=new Map(),scripts=[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/(?:application\/json|application\/ld\+json)/i.test(m[1])).map(m=>m[2]);
 if(!scripts.length)scripts.push(text);
 for(const source of scripts){if(!source.trim())continue;const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script'});walk(ast,n=>{if(n.type==='FunctionDeclaration'&&n.id){const list=result.get(n.id.name)||[];list.push(n);result.set(n.id.name,list)}});}
 return result;
}
const parsed=new Map();
function contractFunctions(text,digest){
 if(parsed.has(digest))return parsed.get(digest);
 const wanted=new Set(['mkSend','marketMessage','forgeSend','renderRefineMain','forgeMessage','forgeConfirm','recipeReady','recipeOut','takeCost','renderExchangeMain','exGoHTML','gachaBind','achBind','mailTake','giftReceived','doEnchant','astralMessage','renderRefineShop']);
 const map=new Map(),scripts=[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/(?:application\/json|application\/ld\+json)/i.test(m[1])).map(m=>m[2]);if(!scripts.length)scripts.push(text);
 for(const source of scripts){if(!source.trim())continue;const tree=acorn.parse(source,{ecmaVersion:'latest'});walk(tree,(n,a)=>{if(n.type==='CallExpression'&&['forgeSend','NET.social'].includes(member(n.callee))&&['rfup','gsbuy','rfbuy'].includes(n.arguments[0]?.value)){const rows=map.get('__paidSites')||[];rows.push(n);map.set('__paidSites',rows);}
 if(n.type==='FunctionDeclaration'&&wanted.has(n.id?.name)){const rows=map.get(n.id.name)||[];rows.push(n);map.set(n.id.name,rows);}if(n.type==='CallExpression'&&member(n.callee)==='NET.social'&&['aspt','asbt'].includes(n.arguments[0]?.value)){const outer=a.filter(x=>['ArrowFunctionExpression','FunctionExpression'].includes(x.type)).findLast(x=>rejects(x,t=>unary(t,'NET.online'),n.start));const rows=map.get('__astralHandlers')||[];rows.push({n,anc:a.filter(x=>x!==tree&&!['Program','BlockStatement'].includes(x.type)&&x.type!=='FunctionDeclaration'&&(x.type!=='FunctionExpression'||x.params.length>0)),outer});map.set('__astralHandlers',rows);}});}
 if(parsed.size>=2)parsed.clear();parsed.set(digest,map);return map;
}
function unique(map,name){const list=map.get(name)||[];if(list.length!==1)throw Error('native contract function missing/ambiguous: '+name);return list[0];}
function rejects(fn,required,before=Infinity){let ok=false;walk(fn,n=>{if(n.type==='IfStatement'&&n.end<before&&ret(n.consequent)&&required(n.test))ok=true});return ok;}
function unary(n,value){return n?.type==='UnaryExpression'&&n.operator==='!'&&member(n.argument)===value;}
function binary(n,a,op,b){return n?.type==='BinaryExpression'&&n.operator===op&&member(n.left)===a&&member(n.right)===b;}
function disjunction(n){return n?.type==='LogicalExpression'&&n.operator==='||'?[...disjunction(n.left),...disjunction(n.right)]:[n];}
function safeExecution(n){
 const forbidden=new Set(['eval','Function','fetch','XMLHttpRequest','WebSocket','require','import','process','globalThis']);
 walk(n,x=>{if(x.type==='ImportExpression'||x.type==='NewExpression'&&forbidden.has(member(x.callee))||x.type==='CallExpression'&&forbidden.has(member(x.callee)))throw Error('unexpected native transaction execution');if(x.type==='MemberExpression'&&['constructor','__proto__','prototype'].includes(x.computed?String(x.property.value):x.property.name))throw Error('native transaction prototype escape');});
}
function transport(map){
 const f=unique(map,'forgeSend');safeExecution(f);walk(f,n=>{if(n.type==='AssignmentExpression'&&(['t','data'].includes(member(n.left))||String(member(n.left)).startsWith('data.'))||n.type==='UpdateExpression'&&String(member(n.argument)).startsWith('data.'))throw Error('native dispatch payload must not be rewritten');});const sends=calls(f,'NET.social'),flush=calls(f,'NET.flush'),save=calls(f,'saveGame');
 if(!f.async||sends.length!==1||sends[0].arguments.map(member).join(',')!=='t,data'||!flush.length||!save.length||save[0].start>flush[0].start||flush[0].start>sends[0].start)throw Error('native save/flush/single server dispatch contract changed');
 if(!rejects(f,t=>member(t)==='forgeBusy',sends[0].start)||!rejects(f,t=>unary(t,'NET.online'),sends[0].start))throw Error('native online/busy fence missing');
 let armed=false,awaited=false;walk(f,(n,a)=>{if(n.type==='AssignmentExpression'&&member(n.left)==='forgeBusy'&&n.right.type==='Literal'&&n.right.value===true&&n.start<sends[0].start)armed=true;if(n===flush[0]&&a.some(x=>x.type==='AwaitExpression'))awaited=true;});
 if(!armed||!awaited)throw Error('native serialized awaited dispatch required');
 return f;
}
function refine(map){
 transport(map);const f=unique(map,'renderRefineMain');safeExecution(f);if(!calls(f,'R.ore').length||!calls(f,'refineCost').length||!calls(f,'R.need').length)throw Error('native ore/cost/need binding changed');const sends=calls(f,'forgeSend').filter(n=>n.arguments[0]?.value==='rfup');
 if(sends.length!==1)throw Error('native one-refine dispatch required');
 const send=sends[0];let handler;
 walk(f,(n,anc)=>{if(n===send)handler=anc.findLast(x=>x.type==='ArrowFunctionExpression'||x.type==='FunctionExpression')});
 if(!handler||!rejects(handler,t=>{const ors=disjunction(t);return ors.some(n=>binary(n,'lv','>=','RMAX'))&&ors.some(n=>n.type==='UnaryExpression'&&n.operator==='!'&&calls(n,'wornKey').length)&&ors.some(n=>binary(n,'player.coins','<','cost'))&&ors.some(n=>n.type==='BinaryExpression'&&n.operator==='<'&&member(n.right)==='need'&&ids(n.left).has('player'))},send.start))throw Error('native equipped/cap/budget/ore guards changed');
 const high=ids(handler).has('high');let guardPayload=false;walk(send.arguments[1],n=>{if(n.type==='ConditionalExpression'&&member(n.test)==='guard'&&n.consequent.type==='ObjectExpression'&&n.consequent.properties.some(p=>p.key.name==='guard'&&[1,true].includes(p.value.value)))guardPayload=true;});if(ids(handler).has('refGuard')&&!guardPayload)throw Error('native Guardian protection payload changed');if(high&&!rejects(handler,t=>unary(t,'NET.online'),send.start))throw Error('high refine online-only guard missing');
 const reply=unique(map,'forgeMessage');safeExecution(reply);if(calls(reply,'NET.social').some(n=>n.arguments[0]?.value!=='scq'||n.arguments[1]?.type!=='ObjectExpression'||n.arguments[1].properties.length!==0)||calls(reply,'forgeSend').length)throw Error('native reply cannot replay a transaction');if((map.get('__paidSites')||[]).some(n=>member(n.callee)==='NET.social')||(map.get('__paidSites')||[]).filter(n=>n.arguments[0].value==='rfup').length!==1)throw Error('unexpected extra native paid dispatch');if(!calls(reply,'applyDelta').length||!calls(reply,'NET.setRev').length)throw Error('native forge delta/revision acknowledgement missing');
 const payload=send.arguments[1];if(payload?.type!=='CallExpression'||member(payload.callee)!=='Object.assign'||payload.arguments[0]?.type!=='ObjectExpression'||!payload.arguments[0].properties.some(p=>p.key.name==='id'&&member(p.value)==='id'))throw Error('refine payload identity changed');
 let confirmation=null;if(high){const confirm=unique(map,'forgeConfirm');let minimumMs,maximumMs;walk(confirm,n=>{if(n.type==='BinaryExpression'&&n.left.type==='BinaryExpression'&&n.left.operator==='-'&&member(n.left.left)==='now'&&member(n.left.right)==='forgeArmAt'&&n.right.type==='Literal'){if(n.operator==='>=')minimumMs=n.right.value;if(n.operator==='<')maximumMs=n.right.value;}});if(!Number.isFinite(minimumMs)||minimumMs<0||!Number.isFinite(maximumMs)||maximumMs<=minimumMs)throw Error('native confirmation window unknown');const timer=calls(unique(map,'forgeSend'),'setTimeout').map(c=>c.arguments[1]?.value).filter(Number.isFinite);if(!timer.some(ms=>ms>maximumMs))throw Error('native busy fence must outlive destructive confirmation window');let consumed=false;walk(confirm,n=>{if(n.type==='IfStatement'&&ids(n.test).has('forgeArm')&&ids(n.test).has('key')){let cleared=false,success=false;walk(n.consequent,x=>{if(x.type==='AssignmentExpression'&&member(x.left)==='forgeArm'&&x.right.type==='Literal'&&[null,false,0].includes(x.right.value))cleared=true;if(x.type==='ReturnStatement'&&x.argument?.value===true)success=true;});if(cleared&&success)consumed=true;}});if(!consumed)throw Error('native confirmation must consume its arm before dispatch');confirmation={minimumMs,maximumMs};}
 const shop=(map.get('renderRefineMain')||[])[0],supplyCommands=[];if(shop){const gs=calls(shop,'forgeSend').filter(n=>n.arguments[0]?.value==='gsbuy'),sb=calls(shop,'forgeSend').filter(n=>n.arguments[0]?.value==='rfbuy');if(gs.length===1&&gs[0].arguments[1]?.type==='ObjectExpression'&&gs[0].arguments[1].properties.length===0&&calls(shop,'forgeConfirm').some(n=>n.arguments[0]?.value==='gsbuy'))supplyCommands.push('guardian');if(sb.length===1&&sb[0].arguments[1]?.properties?.length===1&&sb[0].arguments[1]?.type==='ObjectExpression'&&sb[0].arguments[1].properties.some(p=>p.key.name==='via'&&p.value.name==='via'))supplyCommands.push('star');}
 return {supplyCommands,destructiveHigh:high,guardSupported:ids(handler).has('refGuard'),twoTap:calls(handler,'forgeConfirm').length>0,confirmation};
}
function craft(map){
 const ready=unique(map,'recipeReady'),out=unique(map,'recipeOut'),pay=unique(map,'takeCost'),render=unique(map,'renderExchangeMain');[ready,out,pay,render].forEach(safeExecution);
 if(ready.body.body.length!==1||ready.body.body[0].type!=='ReturnStatement')throw Error('native readiness cannot bypass its availability expression');
 walk(pay,n=>{if(n.type==='AssignmentExpression'&&['player.coins','player.tokens','player.leaves'].includes(member(n.left))&&(n.operator!=='-='||member(n.right)!=='n'))throw Error('native exact wallet debit changed');if(n.type==='AssignmentExpression'&&member(n.left)==='player.materials.?'&&(n.operator!=='='||n.right.type!=='BinaryExpression'||n.right.operator!=='-'||member(n.right.right)!=='n'))throw Error('native exact material debit changed');});
 let level=false,quantity=false,space=false;walk(ready,n=>{if(binary(n,'player.lv','>=','r.reqLv'))level=true;if(n.type==='BinaryExpression'&&n.operator==='>='&&member(n.right)==='n'&&calls(n.left,'haveOf').some(c=>c.arguments.map(member).join(',')==='k'))quantity=true;if(n.type==='BinaryExpression'&&n.operator==='<'&&member(n.left)==='bag.length'&&calls(n.right,'bagMax').length)space=true;});
 if(!level||!quantity||!space||!calls(ready,'Object.entries').some(c=>member(c.arguments[0])==='r.cost'))throw Error('native recipe availability/level/space contract missing');
 let handler;walk(render,(n,anc)=>{if(n.type==='CallExpression'&&member(n.callee)==='takeCost')handler=anc.findLast(x=>x.type==='ArrowFunctionExpression'||x.type==='FunctionExpression')});
 if(!handler||!rejects(handler,t=>t.type==='UnaryExpression'&&t.operator==='!'&&calls(t,'recipeReady').length,calls(handler,'takeCost')[0]?.start))throw Error('native exact recipe readiness before cost required');
 const payments=calls(handler,'takeCost'),gives=calls(handler,'o.give'),flushes=calls(handler,'NET.flush');
 let costLoop;walk(handler,n=>{if(n.type==='ForOfStatement'&&calls(n.right,'Object.entries').some(c=>member(c.arguments[0])==='r.cost')&&calls(n.body,'takeCost').length)costLoop=n;});
 const pair=costLoop?.left?.declarations?.[0]?.id?.elements?.map(member);
 if(payments.length!==1||calls(render,'takeCost').length!==1||calls(render,'o.give').length!==1||!pair||pair.length!==2||payments[0].arguments.map(member).join(',')!==pair.join(',')||gives.length!==1||!flushes.length||payments.some(p=>p.start>gives[0].start)||gives[0].start>flushes[0].start)throw Error('native single cost/output/flush ordering changed');
 let boundedBatch=false;const loops=[];walk(handler,n=>{if(['WhileStatement','ForStatement'].includes(n.type))loops.push(n);});
 if(loops.length){
  const vars=new Map();walk(handler,n=>{if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')vars.set(n.id.name,n.init);});
  const expr=s=>acorn.parseExpressionAt(s,0,{ecmaVersion:'latest'}),equal=(n,s)=>n&&fingerprint(n)===fingerprint(expr(s));
  const outer=loops.find(n=>n.type==='WhileStatement'),unit=loops.find(n=>n.type==='ForStatement');
  if(loops.length!==2||!equal(vars.get('want'),'Math.max(1, Math.min(exMax(r, o0), exQty[idx] || 1))')||!equal(vars.get('batch'),'!o0.gear && pveSrv')||!equal(vars.get('n'),'batch ? Math.min(want - done, exMax(r, o)) : 1')||!equal(vars.get('done'),'0')||!equal(outer?.test,'done < want')||!equal(unit?.test,'k < n')||!equal(unit?.update,'k++')||unit?.init?.declarations?.[0]?.id.name!=='k'||!equal(unit?.init?.declarations?.[0]?.init,'0')||!(unit.start<costLoop.start&&costLoop.end<gives[0].start&&gives[0].end<unit.end))throw Error('native batch must retain bounded unit cost/output loop');
  let increment=false,reset=false;walk(handler,n=>{if(n.type==='AssignmentExpression'&&member(n.left)==='done'&&n.operator==='+='&&member(n.right)==='n'&&n.start>unit.end&&n.end<flushes[0].start)increment=true;if(n.type==='AssignmentExpression'&&member(n.left)==='exQty.?'&&n.right.value===1)reset=true;});
  if(!increment||!reset||!rejects(handler,t=>unary(t,'recipeReady')||t.type==='UnaryExpression'&&calls(t,'recipeReady').length,payments[0].start))throw Error('native bounded queue progress/reset/readiness required');boundedBatch=true;
  walk(handler,n=>{if(n.type==='AssignmentExpression'&&['want','n','batch','idx','r'].includes(member(n.left))||n.type==='UpdateExpression'&&['want','n','batch','idx','r','done'].includes(member(n.argument)))throw Error('native queue bound/recipe cannot be rewritten');if(n.type==='AssignmentExpression'&&member(n.left)==='done'&&(n.operator!=='+='||member(n.right)!=='n'))throw Error('native queue progress changed');});
  const go=unique(map,'exGoHTML'),uiVars=new Map();safeExecution(go);walk(go,n=>{if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')uiVars.set(n.id.name,n.init);});const qty=uiVars.get('qty');
  if(!equal(uiVars.get('max'),'ready ? exMax(r, o) : 0')||qty?.type!=='ConditionalExpression'||!equal(qty.test,'max > 1')||qty.alternate.value!==''||qty.consequent.type!=='TemplateLiteral'||!qty.consequent.quasis.some(q=>q.value.raw.includes('data-exq'))||!qty.consequent.quasis.some(q=>q.value.raw.includes('type="number"')))throw Error('native quantity picker must exist whenever more than one exchange is possible');
  let setter,quantityChanged=false;walk(render,n=>{if(n.type==='VariableDeclarator'&&n.id.name==='set'&&n.init?.type==='ArrowFunctionExpression'&&ids(n.init).has('exQty'))setter=n.init;if(n.type==='CallExpression'&&member(n.callee)==='inp.addEventListener'&&n.arguments[0]?.value==='change'&&calls(n.arguments[1],'set').some(c=>member(c.arguments[0])==='inp.value'))quantityChanged=true;});
  let writesQuantity=false,writesInput=false;walk(setter,n=>{if(n.type==='AssignmentExpression'&&equal(n.left,'exQty[i]')&&equal(n.right,'Math.max(1, Math.min(max, Math.floor(+v) || 1))'))writesQuantity=true;if(n.type==='AssignmentExpression'&&member(n.left)==='inp.value'&&equal(n.right,'exQty[i]'))writesInput=true;});
  if(!quantityChanged||!writesQuantity||!writesInput)throw Error('native quantity change must bind the clamped request and displayed value');
 }
 let busy=false;walk(handler,n=>{if(n.type==='AssignmentExpression'&&member(n.left)==='exBusy'&&n.right.value===true&&n.start<payments[0].start)busy=true;});if(!busy||!rejects(handler,t=>member(t)==='exBusy'))throw Error('native exchange serialization missing');
 if(!calls(out,'giveItem').length)throw Error('native gear output unavailable');
 return {exactRecipe:true,capacityBeforePayment:true,singleQuantityRequired:boundedBatch};
}
function rewards(map){
 for(const name of ['gachaBind','achBind','mailTake','giftReceived'])safeExecution(unique(map,name));
 const mail=unique(map,'mailTake'),gacha=unique(map,'gachaBind'),ach=unique(map,'achBind'),gift=unique(map,'giftReceived');
 if(!mail.async||!rejects(mail,t=>member(t)==='mailBusy')||calls(mail,'NET.social').length!==1||member(calls(mail,'NET.social')[0].arguments[0])!=='t'||!calls(mail,'NET.flush').length||!calls(mail,'saveGame').length)throw Error('native mail save/flush dispatch changed');
 if(!calls(gacha,'NET.social').some(x=>x.arguments[0]?.value==='gpull')||!calls(ach,'NET.social').some(x=>x.arguments[0]?.value==='achclaim')||!calls(gift,'NET.setRev').length)throw Error('native rewards receipt/dispatch contract changed');
 walk(gift,n=>{if(['AssignmentExpression','UpdateExpression'].includes(n.type)&&['player.coins','player.tokens','player.runeDust'].includes(member(n.left||n.argument))&&(!['=','+='].includes(n.operator)||!ids(n.right).has('m')))throw Error('gift wallet must derive only native reply delta');});
 const pull=calls(gacha,'NET.social').find(x=>x.arguments[0]?.value==='gpull');const props=pull?.arguments[1]?.properties||[];if(props.find(p=>p.key.name==='how')?.value?.name!=='how'||props.find(p=>p.key.name==='n')?.value?.name!=='n')throw Error('gift payment choice changed');
 return {freeCommandsOnly:true};
}
function enchant(map){
 const f=unique(map,'doEnchant');safeExecution(f);const send=calls(f,'NET.social').filter(n=>n.arguments[0]?.value==='ench'),flush=calls(f,'NET.flush');
 if(!f.async||send.length!==1||!flush.length||flush[0].start>send[0].start||!rejects(f,t=>member(t)==='enchBusy')||!rejects(f,t=>{const terms=disjunction(t);return terms.some(x=>binary(x,'player.coins','<','c.coins'))&&terms.some(x=>binary(x,'player.tokens','<','c.tokens'))}))throw Error('native bounded enchant budget/flush dispatch changed');
 return {boundedRoll:true};
}
function market(map){const f=unique(map,'mkSend'),r=unique(map,'marketMessage');safeExecution(f);safeExecution(r);const sends=calls(f,'NET.social'),flush=calls(f,'NET.flush');if(!f.async||sends.length!==1||!flush.length||flush[0].start>sends[0].start||!calls(f,'saveGame').length||!rejects(f,t=>disjunction(t).some(x=>member(x)==='mkBusy')&&disjunction(t).some(x=>unary(x,'NET.online')))||!calls(r,'applyDelta').some(c=>member(c.arguments[0])==='m.d')||!calls(r,'NET.setRev').some(c=>member(c.arguments[0])==='m.rev')||!calls(r,'saveGame').length)throw Error('native market serialized online save/flush/reply contract changed');return {singleDispatch:true,receipt:'native_delta_revision'};}
function astral(text,map){
 const reply=unique(map,'astralMessage');safeExecution(reply);if(!calls(reply,'applyDelta').length||!ids(reply).has('astralSave')||!ids(reply).has('did'))throw Error('native Astral state/delta acknowledgement missing');
 let points,bt;
 for(const {n,anc:a,outer}of map.get('__astralHandlers')||[]){const handler=a.findLast(x=>['ArrowFunctionExpression','FunctionExpression'].includes(x.type));if(!outer)throw Error('Astral online guard missing');if(n.arguments[0].value==='aspt'){if(points)throw Error('duplicate Astral points dispatch');if(!rejects(handler,t=>disjunction(t).some(x=>member(x)==='asBusy'),n.start)||n.arguments[1]?.type!=='ObjectExpression')throw Error('Astral point serialization changed');points=n;}else {if(bt)throw Error('duplicate Astral breakthrough dispatch');const ancestor=a.findLast(x=>x.type==='CallExpression'&&x.callee.type==='MemberExpression'&&x.callee.property.name==='then'&&calls(x.callee.object,'NET.flush').length);if(!ancestor)throw Error('Astral breakthrough must await native flush');bt=n;}}
 if(!points||!bt)throw Error('native Astral actions unavailable');return {actions:['aspt','asbt'],resetApproved:false};
}
const cache=new Map();
function validate(text,kind){
 const digest=crypto.createHash('sha256').update(text).digest('hex'),key=kind+':'+digest;if(cache.has(key))return cache.get(key);
 let result;try{const map=contractFunctions(text,digest);let facts;if(kind==='refine')facts=refine(map);else if(kind==='craft')facts=craft(map);else if(kind==='rewards')facts=rewards(map);else if(kind==='enchant')facts=enchant(map);else if(kind==='market')facts=market(map);else if(kind==='astral')facts=astral(text,map);else throw Error('unsupported semantic contract');result={allowed:true,version:1,kind,facts,sourceDigest:digest,evidence:'AST_transaction_contract',autoApproved:true};}catch(e){result={allowed:false,version:1,kind,reason:e.message,sourceDigest:digest,autoApproved:false};}
 if(cache.size>=12)cache.clear();cache.set(key,result);return result;
}
function dataConstruction(code){
 const ast=acorn.parse(code,{ecmaVersion:'latest'}),allowed=new Set(['RX','__L','Object.keys','Object.entries','Object.fromEntries','Object.assign','Math.max','Math.min','Math.floor','JSON.stringify']);
 safeExecution(ast);walk(ast,n=>{if(['ThisExpression','WithStatement','ImportExpression','NewExpression'].includes(n.type)||n.type==='Identifier'&&['eval','Function','require','process','global','globalThis'].includes(n.name))throw Error('recipe data construction execution forbidden');if(n.type==='CallExpression'){const name=member(n.callee);if(!allowed.has(name)&&!/^.+\.(push|filter|map|find|forEach|some|every|includes|indexOf|startsWith|slice|replace|toLowerCase|at|join)$/.test(name||''))throw Error('unapproved recipe data call: '+name);}});return true;
}
function recipeConstruction(text){
 const scripts=[...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);if(!scripts.length)scripts.push(text);
 for(const source of scripts){if(!source.trim())continue;const ast=acorn.parse(source,{ecmaVersion:'latest'});let declaration,body;
  walk(ast,(n,a)=>{if(n.type==='VariableDeclarator'&&n.id.name==='EXCHANGE'){if(declaration)throw Error('ambiguous native exchange catalog');declaration=a.findLast(x=>x.type==='VariableDeclaration');body=a.findLast(x=>x.type==='BlockStatement'||x.type==='Program')?.body;}});
  if(!declaration)continue;
  const scopes=[{body,start:body.indexOf(declaration)}];
  // Extract pure data mutations from invoked initialization functions as well.
  // Never execute bootstrap/UI code or an arbitrary function body.
  for(const n of body){if(n.type!=='FunctionDeclaration')continue;let invoked=false;walk(ast,x=>{if(x.type==='CallExpression'&&member(x.callee)===n.id.name)invoked=true});if(invoked)scopes.push({body:n.body.body,start:-1});}
  const selected=new Set([declaration]);
  const free=n=>{const bound=new Set(),refs=new Set();const bind=x=>{if(!x)return;if(x.type==='Identifier')bound.add(x.name);else if(x.type==='ArrayPattern')x.elements.forEach(bind);else if(x.type==='ObjectPattern')x.properties.forEach(p=>bind(p.value||p.argument));else if(x.type==='AssignmentPattern')bind(x.left);else if(x.type==='RestElement')bind(x.argument);};walk(n,x=>{if(x.type==='VariableDeclarator')bind(x.id);if(x.params)x.params.forEach(bind);});walk(n,(x,a)=>{if(x.type!=='Identifier')return;const p=a.at(-1);if(p?.type==='MemberExpression'&&p.property===x&&!p.computed||p?.type==='Property'&&p.key===x&&!p.computed)return;refs.add(x.name);});return [...refs].filter(x=>!bound.has(x));};
  for(const scope of scopes){for(const n of scope.body.slice(scope.start+1)){if(n.type==='FunctionDeclaration')continue;let mutation=false;walk(n,x=>{if(x.type==='CallExpression'&&['EXCHANGE.push','EXCHANGE.forEach'].includes(member(x.callee)))mutation=true;});if(mutation)selected.add(n);}}
  for(let changed=true;changed;){changed=false;for(const scope of scopes){const dependencies=new Map();for(const n of [...body,...scope.body])if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.id.type==='Identifier')dependencies.set(d.id.name,n);for(const n of scope.body.filter(n=>selected.has(n)))for(const name of free(n)){if(['EXCHANGE','RX','AsteriaWorld','ITEMS'].includes(name))continue;const d=dependencies.get(name);if(d&&!selected.has(d)){selected.add(d);changed=true;}}}}
  const code=scopes.map((scope,i)=>{const code=scope.body.filter(n=>selected.has(n)).map(n=>source.slice(n.start,n.end)).join('\n');return i?'{\n'+code+'\n}':code;}).join('\n');dataConstruction(code);return code+'\nEXCHANGE;';
 }
 throw Error('native exchange data unavailable');
}
module.exports={validate,functions,walk,member,calls,clean,fingerprint,dataConstruction,recipeConstruction};
