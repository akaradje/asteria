'use strict';
const assert=require('node:assert/strict'),e=require('../src/economy'),sup=require('../src/runtime/refine-supplies'),cat=e.loadCatalog(process.cwd(),'add136aa'),now=Date.now(),actor='actor-'+'a'.repeat(32),id='twilight_reapers';
const s={lv:120,job:'eclipsereaper',coins:10000000,equip:{weapon:id},refine:{[id]:10},materials:{Starmetal:100,'Starforged Ore':20},consumables:{},bag:[],storage:{gear:[]},locks:[]};
const i={root:process.cwd(),lastSave:s,catalog:()=>cat,actorIdentity:{actorId:actor},actorOwner:{session:'owner-1'},socialInbox:{generation:2},bagSessionStartedAt:now-10000,v2:{reservations:{totals:()=>({})}},registryV32:{store:{held:()=>({})}}};
let p=sup.opportunity(i);assert.equal(p.kind,'guardian');assert.equal(p.price,cat.world.STONES.guard.coin);assert.equal(p.group,'consumables');assert(!/premium/.test(p.selector));
i.lastSave={...s,consumables:{'Guardian Stone':1},materials:{Starmetal:100}};p=sup.opportunity(i);assert.equal(p.kind,'star');assert.equal(p.price,cat.world.STAR_BUY.coin);assert.equal(p.selector,'[data-star-buy="coin"]');
assert.equal(sup.opportunity({...i,lastSave:{...s,coins:1000}}),null);assert.equal(sup.opportunity({...i,lastSave:{...s,refine:{[id]:15}}}),null);
p={kind:'guardian',group:'consumables',name:'Guardian Stone',price:150000};const row={actorId:actor,session:'owner-1',generation:2,sentAt:now-100,target:{supply:p,before:s,context:{sessionStartedAt:now-10000,build:cat.build,rev:20}}};
const after={state:{...s,coins:s.coins-p.price,consumables:{'Guardian Stone':1}},proof:{actorId:actor,authority:'server_readback',generation:2,sessionStartedAt:now-10000,build:cat.build,requestAt:now-50,at:now,rev:21}};
assert(sup.receipt(row,after,i));for(const x of [{coins:s.coins},{consumables:{'Guardian Stone':2}},{materials:{Starmetal:99}},{refine:{[id]:11}}])assert(!sup.receipt(row,{...after,state:{...after.state,...x}},i));
for(const x of [{generation:3},{actorId:'wrong'},{requestAt:now-200},{build:'wrong'},{rev:20}])assert(!sup.receipt(row,{...after,proof:{...after.proof,...x}},i));
console.log('PASS native Copper/quotas/owned guardian/star bills, exact single supply receipt, foreign/stale/quantity/payment negatives');
const {ForgeSupplies,waitOutcome}=require('../src/observability/forge-supplies');
const supply={kind:'guardian',group:'consumables',name:'Guardian Stone',price:150000};
const ok={t:'forge',op:'gsbuy',ok:1,res:{name:'Guardian Stone'},d:{coins:-150000,cons:{'Guardian Stone':1}},rev:21};
function observation(){const f=new ForgeSupplies();f.reset(2);return {f,mark:f.mark()};}
function emit(f,m=ok){f.sent({t:'gsbuy'},10);f.receive(m,11);}
(async()=>{
 let {f,mark}=observation();emit(f);assert.equal(f.outcome(mark,supply).state,'confirmed');
 // Exact paid shape observed on native751aed14: empty mats/bag/stage plus +1cons.
 ({f,mark}=observation());emit(f,{...ok,d:{coins:-150000,mats:{},bag:[],stage:{},cons:{'Guardian Stone':1}}});assert.equal(f.outcome(mark,supply).state,'confirmed');
 for(const stage of [{weapon:1},null,[],0,'',new Date()]){const {f,mark}=observation();emit(f,{...ok,d:{...ok.d,stage}});assert.equal(f.outcome(mark,supply).state,'ambiguous','only the exact inert native stage map may be normalized');}

 for(const mutate of [x=>x.reset(3),x=>x.sent({t:'gsbuy'},12),x=>x.receive(ok,12),x=>x.invalid++,x=>x.receive({t:'forge',op:'rfup',ok:1},12)]){const {f,mark}=observation();emit(f);mutate(f);assert.equal(f.outcome(mark,supply).state,'ambiguous');}
 for(const change of [{op:'rfbuy'},{name:'other'},{delta:{coins:-150000,cons:{'Guardian Stone':2}}},{delta:{coins:-150001,cons:{'Guardian Stone':1}}},{delta:{coins:-150000,cons:{'Guardian Stone':1},tokens:-1}},{ok:1,no:'daily'}]){const {f,mark}=observation();const msg={...ok,...change};if(change.name)msg.res={name:change.name};if(change.delta)msg.d=change.delta;emit(f,msg);assert.equal(f.outcome(mark,supply).state,'ambiguous');}
 ({f,mark}=observation());f.receive(ok,11);assert.equal(f.outcome(mark,supply).state,'ambiguous','unmatched response cannot confirm a purchase');
 ({f,mark}=observation());emit(f,{t:'forge',op:'gsbuy',no:'daily'});assert.equal(f.outcome(mark,supply).state,'rejected');
 ({f,mark}=observation());emit(f,{t:'forge',op:'gsbuy',no:'daily',d:{coins:-1}});assert.equal(f.outcome(mark,supply).state,'ambiguous','charged rejection is never a no-charge receipt');
 ({f,mark}=observation());emit(f,{t:'forge',op:'gsbuy',no:'daily',d:{unknown:1}});assert.equal(f.outcome(mark,supply).state,'ambiguous');
 let clock=0;({f,mark}=observation());const delayed=await waitOutcome(f,mark,supply,{now:()=>clock,timeoutMs:8500,sleep:async ms=>{clock+=ms;if(clock===1800)emit(f);}});assert.equal(delayed.state,'confirmed');assert(clock>900,'delayed native reply exceeds former fixed wait');
 ({f,mark}=observation());clock=0;assert.equal((await waitOutcome(f,mark,supply,{now:()=>clock,timeoutMs:300,sleep:async ms=>{clock+=ms;}})).state,'timeout');
 ({f,mark}=observation());emit(f,{...ok,serverClock:123,privateNote:'never-retained'});const diagnostic=f.outcome(mark,supply);assert.equal(diagnostic.reason,'invalid_or_unknown_frame_shape');assert.deepEqual(diagnostic.evidence.unknownFields,['serverClock','privateNote']);assert.equal(diagnostic.evidence.events.length,1);assert(!JSON.stringify(diagnostic).includes('never-retained'));assert.equal(diagnostic.evidence.events[0].delta.coins,-150000);assert.equal(diagnostic.evidence.events[0].command.op,'gsbuy');
 ({f,mark}=observation());emit(f,{...ok,d:{...ok.d,refine:{},unknown:'never-retained'}});const shaped=f.outcome(mark,supply);assert.equal(shaped.reason,'supply_delta_or_label_mismatch');assert.deepEqual(shaped.evidence.events[0].deltaShape.find(x=>x.key==='refine'),{key:'refine',type:'object',size:0});assert(!JSON.stringify(shaped).includes('never-retained'));
 const {SocialInbox}=require('../src/runtime/social-inbox'),inbox=new SocialInbox();inbox.generation=2;inbox.clear();const m=inbox.forgeSupplies.mark();inbox.sent(JSON.stringify({t:'gsbuy',secret:'discarded'}),10);inbox.receive(JSON.stringify({t:'b',l:[ok]}),11);assert.equal(inbox.forgeSupplies.outcome(m,supply).state,'ambiguous');assert(!JSON.stringify(inbox.forgeSupplies).includes('discarded'));inbox.clear();assert.equal(inbox.forgeSupplies.events.length,0);
 const unchanged={state:structuredClone(s),proof:{...after.proof,rev:20}};assert(sup.receipt(row,unchanged,i,{rejected:true}));assert(!sup.receipt(row,after,i,{rejected:true}));
 for(const bad of [{actorOwner:{session:'foreign'}},{socialInbox:{generation:9}},{bagSessionStartedAt:now-20000}])assert(!sup.receipt(row,after,{...i,...bad}));
 const native=require('../src/runtime/native-save-probe'),originalRead=native.authoritativeReadback,ids=new Set();
 try{for(const mode of ['delayed','already_armed','rejected','bad_wallet']){
  let clicks=0,reads=0,closed=0,wire=0;const rows=new Map(),obs=new ForgeSupplies();obs.reset(2);
  const instance={...i,lastSave:structuredClone(s),lastSaveAt:Date.now(),status:'playing',autoChores:true,livePos:{room:'town',at:Date.now()},socialInbox:{generation:2,forgeSupplies:obs},registryV32:{policy:{policyRevision:1},store:{held:()=>({}),validateOwner:()=>true,pending:()=>[...rows.values()].filter(r=>['INTENT','SENT','UNCERTAIN'].includes(r.status)),begin:r=>{assert(!rows.has(r.id)&&!ids.has(r.id));ids.add(r.id);const x={...r,status:'INTENT'};rows.set(r.id,x);return x;},get:id=>rows.get(id),sent:id=>Object.assign(rows.get(id),{status:'SENT',sentAt:Date.now()}),transition:(id,status,patch)=>Object.assign(rows.get(id),{status,...patch}),receipt:(id,r)=>Object.assign(rows.get(id),{status:r.applied?'CONFIRMED':'NOT_APPLIED',receipt:r})}},v2:{...i.v2,sourceCoherence:{matches:true},scheduler:{checkpoint(){},run:async(name,fn)=>fn()}},canDo:()=>true,openTownService:async()=>({ok:true}),closeGamePanel:async()=>{closed++;},eval:async code=>{
   if(code.includes('data-smith'))return true;
   if(!code.includes('b.click()'))return true;
   clicks++;if(clicks===(mode==='already_armed'?1:2)){wire++;obs.sent({t:'gsbuy'});setTimeout(()=>obs.receive(mode==='rejected'?{t:'forge',op:'gsbuy',no:'daily'}:{...ok,d:{...ok.d,mats:{},bag:[],stage:{}}}),mode==='delayed'?1200:10);}return true;
  }};
  const baseProof={...after.proof,at:Date.now(),requestAt:Date.now(),rev:20};
  native.authoritativeReadback=async()=>{reads++;const b=reads===1;return {state:b||mode==='rejected'?structuredClone(s):{...structuredClone(after.state),coins:after.state.coins-(mode==='bad_wallet'?1:0)},proof:{...baseProof,at:Date.now(),requestAt:Date.now(),rev:b||mode==='rejected'?20:22}};};
  await sup.tick(instance);const result=[...rows.values()][0];assert(result,'intent exists');assert.equal(wire,1);assert.equal(clicks,mode==='already_armed'?1:2);assert.equal(closed,1);assert.equal(reads,2);
  assert.equal(result.status,mode==='rejected'?'NOT_APPLIED':mode==='bad_wallet'?'UNCERTAIN':'CONFIRMED');
  if(mode==='bad_wallet'){await sup.tick(instance);assert.equal(rows.size,1);assert.equal(wire,1,'uncertain UUID can never be sent again');}
 }}finally{native.authoritativeReadback=originalRead;}
 const oldStatus={id:'old-supply',status:'UNCERTAIN',at:now};const scoped={...i,refineSupplyStatus:oldStatus,registryV32:{store:{get:()=>({actorId:actor,kind:'refine:supply',status:'RECONCILED',target:{supply}})}}};assert.equal(sup.view(scoped).status,'RECONCILED');assert.equal(sup.view(scoped).lastObservedStatus,'UNCERTAIN');assert.equal(oldStatus.status,'UNCERTAIN','historical observation is never rewritten');assert.equal(sup.view({...scoped,registryV32:{store:{get:()=>null}}}).status,'UNKNOWN');assert.equal(sup.view({...scoped,actorIdentity:{actorId:'foreign'}}).status,'UNKNOWN');
 console.log('PASS delayed socket+GET, prearmed single dispatch, exact rejection/no charge, reconnect/foreign/duplicate/unknown delta fences, privacy/reset and UNCERTAIN no replay');
})().catch(e=>{console.error(e);process.exitCode=1;});
