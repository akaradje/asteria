'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),mod=require('../src/runtime/isolated-storage');
const now=Date.now(),s={lv:120,job:'asura',bagTier:4,storeTier:0,bag:[{id:'spare',uid:7},{id:'protected',uid:8}],storage:{gear:[]},equip:{head:'protected'},coins:10000,materials:{Ore:5},keyItems:{},refine:{},stage:{},holes:{},sockets:{},weaponOpts:{},plk:{},locks:[]};
assert(mod.equal({id:'spare',up:0,lk:false},{lk:false,up:0,id:'spare'}),'native object key order is not an inventory change');assert(!mod.equal({id:'spare',up:0},{id:'spare',up:1}));assert(!mod.equal(['a','b'],['b','a']),'array order is retained for exact native instance accounting');
assert(mod.sameGearProjection([{id:'stored'}],[{id:'stored',up:false,lk:false}]),'native omitted flags match explicit telemetry false');
assert(mod.sameGearProjection([{id:'stored',up:1,lk:0}],[{id:'stored',up:true,lk:false}]));
for(const wrong of [[{id:'stored',up:true}], [{id:'stored',lk:true}], [{id:'stored',extra:1}], [{id:'stored',up:{refine:5}}], ['stored'],null])assert(!mod.sameGearProjection([{id:'stored'}],wrong),'changed investments/locks and unknown schema cannot pass');
const cat={build:'fixture',items:{spare:{id:'spare',slot:'head',stats:{def:1}},protected:{id:'protected',slot:'head',stats:{def:100}}},world:{bagCap:()=>48,storeCap:()=>100}};
const old={id:'old',at:now-900000,kind:'craft',status:'UNCERTAIN',target:{id:'wing'},before:{equip:s.equip}};
const i={catalog:()=>cat,lastSave:structuredClone(s),lastSaveAt:now,bagSessionStartedAt:now-60000,livePos:{room:'town',at:now},vitals:{hp:1,at:now},actorIdentity:{actorId:'actor-fixture'},actorOwner:{session:'session'},v2:{sourceCoherence:{matches:true},journal:{rows:[old]}},registryV32:{store:{pending:()=>[],validateOwner:()=>true}}};
assert(mod.gate(i,'spare',now).allowed);assert.equal(old.status,'UNCERTAIN');assert(!mod.gate(i,'protected',now).allowed);
for(const change of [r=>r.at=now,r=>r.target={},r=>r.kind='unknown',r=>r.target.id='spare',r=>r.before.equip={head:'spare'}]){const r=structuredClone(old);change(r);assert(!mod.unrelated({...i,v2:{...i.v2,journal:{rows:[r]}}},'spare',now),'overlapping/current/unknown uncertainty never bypassed');}
for(const patch of [{pendingTravel:{mapId:'w1'}},{teamControl:true},{teamTradeStatus:{phase:'UNCERTAIN'}},{vitals:{hp:.2,at:now}},{lastSaveAt:now-31000}])assert(!mod.gate({...i,...patch},'spare',now).allowed);
const spare=require('../src/runtime/storage-spare'),upgradeCat={...cat,items:{...cat.items,spare:{...cat.items.spare,stats:{def:200}}}},duplicate={...i,catalog:()=>upgradeCat,lastSave:{...s,bag:['spare','spare']}},copyPlan={equip:[{id:'spare',uid:6}],keep:[],give:[],store:[{id:'spare',uid:7}]};
assert(mod.gate(duplicate,'spare',now,copyPlan).allowed,'keep planned upgrade, move only its unused duplicate');
assert(!spare.candidate(duplicate,copyPlan.equip[0],copyPlan).allowed,'planned UI instance stays in bag');
assert(spare.candidate(duplicate,copyPlan.store[0],copyPlan).allowed);
assert(!mod.gate({...duplicate,lastSave:{...duplicate.lastSave,bag:['spare']}},'spare',now,copyPlan).allowed,'one remaining copy cannot be deposited');
assert(!mod.gate(duplicate,'spare',now,{...copyPlan,keep:[{id:'spare',uid:7}]}).allowed,'keep plus equip consume both copies');
assert(!mod.gate(duplicate,'spare',now,{equip:[],give:[],keep:[]}).allowed,'unreserved upgrade stays protected');
for(const patch of [{refine:{spare:1}},{holes:{spare:1}},{locks:['spare']}])assert(!mod.gate({...duplicate,lastSave:{...duplicate.lastSave,...patch}},'spare',now,copyPlan).allowed,'native ID-scoped investment protects every duplicate');
const row={actorId:'actor-fixture',session:'session',generation:2,sentAt:now,target:{id:'spare',uid:'7',build:'fixture',sessionStartedAt:i.bagSessionStartedAt,beforeRev:1,before:structuredClone(s)}};
const after=structuredClone(s);after.bag.shift();after.storage.gear.push({id:'spare'});
const receipt={state:after,proof:{authority:'server_readback',actorId:row.actorId,generation:2,build:'fixture',sessionStartedAt:i.bagSessionStartedAt,requestAt:now+1,at:now+2,rev:2}};
assert(mod.result(row,receipt,i));
const withStored={...row,target:{...row.target,before:{...row.target.before,storage:{gear:[{id:'existing',up:1,lk:1}]}}}};
const afterStored={...receipt,state:{...receipt.state,storage:{gear:[{id:'existing',lk:1,up:1},{id:'spare'}]}}};assert(mod.result(withStored,afterStored,i));
for(const change of [g=>g[0].up=0,g=>g[0].lk=0,g=>g.reverse(),g=>g[1].extra=1,g=>g[1].lk=1]){const r=structuredClone(afterStored);change(r.state.storage.gear);assert.equal(mod.result(withStored,r,i),null,'every pre-existing native storage entry and appended spare are preserved');}
const nativeIds={...receipt,state:{...after,bag:['protected']}};assert(mod.result({...row,target:{...row.target,before:{...s,bag:['spare','protected']}}},nativeIds,i),'native save stores IDs; local UI UID must not be claimed as a server instance ID');
for(const patch of [{authority:'server_accepted_save'},{generation:1},{build:'other'},{actorId:'other'},{requestAt:now-1},{rev:1}])assert.equal(mod.result(row,{...receipt,proof:{...receipt.proof,...patch}},i),null);
for(const change of [a=>a.coins--,a=>a.materials.Ore--,a=>a.bag.push({id:'other',uid:9}),a=>a.storage.gear.push({id:'other'}),a=>a.storage.gear[0].up=1,a=>a.equip.head='spare',a=>a.storeTier=1]){const a=structuredClone(after);change(a);assert.equal(mod.result(row,{...receipt,state:a},i),null);}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-storage-isolation-')),{DurableStore}=require('../src/runtime/durable-store'),store=new DurableStore(path.join(root,'ledger.db'));
try{const pending=store.begin({id:'move',actorId:row.actorId,session:row.session,generation:2,kind:'storage:gearDeposit',bill:{'gear-instance:7':1},available:{'gear-instance:7':1},target:row.target});store.sent(pending.id);store.recover(row.actorId);assert.equal(store.get('move').status,'UNCERTAIN');assert.throws(()=>store.begin({actorId:row.actorId,session:'session',generation:2,kind:'storage:gearDeposit',bill:{'gear-instance:7':1},available:{'gear-instance:7':1}}),/unreserved/);assert.equal(store.pending(row.actorId).length,1,'restart does not duplicate one piece');}finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
const native=require('../src/economy').loadCatalog(process.cwd(),JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build),cap=require('../src/knowledge/capability-registry').registry(native).storage;assert.equal(cap.state,'DISCOVERED');assert.equal(cap.contracts.gearDeposit.actionsEnabled,false);
assert.equal(require('../src/knowledge/client-contracts').extract('function stMove(){}').storage.state,'UNKNOWN');
const policyRoot=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-storage-policy-'));
try{fs.mkdirSync(path.join(policyRoot,'machines'));fs.mkdirSync(path.join(policyRoot,'logs/registry-keys'),{recursive:true});fs.writeFileSync(path.join(policyRoot,'machines/runtime-v32.json'),JSON.stringify({version:1,realm:'test',epoch:'test',epochEvidence:'fixture',policyRevision:1}));fs.writeFileSync(path.join(policyRoot,'machines/fleet.json'),JSON.stringify({leader:'Tester',members:[{machine:'windows',slot:0,charName:'Tester'}]}));const f=path.join(policyRoot,'logs/registry-keys/runtime-policy.json'),a='actor-'+'a'.repeat(32);fs.writeFileSync(f,JSON.stringify({version:1,host:'windows',isolatedStorageCanaryActors:[a]}));assert.deepEqual(require('../src/registry/registry').policy(policyRoot).isolatedStorageCanaryActors,[a]);fs.writeFileSync(f,JSON.stringify({version:1,host:'windows',isolatedStorageCanaryActors:[a,a]}));assert.throws(()=>require('../src/registry/registry').policy(policyRoot),/at most one/);fs.writeFileSync(f,JSON.stringify({version:1,host:'windows',isolatedStorageCanaryActors:['name'] }));assert.throws(()=>require('../src/registry/registry').policy(policyRoot),/verified actor/);}finally{fs.rmSync(policyRoot,{recursive:true,force:true});}
console.log('PASS W04/W10/T24-T30: closed-scope free deposit, exact native UID/readback, zero currency delta, ownership, claim/restart no replay; source discovery is not approval');

