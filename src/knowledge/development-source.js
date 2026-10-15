 'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const semantics=require('./native-contract'),cached=new Map(),canonical=o=>JSON.stringify(Object.entries(o||{}).sort(([a],[b])=>a.localeCompare(b)));
function evaluate(code,input){semantics.dataConstruction(code);input={...input,...(input.AsteriaWorld?{AsteriaWorld:JSON.parse(JSON.stringify(input.AsteriaWorld))}:{}),...(input.ITEMS?{ITEMS:JSON.parse(JSON.stringify(input.ITEMS))}:{})};return vm.runInNewContext(code,input,{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});}
function constructedRecipes(text,catalog){
 let code=semantics.recipeConstruction(text).replace(/EXCHANGE;$/, 'JSON.stringify(EXCHANGE);');
 // Preserve plain native constants such as MAX_LV used by new recipe data.
 // evaluate() JSON-clones this object: native functions never enter the VM.
 const world=catalog?.world||{},data={...world,EQUIPMENT:world.EQUIPMENT||[],MONSTERS:world.MONSTERS||[]};
 if(code.includes('AsteriaWorld.newClassOpen')){
  // The current native catalog filters unopened classes. Verify the pure
  // predicate structurally; recreate it inside the data VM, never inject an
  // arbitrary host callable or treat every future class as open.
  const parse=s=>require('acorn').parse('('+s+')',{ecmaVersion:'latest'}).body[0].expression;
  const expected='id=>!NEWCLASS[id]||!!NEWCLASS[id].open';
  if(typeof world.newClassOpen!=='function'||!world.NEWCLASS||typeof world.NEWCLASS!=='object'||Array.isArray(world.NEWCLASS)||JSON.stringify(semantics.clean(parse(String(world.newClassOpen))))!==JSON.stringify(semantics.clean(parse(expected))))throw Error('native class availability predicate requires review');
  data.NEWCLASS=world.NEWCLASS;code='AsteriaWorld.newClassOpen=id=>!AsteriaWorld.NEWCLASS[id]||!!AsteriaWorld.NEWCLASS[id].open;\n'+code;
 }
 return JSON.parse(evaluate(code,{AsteriaWorld:data,ITEMS:catalog?.items||{},RX:(type,out,cost,reqLv=0)=>({type,out,cost,reqLv}),__L:(text,...args)=>Array.isArray(text)?text.reduce((s,t,n)=>s+t+(args[n]??''),''):text}));
}
function nativeEquipmentRecipes(root,build,catalog){try{
 const text=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io','asteria-online-visual-polish.html'),'utf8');
 if(!semantics.validate(text,'craft').allowed)return [];
 return constructedRecipes(text,catalog).filter(r=>r.out?.item);
 }catch{return [];}}
