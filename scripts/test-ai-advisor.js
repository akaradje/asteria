'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Advisor,context,validatePlan,settings,choiceContext,primaryBody,problemSlots}=require('../src/ai-advisor');
(async()=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-advisor-'));fs.mkdirSync(path.join(root,'logs'));
fs.writeFileSync(path.join(root,'.env'),'OPENROUTER_API_KEY=test-secret\nOPENROUTER_MODEL=test\nTYPESAFE_API_KEY=test-secret\n');
const status={at:new Date().toISOString(),instances:[{slot:0,lv:20,status:'playing',account:'PRIVATE',password:'PRIVATE',goal:{label:'test',reason:'test',mapId:'w1'}}]};
fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(status));
const state=context(root);assert(!JSON.stringify(state).includes('PRIVATE'));
const dynamicPrompt=primaryBody(state,choiceContext(state),'meta','test').messages[0].content;assert(dynamicPrompt.includes('role-weighted Combat Power'));assert(dynamicPrompt.includes('without a fixed equipment-before-Astral gate'));assert(!dynamicPrompt.includes('before equipment is complete'));assert(!dynamicPrompt.includes('Respect milestones in order'));assert(dynamicPrompt.includes('Never interrupt the owner'));

const execution={at:Date.now(),target:'zenith_aegis',status:'not_sent',reason:'exact-recipe-name-and-cost-not-listed'};
status.instances[0].equipmentMaintenanceStatus={...execution,id:execution.target};
fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(status));
const evidenceState=context(root);assert.deepEqual(evidenceState.members[0].equipmentExecution,execution);
assert.deepEqual(choiceContext(evidenceState).members[0].equipmentExecution,execution);
assert(require('../src/learning/proposal-contract').facts(evidenceState.members[0]).some(f=>f.kind==='equipmentExecution'&&f.value.reason===execution.reason));
{
 const scoped=JSON.parse(JSON.stringify(status)),actorId='actor-'+'a'.repeat(32),r=scoped.instances[0];
 Object.assign(r,{identity:{actorId},levelProgress:{build:'b'},vitals:{hp:.9,currentHp:90,maxHp:100,at:Date.now()},aiStrategyScope:{actorId,build:'b',at:Date.now(),independent:true}});
 fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(scoped));const c=context(root);assert(c.members[0].independentStrategy);assert.equal(choiceContext(c).members[0].vitals.maxHp,100);
 r.aiStrategyScope.actorId='other';fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(scoped));assert(!context(root).members[0].independentStrategy);
 r.aiStrategyScope.actorId=actorId;r.aiStrategyScope.at=Date.now()-31000;fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(scoped));assert(!context(root).members[0].independentStrategy);
 fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(status));
}
assert.throws(()=>context(root,Date.now()+100000));
assert.throws(()=>validatePlan({summary:'test',members:[{slot:9,action:'continue',reason:'x'}]},state));
assert.throws(()=>validatePlan({summary:'test',members:[{slot:0,action:'execute',reason:'x'}]},state));
let count=0;const fake=async(url,opts)=>{count++;assert(!opts.body.includes('PRIVATE'));return {ok:true,json:async()=>String(url).includes('typesafe')?{answers:{slot_0:{type:'choice',choice:'observe',confidence:0.7}}}:{choices:[{message:{content:JSON.stringify({summary:'test',members:[{slot:0,action:'observe',reason:'need evidence'}]})}}],usage:{total_tokens:10}}};};
const a=new Advisor(root,fake);assert(!JSON.stringify(a.view()).includes('test-secret'));await a.generate();assert.equal(count,2);assert.equal(a.last.plan.members[0].action,'observe');assert(!a.busy);await assert.rejects(()=>a.generate(),/60/);
const b=new Advisor(root,async()=>({ok:false,status:401}));b.nextAt=0;await b.generate();assert.equal(b.last.plan,null);assert.match(b.last.providers.typesafe.error,/401/);assert(!b.busy);
const c=new Advisor(root,async()=>({ok:true,json:async()=>({answers:{slot_0:{type:'choice',choice:'execute',confidence:2}}})}));c.nextAt=0;await c.generate();assert.equal(c.last.providers.typesafe.ok,false);assert.equal(c.last.providers.openrouter.ok,false);
assert.equal(fs.readFileSync(path.join(root,'logs/status.json'),'utf8'),JSON.stringify(status));
fs.appendFileSync(path.join(root,'.env'),'META_API_KEY=meta-private-test\nMETA_MODEL=muse-spark-1.3-contributor\n');
const requests=[];
const meta=new Advisor(root,async(url,opts)=>{
 const u=new URL(url),body=JSON.parse(opts.body);requests.push(u.hostname);
 assert(!opts.body.includes('PRIVATE'));assert(!opts.body.includes('meta-private-test'));
 if(u.hostname==='api.typesafe.ai')return {ok:true,json:async()=>({answers:{slot_0:{type:'choice',choice:'observe',confidence:.8}}})};
 assert.equal(u.href,'https://api.meta.ai/v1/chat/completions');assert.equal(opts.redirect,'error');
 assert.equal(opts.headers.Authorization,'Bearer meta-private-test');assert.equal(body.model,'muse-spark-1.3-contributor');
 assert.equal(body.reasoning_effort,'low');assert.equal(body.messages[0].role,'developer');
 assert.equal(body.max_tokens,4000);assert.equal(JSON.parse(body.messages[1].content).jev,undefined);
 assert.deepEqual(body.response_format.json_schema.schema.properties.members.items.properties.action.enum,['continue','observe']);
 assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
 assert.equal(body.response_format.json_schema.schema.additionalProperties,false);
 assert(body.response_format.json_schema.schema.properties.members.items.properties.action.enum.includes('observe'));
 return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({summary:'meta test',members:[{slot:0,action:'observe',reason:'fresh observation'}]})}}]})};
});
assert.equal(meta.view().plannerProvider,'meta');assert.deepEqual(meta.view().last,{});assert(!meta.view().config.openrouter);
meta.nextAt=0;await meta.generate();assert.equal(meta.last.plannerProvider,'meta');assert.equal(meta.last.providers.meta.ok,true);
assert.equal(meta.last.providers.openrouter,undefined);assert.deepEqual(requests,['api.typesafe.ai','api.meta.ai']);
assert(!JSON.stringify(meta.view()).includes('meta-private-test'));
// Three-character production replies exhausted the old fixed 4000-token limit.
const multi={at:new Date().toISOString(),instances:Array.from({length:3},(_,slot)=>({...status.instances[0],slot}))};
fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(multi));
const multiAdvisor=new Advisor(root,async(url,opts)=>{
 const body=JSON.parse(opts.body);
 if(new URL(url).hostname==='api.typesafe.ai')return {ok:true,json:async()=>({answers:Object.fromEntries(multi.instances.map(m=>['slot_'+m.slot,{type:'choice',choice:'observe',confidence:.5}]))})};
 assert.equal(body.max_tokens,6000);
 const props=body.response_format.json_schema.schema.properties.members.items.properties;
 assert.equal(props.evidenceIds.maxItems,3);assert.equal(props.assumptions.maxItems,2);assert.equal(props.effects.maxItems,2);
 return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'bounded team plan',members:multi.instances.map(m=>({slot:m.slot,action:'observe',reason:'waiting for fresh evidence'}))})}}]})};
});
multiAdvisor.nextAt=0;await multiAdvisor.generate();assert.equal(multiAdvisor.last.plan.members.length,3);assert(multiAdvisor.last.providers.meta.ok);
fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(status));
const noFallback=new Advisor(root,async(url)=>({ok:new URL(url).hostname==='api.typesafe.ai',status:503,json:async()=>({answers:{slot_0:{type:'choice',choice:'observe',confidence:.8}}})}));
noFallback.nextAt=0;await noFallback.generate();assert.equal(noFallback.last.plan,null);assert.equal(noFallback.last.providers.meta.ok,false);assert.equal(noFallback.last.providers.openrouter,undefined);
for(const url of ['https://api.meta.ai.evil.test/v1/chat/completions','http://api.meta.ai/v1/chat/completions','https://api.meta.ai:444/v1/chat/completions','https://api.meta.ai/other','https://api.meta.ai/v1/chat/completions?key=x'])await assert.rejects(()=>meta.request({key:'private',model:'test',url},{},'api.meta.ai'),/URL/);
fs.writeFileSync(path.join(root,'.env'),'META_API_KEY=partial-secret\nOPENROUTER_API_KEY=legacy-secret\nOPENROUTER_MODEL=legacy\n');
assert.equal(settings(root).plannerProvider,'meta');assert.equal(new Advisor(root).view().config.meta.configured,false);
const largeState={snapshotAt:new Date().toISOString(),notes:'HP maximum unknown; currency reserve is not HP',members:Array.from({length:6},(_,slot)=>({slot,status:'playing',hp:50,saveAgeSeconds:2,noProgressSeconds:180,personalBrain:{reserve:10000,coins:11000,availableFocuses:['focus_gear'],role:'support',strategy:{focus:'focus_gear'},craft:{ready:false,missing:[{name:'Tyrant Ember',have:0,want:3,protected:true}],acquisition:{fullTree:'x'.repeat(50000)}},gearTargets:[{itemId:'target',item:'target',ratePct:2,source:'x'.repeat(50000)}],recentDecisions:'x'.repeat(50000)},journey:{build:'test',fresh:true,state:'acquire',verified:'x'.repeat(50000)},blockedMaps:{e2:{until:123456,reason:'death',huge:'x'.repeat(50000)}},lastHour:{expPerHour:10,deaths:1}}))};
const compact=choiceContext(largeState);assert.equal(compact.members.length,6);assert(Buffer.byteLength(JSON.stringify(compact))<12000);
assert.equal(compact.members[5].personalBrain.reserve,10000);assert.equal(compact.members[5].hp,50);
assert.deepEqual(compact.members[5].personalBrain.availableFocuses,['focus_gear']);assert.equal(compact.members[5].blockedMaps.e2.until,123456);
assert.equal(compact.members[5].personalBrain.craft.missing[0].protected,true);assert.equal(compact.members[5].saveAgeSeconds,2);assert.equal(compact.members[5].noProgressSeconds,180);
assert(!JSON.stringify(compact).includes('fullTree'));assert.equal(largeState.members[0].personalBrain.craft.acquisition.fullTree.length,50000);
largeState.members[0].personalBrain.milestones={stage:'wing',pet:true,wing:false,equipmentAllowed:false,reason:'owned pet then class then wing'};
largeState.members[0].nightTraining={active:true,target:120,deadline:123456,remainingExp:1000,onPace:false};
const priorities=choiceContext(largeState);assert.equal(priorities.members[0].personalBrain.milestones.stage,'wing');assert.equal(priorities.members[0].nightTraining.target,120);assert.equal(priorities.members[0].nightTraining.guaranteed,false);
assert.deepEqual(problemSlots({members:[{slot:0,status:'playing',saveAgeSeconds:2,noProgressSeconds:180},{slot:1,status:'playing',saveAgeSeconds:2,noProgressSeconds:0},{slot:2,status:'playing',saveAgeSeconds:31,noProgressSeconds:180},{slot:3,status:'playing',saveAgeSeconds:2,noProgressSeconds:180,busy:true}]}),[0]);
const blocked={slot:4,actorId:'actor',status:'playing',saveAgeSeconds:1,noProgressSeconds:300,busy:true,recovery:{needsDiagnosis:true,incidentKey:'case',blockedNodes:['space'],suppressedActions:['inventory'],password:'never-send',attempts:[{action:'inventory',result:'unconfirmed',token:'never-send'}]}};
assert.deepEqual(problemSlots({members:[blocked]}),[4],'owned stall remains diagnosable');
const blockedCompact=choiceContext({members:[blocked]});assert.deepEqual(blockedCompact.members[0].allowedActions,['continue','observe']);
const busyPlan={...blocked,personalBrain:{availableFocuses:['focus_craft']}};assert.deepEqual(choiceContext({members:[busyPlan]}).members[0].allowedActions,['continue','observe','focus_craft']);assert.equal(validatePlan({summary:'queued',members:[{slot:4,action:'focus_craft',reason:'next upgrade'}]},{snapshotAt:new Date().toISOString(),members:[busyPlan]}).members[0].action,'focus_craft');
const paymentOnly={...blocked,busy:false,recovery:{blockedNodes:['execute'],suppressedActions:[]},personalBrain:{availableFocuses:['focus_craft']}};
assert.deepEqual(choiceContext({members:[paymentOnly]}).members[0].allowedActions,['continue','observe','focus_craft'],'models see executable intents, not forbidden recovery');
assert.deepEqual(choiceContext({members:[{...paymentOnly,independentStrategy:true}]}).members[0].allowedActions,['continue','observe','review_route','focus_craft']);
assert(!JSON.stringify(require('../src/runtime/recovery-intelligence').project(blocked.recovery)).includes('never-send'));
assert.throws(()=>validatePlan({summary:'x',members:[{slot:0,action:'recover',reason:'x'}]},{members:[{slot:0,status:'playing',saveAgeSeconds:-1,noProgressSeconds:180}]}));
// Independent requests start together; neither model can echo the other's choice.
fs.writeFileSync(path.join(root,'.env'),'META_API_KEY=fake\nMETA_MODEL=test\nTYPESAFE_API_KEY=fake\n');
let releaseJudge;const judgeWaiting=new Promise(r=>{releaseJudge=r;});let primaryStarted=false;
const independent=new Advisor(root,async(url,opts)=>{if(new URL(url).hostname==='api.typesafe.ai'){await judgeWaiting;return {ok:true,json:async()=>({answers:{slot_0:{type:'choice',choice:'observe',confidence:.8}}})};}primaryStarted=true;releaseJudge();return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({summary:'independent',members:[{slot:0,action:'observe',reason:'observations'}]})}}]})};});independent.nextAt=0;await independent.generate();assert(primaryStarted);assert(independent.last.efficiency.independentModels);
fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify({at:new Date().toISOString(),instances:[{slot:0,status:'playing',lastSaveAgo:2,noProgressFor:180},{slot:1,status:'playing',lastSaveAgo:2,noProgressFor:2}]}));
let selectedRequests=0;const selected=new Advisor(root,async(url,opts)=>{selectedRequests++;const b=JSON.parse(opts.body),members=b.state?.members||JSON.parse(b.messages[1].content).state.members;assert.deepEqual(members.map(m=>m.slot),[0]);return {ok:true,json:async()=>new URL(url).hostname==='api.typesafe.ai'?{answers:{slot_0:{type:'choice',choice:'review_route',confidence:.9}}}:{choices:[{message:{content:JSON.stringify({summary:'stalled only',members:[{slot:0,action:'review_route',reason:'180 seconds'}]})}}]}};});selected.nextAt=0;await selected.generate({slots:[0]});assert.equal(selectedRequests,2);assert.equal(selected.last.plan.members.length,1);selected.nextAt=0;await assert.rejects(()=>selected.generate({slots:[1]}),/ปัญหาเปลี่ยน/);assert.equal(selectedRequests,2);
const productiveActor='actor-'+'a'.repeat(32);
fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify({at:new Date().toISOString(),instances:[{slot:0,identity:{actorId:productiveActor},levelProgress:{build:'current'},status:'playing',lastSaveAgo:2,noProgressFor:2,personalBrain:{availableFocuses:['focus_gear']}}]}));
const strategic=new Advisor(root,async(url,opts)=>{const body=JSON.parse(opts.body),members=body.state?.members||JSON.parse(body.messages[1].content).state.members;assert.deepEqual(members.map(m=>m.slot),[0]);return {ok:true,json:async()=>new URL(url).hostname==='api.typesafe.ai'?{answers:{slot_0:{type:'choice',choice:'focus_gear',confidence:.9}}}:{choices:[{message:{content:JSON.stringify({summary:'AI priority',members:[{slot:0,action:'focus_gear',reason:'finish equipment'}]})}}]}};});
strategic.nextAt=0;await assert.rejects(()=>strategic.generate({slots:[0]}),/ปัญหาเปลี่ยน/);
await strategic.generate({slots:[0],mode:'controller'});assert.equal(strategic.last.mode,'strategic_controller');assert.equal(strategic.last.plan.members[0].action,'focus_gear');
const projected=choiceContext({members:[{personalBrain:{strategy:{action:'focus_gear',until:12345}}}]}).members[0].personalBrain.strategy;assert.equal(projected.focus,'focus_gear');assert.equal(projected.expiresAt,12345);
const malformed=new Advisor(root,fake);malformed.nextAt=0;fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify({at:new Date().toISOString(),instances:[{slot:0,personalBrain:{availableFocuses:'malformed'}}]}));await assert.rejects(()=>malformed.generate());assert.equal(malformed.busy,false);
fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify({at:new Date().toISOString(),instances:[{slot:0,identity:{actorId:'native-a'},job:'mage',levelProgress:{build:'current'},personalRouteMemory:{actorId:'native-a',blocked:{e2:{until:Date.now()+60000,reason:'current actor'}}}}]}));
fs.mkdirSync(path.join(root,'data/learning'),{recursive:true});fs.writeFileSync(path.join(root,'data/learning/brain-0.json'),JSON.stringify({blocked:{old:{until:Date.now()+60000}}}));
assert(context(root).members[0].blockedMaps.e2);assert(!context(root).members[0].blockedMaps.old);
const outcome={slot:0,actorId:'native-a',netExp:123,levelsGained:0,elapsedMs:180000,evidence:'observed_after_advice_not_proof_of_causation'};
fs.writeFileSync(path.join(root,'logs/ai-auto.json'),JSON.stringify({history:[{evaluatedAt:Date.now(),baseline:[{slot:0,actorId:'native-a',build:'old',job:'mage'}],outcomes:[{...outcome,netExp:999}]},{evaluatedAt:Date.now(),baseline:[{slot:0,actorId:'other',build:'current',job:'mage'}],outcomes:[{...outcome,actorId:'other',netExp:999}]},{evaluatedAt:Date.now(),baseline:[{slot:0,actorId:'native-a',build:'current',job:'mage'}],decisions:[{slot:0,actorId:'native-a',action:'review_route'}],outcomes:[outcome]}]}));
assert.deepEqual(context(root).members[0].adviceOutcomes.map(o=>o.netExp),[123]);assert.equal(choiceContext(context(root)).members[0].adviceOutcomes[0].action,'review_route');
const memoryAt=Date.now();fs.writeFileSync(path.join(root,'logs/ai-auto.json'),JSON.stringify({outcomeMemory:[{...outcome,at:memoryAt,job:'mage',build:'current',comparable:true,execution:{state:'deferred'},planAssessment:'awaiting_application',appliedForMs:null},{...outcome,at:memoryAt,job:'mage',build:'old',comparable:true,netExp:999},{...outcome,at:memoryAt-86400001,job:'mage',build:'current',comparable:true,netExp:999},{...outcome,at:memoryAt+60000,job:'mage',build:'current',comparable:true,netExp:999},{...outcome,actorId:'other',at:memoryAt,job:'mage',build:'current',comparable:true,netExp:999}]}));
assert.deepEqual(context(root).members[0].adviceOutcomes.map(o=>o.netExp),[123]);assert.equal(choiceContext(context(root)).members[0].adviceOutcomes[0].execution,'deferred');assert.equal(choiceContext(context(root)).members[0].adviceOutcomes[0].planAssessment,'awaiting_application');
fs.writeFileSync(path.join(root,'logs/ai-auto.json'),JSON.stringify({history:[]}));

