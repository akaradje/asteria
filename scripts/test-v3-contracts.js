'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {ActionScheduler}=require('../src/runtime/action-scheduler'),{contract}=require('../src/runtime/action-contract');
const {ResourceReservations}=require('../src/planning/resource-reservations'),{ActionJournal}=require('../src/runtime/action-journal'),{Observations}=require('../src/state/observations');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-v3-contracts-'));try{
 let now=1000000,release;const i={page:{},buildHash:'b1',lastSaveAt:now,livePos:{at:now}},scheduler=new ActionScheduler({now:()=>now,maxQueued:1});
 const active=scheduler.run('hold',()=>new Promise(r=>release=r));let sent=0;
 const queued=scheduler.run('paid',()=>sent++,{contract:contract(i,'paid',{now:()=>now})});const rejection=assert.rejects(queued,/session or build/);
 await assert.rejects(scheduler.run('overflow',()=>sent++),/capacity/);i.page={};release();await active;await rejection;assert.equal(sent,0,'changed generation cannot send queued mutation');
 await assert.rejects(scheduler.run('old',()=>sent++,{contract:{deadline:now-1}}),/expired/);assert.equal(sent,0);
 for(const reason of ['fresh_save_required','fresh_position_required']){
  let rejected;try{scheduler.validate({deadline:now+1000,validate:()=>({allowed:false,reason})});}catch(e){rejected=e;}
  assert.equal(rejected.code,'ASTERIA_STALE_PRECONDITION');assert.equal(rejected.reason,reason);
  const {GameInstance}=require('../src/instance');let ticks=0;
  const actor={status:'playing',livePos:{room:'town'},tick:async()=>{if(++ticks===1)throw rejected;actor.status='stopped';return 'resumed';},captureFrame:async()=>{},log:()=>{}};
  const pending={status:'UNCERTAIN'};actor.developmentLedger=pending;
  await GameInstance.prototype.run.call(actor,{tickMs:1});assert.equal(ticks,2,'freshness race resumes same actor instead of supervisor respawn');assert.equal(actor.developmentLedger,pending,'uncertain payment journal never cleared');
 }
 const fatal={status:'playing',livePos:{room:'town'},tick:async()=>{throw Error('actual browser failure');},log:()=>{}};
 await assert.rejects(require('../src/instance').GameInstance.prototype.run.call(fatal),/actual browser failure/,'real controller errors retain recovery path');
 i.page={};const nestedContract=contract(i,'nested',{now:()=>now});await assert.rejects(scheduler.run('outer',()=>scheduler.run('inner',async()=>{await Promise.resolve();i.page={};scheduler.checkpoint();sent++;},{contract:nestedContract})),/session or build/);assert.equal(sent,0,'nested checkpoint revalidates after await');
 const chain=contract(i,'chainWalkTo',{now:()=>now}),paid=contract(i,'paid',{now:()=>now}),start=now;
 now+=180001;i.lastSaveAt=now;i.livePos.at=now;
 scheduler.validate(chain);assert.throws(()=>scheduler.validate(paid),/expired/,'paid action retains short dispatch deadline');
 i.livePos.at=now-10001;assert.throws(()=>scheduler.validate(chain),/fresh_position/,'long chain cannot continue on stale position');
 i.livePos.at=now;i.page={};assert.throws(()=>scheduler.validate(chain),/session or build/,'long chain cannot survive page replacement');
 now=start+900000;assert.throws(()=>scheduler.validate(chain),/expired/,'native route remains hard bounded');
 i.lastSaveAt=now;i.livePos.at=now;
 const r=new ResourceReservations(root,'actor');assert(r.reserve('first',{Ore:5},{Ore:5},{build:'b1',at:now}).ok);r.started('first');
 assert.equal(r.reserve('patch',{Ore:1},{Ore:5},{build:'b2',at:now+1}).ok,false,'build change cannot free uncertain ownership');
 const restarted=new ResourceReservations(root,'actor');assert.equal(restarted.data.claims[0].status,'UNCERTAIN');restarted.expire(now+999999);assert.equal(restarted.totals('b9').Ore,5);restarted.finish('first','CONFIRMED');assert(restarted.reserve('fresh',{Ore:5},{Ore:5},{build:'b2'}).ok);
 const j=new ActionJournal(root,'actor');const uncertain=j.begin('purchase',{item:'p1'},{},now,'b1');uncertain.status='UNCERTAIN';j.save();
 for(let n=0;n<150;n++){const row=j.begin('purchase',{item:'p'+(n+2)},{},now+n+1,'b1');j.sent(row,{ok:false});}
 assert(j.rows.some(r=>r.id===uncertain.id));j.importLedger(Array.from({length:160},(_,n)=>({id:'l'+n,kind:'craft',target:{},status:'pending',at:now+n})),'b2');assert.equal(j.rows.filter(r=>r.status==='WAITING_CONFIRMATION').length,160,'retention cannot lose unresolved payments');
 fs.writeFileSync(j.file,'broken');assert.throws(()=>new ActionJournal(root,'actor'),/unreadable/);
 const o=new Observations({build:'b',now:()=>now});assert(o.observe('save',{},now,'native'));assert(!o.observe('save',{},now,'duplicate'));assert(!o.observe('save',{},now-1,'late'));assert(!o.observe('fps',10,now+1,'future'));assert.equal(o.fields.save.receivedAt,now);assert.equal(o.fields.save.eventId,o.sessionId+':1');
 const domains=require('../src/knowledge/domain-contracts');assert.equal(domains.compare({routes:'a'},{routes:'a'}).travel.state,'compatible');assert.equal(domains.compare({routes:'a'},{routes:'b'}).travel.state,'review_required');assert.equal(domains.compare({},{}).craft.state,'unknown');assert(!domains.compare({routes:'a'},{routes:'a'}).travel.authorizesActions);
 const projection=require('../src/runtime/v3-projection').project({at:now,credentials:{password:'hidden'},experiments:{rows:[{status:'running',file:'private',password:'hidden'}]}});assert(!JSON.stringify(projection).includes('hidden'));assert(!JSON.stringify(projection).includes('private'));
 const bridge=fs.readFileSync(path.join(__dirname,'vps-panel-bridge.py'),'utf8');assert(bridge.includes("'runtimeGeneration':((r.get('runtimeV2') or {}).get('stateFreshness')"),'VPS helper generation must be copied from the native observer');assert(bridge.includes("{'purchases','sourceCoherence','learningRevision','scheduler'}"),'remote proof uses allowlist, never full private runtime');
 const cp=require('child_process'),config=require('../machines/fleet.json');fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'machines'));fs.mkdirSync(path.join(root,'logs/fleet'),{recursive:true});fs.copyFileSync(path.join(__dirname,'fleet-exchange.py'),path.join(root,'scripts/fleet-exchange.py'));fs.writeFileSync(path.join(root,'machines/fleet.json'),JSON.stringify(config));fs.writeFileSync(path.join(root,'logs/fleet/local.json'),JSON.stringify({machine:'tum',at:Date.now(),members:[]}));
 const payload={machine:'windows',at:Date.now(),build:'fixture',members:config.members.filter(r=>r.machine==='windows').map(r=>({slot:r.slot,charName:r.charName,runtimeGeneration:o.sessionId,status:'playing',lastSaveAt:Date.now()}))};
 const exchange=value=>cp.spawnSync(process.platform==='win32'?'python':'python3',[path.join(root,'scripts/fleet-exchange.py'),require('../src/runtime/fleet-transport').encodeCompressed(value)],{encoding:'utf8',timeout:10000});
 let wire=exchange(payload);assert.equal(wire.status,0,wire.stderr);assert.equal(require('../src/runtime/fleet-transport').decode(wire.stdout).machine,'tum','actual bridge accepts generation');
 wire=exchange({...payload,members:[{...payload.members[0],runtimeGeneration:'bad/generation'}]});assert.notEqual(wire.status,0,'bridge rejects malformed generation');
 console.log('PASS V3 dispatch generation/queue bounds/expiry, durable restart and patch reservations, unresolved retention, corrupt storage, duplicate/out-of-order events, domain gates and public allowlist');
 }finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