function enchantFingerprint(text){const a=text.indexOf('/* Weapon enchant ('),b=text.indexOf('// Settings: four tabs',a);return a<0||b<a?null:crypto.createHash('sha256').update(text.slice(a,b)).digest('hex');}
// fc913cd: worn item only; online rfup rolls on server after save/flush,
// applies server delta/revision, busy timer 8s; no local success claim.
function refineFingerprint(text){const parts=[['async function forgeSend(t, data){','let forgeLastId = null;'],['function renderRefineMain(){','// Equipment shop']];const code=[];for(const[a,b]of parts){const p=text.indexOf(a),q=text.indexOf(b,p+a.length);if(p<0||q<0)return null;code.push(text.slice(p,q));}return crypto.createHash('sha256').update(code.join('\n')).digest('hex');}
function refineHelperFingerprint(text){const a=text.indexOf("let smithTab = 'refine'"),b=text.indexOf('function renderRefineShop(){',a);return a<0||b<a?null:crypto.createHash('sha256').update(text.slice(a,b)).digest('hex');}
function craftFingerprint(text){const parts=[['function giveItem(id, pos){','let summonBusy = false;'],['function recipeOut(r){','/* Weapon enchant'],['const EXCHANGE = [','// Wings:']];const code=[];for(const [start,end]of parts){const p=text.indexOf(start),q=text.indexOf(end,p+start.length);if(p<0||q<0)return null;code.push(text.slice(p,q));}return crypto.createHash('sha256').update(code.join('\n')).digest('hex');}
function source(root,build,catalog,kind='craft'){
 const file=path.join(root,'cache',build,'asteria-online.io','asteria-online-visual-polish.html'),stat=fs.statSync(file),key=[file,stat.mtimeMs,stat.ctimeMs,stat.size,kind].join(':');
 if(cached.has(key))return cached.get(key);
 const text=fs.readFileSync(file,'utf8'),contract=semantics.validate(text,kind);if(!contract.allowed)throw Error(contract.reason);
 // Craft data must not block an independently validated refinement/enchant
 // contract. Their prices/caps come from their own native world rules.
 const recipes=kind==='craft'?constructedRecipes(text,catalog):[];
 if(recipes.some(r=>!r.out||!r.cost||!Object.values(r.cost).every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(r.reqLv)||r.reqLv<0))throw Error('native recipe data contract invalid');
 const result={recipes,contract,refineFoundationOnly:false,refineSafeTenOnly:false};if(catalog){if(cached.size>=12)cached.clear();cached.set(key,result);}return result;
}
function check(root,build,kind,args,catalog,wiki,save){try{
 const data=source(root,build,catalog,kind);
 if(kind==='refine'){
  const o=args?.[0],id=o?.targetId;
  if(o?.maxAttempts!==1||!id||!Object.values(save?.equip||{}).includes(id))throw Error('one owned equipped native attempt required');
  const rules=require('./refine-capability').nativeRules(catalog?.world),slot=Object.entries(save.equip).find(([,v])=>v===id)?.[0],cap=require('./refine-capability').support(slot,catalog.world),from=save.refine?.[id]??0;
  if(!rules||cap.state!=='supported'||!Number.isSafeInteger(from)||from<0||from>=cap.max||o.guaranteedOnly===true&&rules.chance[from]!==100)throw Error('native refinement ceiling/chance invalid');
  return {allowed:true,reason:'AST native equipped/cost/dispatch/receipt contract; independent risk and reserve preflight required',maxRefineLevel:cap.max,contract:data.contract};
 }
 if(kind==='enchant')return {allowed:true,reason:'reviewed native enchant; one roll, reserved resources and retained-line/save proof required'};
 if(kind!=='craft')throw Error('unreviewed development action');
 wiki=require('../economy').withNativeRecipes(wiki,catalog);
 const [name,type='gear']=args,r=(wiki?.crafting?.recipes||[]).find(r=>r.result===name&&r.type===type&&r.resultId);
 if(!r)throw Error('exact named recipe unavailable');
 if(type==='wing'){
  const wing=catalog.wingRecipes?.find(x=>x.resultId===r.resultId);
  if(!wing?.verified)throw Error('wing formula not verified');
 }else{
  const found=data.recipes.find(x=>x.type===type&&x.out.item===r.resultId);if(!found)throw Error('recipe not in reviewed exchange');
  const cost=Object.fromEntries(Object.entries(found.cost).map(([k,v])=>[k==='coins'?'Copper':k.startsWith('item:')?catalog.items[k.slice(5)]?.name:k,v]));
  if(canonical(cost)!==canonical(r.cost)||found.reqLv!==(r.reqLv||0)||catalog.items[r.resultId]?.name!==name)throw Error('wiki and client recipe differ');
 }
 return {allowed:true,reason:'exact client/wiki recipe validated; outgoing-save result required',targetId:r.resultId};
}catch(e){return {allowed:false,reason:e.message};}}
function recentMatchingSource(state,build,now=Date.now(),identity,root){
 const age=now-Number(state?.current?.at);
 return !!build&&state?.current?.build===build&&state?.liveBuild===build&&Number.isFinite(age)&&age>=-5000&&age<900000&&!!identity&&require('./loaded-source').inspect('',build,state.current.sourceHashes,{liveBuild:state.liveBuild,identity}).matches&&(!root||require('./loaded-source').inspect(root,build,identity.sourceHashes).matches);
}
module.exports={check,source,nativeEquipmentRecipes,constructedRecipes,craftFingerprint,refineFingerprint,refineHelperFingerprint,enchantFingerprint,recentMatchingSource};