{
 const actorId='actor-'+'b'.repeat(32),now=Date.now(),gate={kind:'craft',status:'reconciled_craft_unknown',target:'stormveil_quiver',evidence:'native_current_budget_after_closed_craft_session'};
 const complex={at:new Date(now).toISOString(),instances:Array.from({length:3},(_,slot)=>({slot,status:'playing',identity:{actorId:slot===0?actorId:'actor-'+String(slot).repeat(32)},lv:120,job:'windstrider',lastSaveAgo:2,noProgressFor:1800,levelProgress:{build:'current',status:'capped',measuredMs:100000,expPerHour:0,deaths:0},goal:{label:'ทดสอบ'.repeat(100),reason:'ข้อมูลสด'.repeat(200),mapId:'e1'},vitals:{hp:1,currentHp:5000,maxHp:5000,at:now},runtimeV3:{controller:{objective:'equipment',target:'stormveil_quiver',quietMs:1800000}},developmentProgress:{executionGates:{craft:gate,refine:null}},personalBrain:{reserve:12000,coins:500000,availableFocuses:['focus_refine'],milestones:{stage:'equipment',pet:true,wing:true,equipmentAllowed:true,reason:'ข้อมูล'.repeat(1000),history:'not-for-model'.repeat(10000)},combatObjective:{role:'สนับสนุน',stage:'equipment',equipment:{legendary:6,target:8,refine10:0,refineTarget:7,complete:false},loadout:{score:1000,method:'weighted_loadout_not_measured_dps',unknown:[]},funding:{reserve:12000,spendable:488000,purpose:'upgrade:stormveil_quiver'}},craft:{id:'stormveil_quiver',name:'Stormveil Quiver',ready:true,coinCost:250000,missing:[]}},development:[{status:'server_confirmed',evidence:'server_accepted_exact_save_revision',context:{actorId},serverReceipt:{actorId,build:'current'}},{status:'server_confirmed',evidence:'server_accepted_exact_save_revision',context:{actorId:'other'},serverReceipt:{actorId:'other',build:'current'}},{status:'server_confirmed',evidence:'server_accepted_exact_save_revision',context:{actorId},serverReceipt:{actorId,build:'old'}}]}))};
 fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify(complex));
 const full=context(root),projected=choiceContext(full);
 assert.equal(full.members[0].legendaryCount,6);assert.equal(full.members[0].confirmedReceiptCount,1,'receipts use the real ledger array and exact current actor/build');
 assert.equal(full.members[1].confirmedReceiptCount,0,'another actor receipt cannot raise feedback');
 assert.deepEqual(projected.members[0].executionGates.craft,gate);assert.equal(projected.members[0].vitals.hpRatio,1);
 assert.equal(projected.members[0].personalBrain.reserve,12000);
 assert(Buffer.byteLength(projected.members[0].personalBrain.milestones.reason)<=240);
 assert(!JSON.stringify(projected).includes('not-for-model'));
 assert.deepEqual(projected.members[0].evidence.map(e=>e.id),require('../src/learning/proposal-contract').facts(full.members[0]).map(e=>e.id),'bounded references retain original frozen fact IDs');
 assert(Buffer.byteLength(JSON.stringify(primaryBody(full,projected,'meta','test')))<32000,'measure the whole UTF-8 request, schema, prompt and nested JSON escaping');
 let sent=0;const bounded=new Advisor(root,async(url,opts)=>{sent++;assert(Buffer.byteLength(opts.body)<=32000);const body=JSON.parse(opts.body),members=body.state?.members||JSON.parse(body.messages[1].content).state.members;return {ok:true,json:async()=>new URL(url).hostname==='api.typesafe.ai'?{answers:Object.fromEntries(members.map(m=>['slot_'+m.slot,{type:'choice',choice:'focus_refine',confidence:.8}]))}:{choices:[{message:{content:JSON.stringify({summary:'independent guarded progression',members:members.map(m=>({slot:m.slot,action:'focus_refine',reason:'craft fenced; native independent work only',evidenceIds:[m.evidence.find(e=>e.kind==='executionGates').id]}))})}}]}};});
 bounded.nextAt=0;await bounded.generate({mode:'controller'});assert.equal(sent,2);assert.equal(bounded.last.providers.meta.ok,true);assert.equal(bounded.last.plan.members.length,3);assert(bounded.last.efficiency.primaryRequestBytes<32000);
 // The complete model framing is bounded, while original source evidence and
 // execution constraints survive descriptions and secondary history trimming.
 const crowded={...full,members:full.members.map(m=>({...m,currentGoal:{label:'ข้อมูล'.repeat(300),reason:'เส้นทาง'.repeat(300),mapId:'e1'},blockedMaps:{e9:{until:now+60000,reason:'ห้ามเข้า'.repeat(200)}},adviceOutcomes:Array.from({length:3},()=>({action:'focus_refine',at:now,execution:{state:'deferred'},planAssessment:'awaiting_application',appliedForMs:null,confounders:['protected_work'],effects:Array.from({length:8},()=>({kind:'refine',slot:'รองเท้า'.repeat(30),delta:1})),evidence:'observed_after_advice_not_proof_of_causation'}))}))};
 const original=JSON.stringify(crowded),sized=require('../src/ai-advisor').boundedContext(crowded,'meta','test');
 assert(Buffer.byteLength(JSON.stringify(primaryBody(crowded,sized,'meta','test')))<=31000);assert.equal(JSON.stringify(crowded),original,'budget fitting never changes frozen native facts');
 for(let k=0;k<sized.members.length;k++){assert.deepEqual(sized.members[k].allowedActions,choiceContext(crowded).members[k].allowedActions);assert.deepEqual(sized.members[k].evidence.map(e=>e.id),require('../src/learning/proposal-contract').facts(crowded.members[k]).map(e=>e.id));assert.equal(sized.members[k].executionGates.craft.status,gate.status);assert.equal(sized.members[k].personalBrain.reserve,12000);assert.equal(sized.members[k].blockedMaps.e9.until,now+60000);}
 assert.throws(()=>require('../src/ai-advisor').boundedContext({...crowded,members:crowded.members.map(m=>({...m,blockedMaps:Object.fromEntries(Array.from({length:2000},(_,i)=>['blocked-map-'+i,{until:now+60000,reason:'blocked'}]))}))},'meta','test'),/ข้อมูลหลักเกินงบ/,'unfit safety facts fail closed rather than disappear');
 const foreign={summary:'invalid',members:full.members.map(m=>({slot:m.slot,action:'observe',reason:'x',evidenceIds:[projected.members[0].evidence[0].id]}))};assert.throws(()=>validatePlan(foreign,full),/unavailable evidence/);
 fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify({at:new Date().toISOString(),instances:[{slot:0,personalRouteMemory:{actorId:'native-a',blocked:{}}}]}));
}
{
 const actor='actor-'+ 'f'.repeat(32),now=Date.now(),m={slot:0,actorId:actor,build:'current',status:'playing',saveAgeSeconds:1,noProgressSeconds:1,busy:false,personalBrain:{lowFunds:false,availableFocuses:['focus_income','focus_refine','focus_craft','focus_gear'],craft:{ready:true}},executionGates:{craft:{kind:'refine',status:'pending',target:'boots'},refine:{kind:'refine',status:'pending',target:'boots'}},lastAIAction:{action:'focus_refine'},paymentRecovery:{state:'waiting',transactionId:'native-operation',target:'boots',ageMs:700000,reason:'current owner must finish',privateHistory:'x'.repeat(50000)}};
 const state={snapshotAt:new Date(now).toISOString(),members:[m]},c=choiceContext(state).members[0];assert.deepEqual(c.personalBrain.availableFocuses,['focus_gear']);assert.deepEqual(c.allowedActions,['continue','observe','focus_gear']);assert.deepEqual(problemSlots(state),[0],'a native-blocked focus is an incident even while fresh farming continues');assert.equal(c.paymentRecovery.spend,0);assert.equal(c.paymentRecovery.privateHistory,undefined);assert(require('../src/learning/proposal-contract').facts(m).some(f=>f.kind==='paymentRecovery'));assert.throws(()=>validatePlan({summary:'blocked',members:[{slot:0,action:'focus_refine',reason:'repeat'}]},state));
 const gathering={...m,personalBrain:{...m.personalBrain,craft:{ready:false}}};assert(choiceContext({members:[gathering]}).members[0].allowedActions.includes('focus_craft'),'gathering inputs is separate from executing a fenced ready recipe');
 const funded={...m,executionGates:null,personalBrain:{...m.personalBrain,lowFunds:true}};assert(choiceContext({members:[funded]}).members[0].allowedActions.includes('focus_income'));
}
const truncated=new Advisor(root,async(url,opts)=>{const body=JSON.parse(opts.body);if(new URL(url).hostname==='api.typesafe.ai'){assert.deepEqual(Object.keys(body.questions.slot_0.criteria),['continue','observe']);return {ok:true,json:async()=>({answers:{slot_0:{type:'choice',choice:'observe',confidence:.9}}})};}return {ok:true,json:async()=>({choices:[{finish_reason:'length'}],usage:{total_tokens:4444,prompt_tokens:444,completion_tokens:4000}})};});truncated.nextAt=0;await truncated.generate();assert.equal(truncated.last.plan,null);assert.equal(truncated.last.providers.meta.ok,false);assert.equal(truncated.last.providers.meta.tokens,4444);assert.equal(truncated.last.providers.meta.outputTokens,4000);
console.log('PASS: privacy/freshness/validation/cooldown; Meta routing/schema/credential isolation; no legacy fallback; endpoint guard; partial configuration fails closed');
})().catch(e=>{console.error(e);process.exitCode=1;});