(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-deposit-flow-')),db=new DurableStore(path.join(tmp,'ledger.db')),storage=require('../src/runtime/personal-storage'),evidence=require('../src/runtime/capability-evidence'),read=storage.read,projection=evidence.projection,confirmed=evidence.confirmed;
 try{
  const owner=db.acquire({accountId:'fixture-account',actorId:i.actorIdentity.actorId,host:'fixture',session:'flow-session'});
  let clicks=0,gets=0;
  const a={...i,lastSaveAt:Date.now(),livePos:{room:'town',at:Date.now()},vitals:{hp:1,at:Date.now()},lastSave:{...structuredClone(s),bag:['spare','protected']},actorOwner:owner,socialInbox:{generation:2},registryV32:{store:db,policy:{isolatedStorageCanaryActors:[i.actorIdentity.actorId],isolatedStorageCanaryRunId:'12345678-1234-1234-1234-123456789012'}},v2:{...i.v2,scheduler:{checkpoint(){}}},planBag:async()=>({equip:[],give:[],keep:[]}),expeditionAuto:async()=>{},eval:async code=>{
   if(code.includes("n.api('/api/save')")){
    gets++;const at=Date.now()+1;a.serverSaveReceipt={state:structuredClone(a.lastSave),proof:{authority:'server_readback',actorId:a.actorIdentity.actorId,build:cat.build,generation:2,sessionStartedAt:a.bagSessionStartedAt,requestAt:at,at:at+1,rev:gets}};await new Promise(r=>setTimeout(r,3));return true;
   }
   assert(code.includes('go.click()'));const pending=db.pending(a.actorIdentity.actorId);assert.equal(pending.length,1);assert.equal(pending[0].status,'SENT','durable claim must precede native move');assert(code.includes('bag|7'),'exact UID is dispatched');clicks++;a.lastSave.bag.shift();a.lastSave.storage.gear.push({id:'spare'});return true;
  }};
  storage.read=async()=>({rows:[{id:'spare',key:'bag|7',upgraded:false,blocked:false}]});evidence.projection=()=>({storage:{revision:'checked',contracts:{gearDeposit:{state:'READY'}}}});evidence.confirmed=()=>true;
  const out=await storage.move(a,[{id:'spare'}]);assert.equal(out.confirmed,true);assert.equal(out.moved,1);assert.equal(out.evidence,'server_readback');assert.equal(clicks,1);assert.equal(gets,2);assert.equal(db.get(out.id).status,'CONFIRMED');assert.equal(db.pending(a.actorIdentity.actorId).length,0);assert.equal(old.status,'UNCERTAIN','unrelated payment unchanged');
  const again=await storage.move(a,[{id:'spare'}]);assert.equal(again.reason,'storage-isolation-one-attempt-per-run');assert.equal(clicks,1,'confirmed canary never deposits a second tile');
  a.registryV32.policy.isolatedStorageCanaryRunId='22345678-1234-1234-1234-123456789012';a.lastSave={...structuredClone(s),bag:['spare','spare']};a.catalog=()=>upgradeCat;a.planBag=async()=>copyPlan;
  const rawNative=fs.readFileSync('cache/'+native.build+'/asteria-online.io/asteria-online-visual-polish.html','utf8');assert(rawNative.includes("gearE(it.id, String(it.uid), !plainCopy(it)"));assert(rawNative.includes("const plainCopy = it => !!it && hasUp(it.id) && upCarrier(it.id) !== it.uid;"),'gu label includes uninvested primary copies');
  const originalEval=a.eval;a.eval=async code=>{if(code.includes('go.click()'))assert(code.includes('"gu:spare"'),'native carrier tip retained for exact UI instance');return originalEval(code);};
  storage.read=async()=>({rows:[{id:'spare',key:'bag|6',upgraded:true,blocked:false},{id:'spare',key:'bag|7',upgraded:true,blocked:false}]});
  const dup=await storage.move(a,copyPlan.store);assert(dup.confirmed);assert.equal(a.lastSave.bag.filter(x=>x==='spare').length,1);assert.equal(db.get(dup.id).target.retainedCopies,1);assert.equal(db.get(dup.id).target.uid,'7');assert.equal(clicks,2,'only surplus UI instance, required copy retained');
  const lost=structuredClone(a.serverSaveReceipt);lost.state.bag=[];assert.equal(mod.result(db.get(dup.id),lost,a),null,'a second concurrent loss cannot pass exact receipt');
  a.registryV32.policy.isolatedStorageCanaryActors=[];const off=await storage.move(a,[{id:'spare'}]);assert.equal(off.moved,0);assert.equal(clicks,2,'default OFF never dispatches');
 }finally{storage.read=read;evidence.projection=projection;evidence.confirmed=confirmed;db.close();fs.rmSync(tmp,{recursive:true,force:true});}
 console.log('PASS native adapter flow: canary/review, two GETs, claim before exact UI callback, receipt before release, historical payment retained and OFF gating');
})().catch(e=>{console.error(e);process.exitCode=1;});
