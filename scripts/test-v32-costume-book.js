'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const book=require('../src/runtime/costume-book'),{PowerState}=require('../src/observability/power-state'),{DurableStore}=require('../src/runtime/durable-store');
const by={wear:{id:'wear',slot:'chead',stats:{matk:10}},spare:{id:'spare',slot:'chead',stats:{matk:1}},better:{id:'better',slot:'chead',stats:{matk:50}}};
const world={PREMIUM_BY_ID:by,PREMIUM_SETS:{},COSTUME_BOOK:{piece:{chead:{st_int:1}}},costumeBookStats:ids=>ids.length?{st_int:ids.length}:{}};
const base={owned:['wear','spare','better'],book:[],worn:{chead:'wear'},boost:null};
assert.equal(book.plan(base,world,'mage').id,'spare','reserve best owned costume for wearing');
assert.equal(book.plan({...base,owned:['wear','better']},world,'mage').action,null,'do not book the best planned wear');
assert.equal(book.plan({...base,book:['better']},world,'mage',{withdraw:true}).action,'bookWithdraw');
assert.equal(book.plan({...base,book:['better']},world,'mage').action,'bookDeposit','withdrawal is independently OFF');
assert(!book.stateValid({...base,book:['wear']},world));assert(!book.stateValid({...base,book:['foreign']},world));
assert.equal(book.plan(base,{...world,costumeBookStats:()=>({st_int:NaN})},'mage').action,null);
assert.equal(require('../src/power-plan').ownedPremiumPlan(Object.values(by),{...base,book:['better']},'mage',world).items.length,0,'booked piece must not dispatch impossible wear');
const native=require('../src/economy').loadCatalog(process.cwd(),JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build),raw=fs.readFileSync('cache/'+native.build+'/asteria-online.io/asteria-online-visual-polish.html','utf8'),client=require('../src/knowledge/client-contracts'),original=client.extract(raw);
assert.equal(original.collection.state,'DISCOVERED');assert(raw.includes("twoTap('bk:' + b.dataset.pbk, () => NET.social('prbook'"));
for(const change of [raw.replace("NET.social('prbook'","NET.social('changedBook'"),raw.replace('const twoTap = (key, go) =>','const twoTap = (key, changed) =>'),raw.replace('function premCard(it)','function changedCard(it)')])assert.notEqual(client.extract(change).collection.revision,original.collection.revision,'native deposit/withdraw/two-tap/render changes invalidate review');
assert.equal(client.extract(raw+'\n'+client.bookCallbacks(raw)[1]).collection.state,'UNKNOWN','duplicate callback is not reviewed');
const observer=new PowerState(),now=Math.floor(Date.now()/1000)*1000+937;observer.reset(2);
const identity={actorId:'actor-fixture'},i={actorIdentity:identity,actorOwner:{session:'session'},socialInbox:{generation:2,power:observer}};
observer.receive({t:'prem',...base,coins:937,token:'private-token'},now);
assert(observer.bookView(i,now));assert.equal(observer.bookView(i,now).coins,937);
const publicObserver=JSON.parse(JSON.stringify(observer));
assert(String(publicObserver.premium.at).includes('937'),'privacy check permits timestamps containing wallet digits');
function noPrivateWallet(value){if(value&&typeof value==='object'){for(const [key,child]of Object.entries(value)){assert(!['coins','token'].includes(key),'private wallet fields cannot be public');noPrivateWallet(child);}}else{assert.notEqual(value,937);assert.notEqual(value,'private-token');}}
noPrivateWallet(publicObserver);
const exposed=observer.bookView(i,now);exposed.state.book.push('foreign');assert.equal(observer.bookView(i,now).state.book.length,0);
assert.equal(observer.bookView({...i,socialInbox:{generation:3,power:observer}},now),null);
assert.equal(observer.bookView(i,now+16000),null);assert.equal(observer.bookView(i,now+14000),null,'wall clock jump is not fresh monotonic evidence');
observer.receive({t:'prem',...base},now);assert.equal(observer.bookView(i,now),null,'missing private wallet cannot reuse an older baseline');
observer.receive({t:'prem',...base,coins:937},now);observer.reset(3);assert.equal(observer.bookView(i,now),null);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-book-'));
(async()=>{
 const store=new DurableStore(path.join(tmp,'ledger.db')),evidence=require('../src/runtime/capability-evidence'),oldProject=evidence.projection,oldConfirmed=evidence.confirmed;
 try{
  const owner=store.acquire({accountId:'fixture-account',actorId:identity.actorId,host:'fixture',session:'session'}),power=new PowerState();power.reset(2);
  const state=structuredClone(base);let coins=937,clicks=0,queries=0,opened=0,closed=0,blocked=false,body;
  const a={root:tmp,...i,actorOwner:owner,catalog:()=>({build:'fixture',items:{},world}),page:{},buildHash:'fixture',lastSave:{job:'mage'},lastSaveAt:Date.now(),livePos:{room:'town',at:Date.now()},vitals:{hp:1,at:Date.now()},socialInbox:{generation:2,power},v2:{sourceCoherence:{matches:true},journal:{rows:[]},scheduler:{checkpoint(){},validate(c){const r=c.validate(Date.now());if(!r.allowed)throw Error(r.reason);}}},registryV32:{store,policy:{policyRevision:1,costumeBookCanaryActors:[identity.actorId],costumeBookCanaryRunId:'12345678-1234-1234-1234-123456789012'}},expeditionAuto:async()=>{},openGamePanel:async()=>{opened++;body=makeBody(false);power.receive({t:'prem',...state,coins});return true;},closeGamePanel:async()=>{closed++;},socialSend:async()=>{queries++;power.receive({t:'prem',...state,coins});return {ok:true};}};
  function makeBody(armed){const button={dataset:{pbk:'spare',on:'1'},disabled:false,click(){clicks++;const row=store.pending(identity.actorId)[0];assert.equal(row.status,'SENT','claim is durable before BOTH taps');if(!armed){body=makeBody(true);return;}state.book.push('spare');power.receive({t:'prem',...state,coins});}};return {dataset:{panel:'premium'},querySelector:s=>s==='[data-pt="costume"]'?{click(){body=makeBody(false);}}:null,querySelectorAll:()=>[button]};}
  a.eval=async code=>vm.runInNewContext(code,{window:{AsteriaNet:{isConnected:()=>true,get block(){return blocked;},pause:false,fixed:false,kicked:false}},document:{getElementById:()=>body}});
  evidence.projection=()=>({collection:{revision:'reviewed',contracts:{bookDeposit:{state:'READY'},bookWithdraw:{state:'READY'}}}});evidence.confirmed=()=>true;
  a.bagSessionStartedAt=Date.now()-60000;assert(book.gate(a).allowed);
  const historical={id:'closed-gear',at:Date.now()-180000,kind:'craft',status:'UNCERTAIN',target:{id:'old-gear'},before:{equip:{weapon:'old-gear'}}};
  assert(book.gate({...a,v2:{...a.v2,journal:{rows:[historical]}}}).allowed,'closed unrelated gear intent does not block zero-cost owned costume');assert.equal(historical.status,'UNCERTAIN','old monetary result is preserved');
  for(const patch of [{kind:'unknown'},{kind:'purchase',target:{item:'Premium Currency'}},{at:Date.now()},{target:{id:'spare'}}])assert(!book.gate({...a,v2:{...a.v2,journal:{rows:[{...historical,...patch}]}}},Date.now(),'spare').allowed,'current, unknown and overlapping pending work remains fenced');
  for(const patch of [{teamControl:true},{dailyTeamPending:true},{pendingTravel:{}},{survivalRecovery:{}},{socialInbox:{...a.socialInbox,criticalGap:true}},{lastSaveAt:Date.now()-31000},{endgameCampaign:{ready:true,phase:'wing'}},{v2:{...a.v2,objective:{next:{kind:'craft',ready:true}}}},{freeRewards:{status:'uncertain_no_replay'}}])assert(!book.gate({...a,...patch}).allowed,'foreground, health, gap and uncertainty retain priority');
  const off=await book.execute({...a,registryV32:{...a.registryV32,policy:{}}});assert.equal(off.sent,false);assert.equal(queries,0,'OFF does not even query or open a panel');
  const out=await book.execute(a);assert(out.confirmed);assert.equal(clicks,2);assert.equal(queries,3,'baseline follows native panel query before after-state query');assert.equal(opened,1);assert.equal(closed,1);assert.equal(store.get(out.id).status,'CONFIRMED');assert.equal(store.pending(identity.actorId).length,0);assert.equal(coins,937);
  const row=store.get(out.id),after=power.bookView(a);assert(book.result(row,after,a));
  assert.equal(book.result({...row,contractRevision:'changed-rules'},after,a),null,'same build but changed native domain cannot confirm');
  for(const mutate of [r=>r.coins--,r=>r.state.owned.push('foreign'),r=>r.state.worn.chead='better',r=>r.state.book.push('better'),r=>r.sequence=row.target.beforeSequence,r=>r.generation=1,r=>r.actorId='foreign',r=>r.authority='outgoing_save',r=>r.at=row.sentAt-1]){const r=structuredClone(after);mutate(r);assert.equal(book.result(row,r,a),null,'only exact native ownership/book/wallet delta is confirmation');}
  const withdrawRow={...row,kind:'collection:bookWithdraw',target:{...row.target,on:0,id:'better',before:{...base,book:['better']},beforeSequence:1}},withdrawAfter={...after,state:{...base,book:[]},sequence:3};const withdrawn=book.result(withdrawRow,withdrawAfter,a);assert(withdrawn.requiresSeparateWearReceipt);assert(!withdrawn.measuredCombatBenefit);
  const again=await book.execute(a);assert.equal(again.reason,'book-one-attempt-per-run');assert.equal(clicks,2);
  a.registryV32.policy.costumeBookCanaryRunId='22345678-1234-1234-1234-123456789012';state.book=[];
  const savedEval=a.eval;a.eval=async code=>{if(code.includes('const a=find()'))throw Error('lost context');return savedEval(code);};
  const uncertain=await book.execute(a);assert.equal(uncertain.confirmed,false);assert.equal(store.get(uncertain.id).status,'UNCERTAIN');assert.equal(store.pending(identity.actorId).length,1);store.recover(identity.actorId);assert.equal((await book.execute(a)).reason,'book-one-attempt-per-run');assert.equal(clicks,2,'timeout/restart never redispatches');
  a.eval=savedEval;blocked=true;assert.equal(await book.dispatch(a,{id:'spare',on:1}),false);assert.equal(clicks,2,'server correction block prevents callback');
  const root2=path.join(tmp,'policy');fs.mkdirSync(path.join(root2,'machines'),{recursive:true});fs.mkdirSync(path.join(root2,'logs/registry-keys'),{recursive:true});fs.writeFileSync(path.join(root2,'machines/runtime-v32.json'),JSON.stringify({version:1,realm:'r',epoch:'e',epochEvidence:'fixture',policyRevision:1}));fs.writeFileSync(path.join(root2,'machines/fleet.json'),JSON.stringify({leader:'Tester',members:[{machine:'windows',slot:0,charName:'Tester'}]}));const policyFile=path.join(root2,'logs/registry-keys/runtime-policy.json'),actor='actor-'+'a'.repeat(32);
  for(const patch of [{costumeBookCanaryActors:[actor,actor]},{costumeBookCanaryActors:['name']},{costumeBookCanaryRunId:'------------------------------------'},{costumeBookCanaryWithdraw:'yes'}]){fs.writeFileSync(policyFile,JSON.stringify({version:1,host:'windows',...patch}));assert.throws(()=>require('../src/registry/registry').policy(root2),/Costume book/);}
  const cap=require('../src/knowledge/capability-registry').registry(native);assert.equal(cap.collection.contracts.bookDeposit.state,'DISCOVERED');assert.equal(cap.collection.actionsEnabled,false);
  console.log('PASS W12/T77-T83: native rule bonus-loss comparison, owned/book wear fence, private wallet, exact two-tap redraw, durable-before-send, native receipt only, current owner/foreground/clock/patch/uncertainty and default OFF');
 }finally{evidence.projection=oldProject;evidence.confirmed=oldConfirmed;store.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
