'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const paid=require('../src/runtime/paid-actions'),runtime=require('../src/runtime/development-progress');
const {ResourceReservations}=require('../src/planning/resource-reservations'),{ActionScheduler}=require('../src/runtime/action-scheduler'),{GameInstance}=require('../src/instance');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-paid-progress-'));
const cat={build:'test',world:{MAX_LV:120,REFINE:{max:10,chance:[100,100,100,70,60,50,40,30,20,10],cost:()=>175,ore:()=>'Ore',need:()=>1}},items:{w:{id:'w',name:'Weapon',slot:'weapon',tier:6,rarity:'legendary',stats:{atk:100}},wing:{id:'wing',slot:'wing',stats:{}}}};
require('../src/equipment-goal').configure(cat,{enabled:true,rarity:'legendary',refine:10,top10Progression:true,bridgeOwned:true});
function actor(id){const now=Date.now();return {root,slot:id,catalog:()=>cat,lastSaveAt:now,lastSave:{lv:120,job:'asura',coins:100000,materials:{Ore:1},pets:{pet:0},petActive:'pet',equip:{weapon:'w',wing:'wing'},refine:{}},livePos:{room:'town',at:now},endgameCampaign:{phase:'complete'},autoChores:true,vitals:{hp:1,at:now},v2:{scheduler:new ActionScheduler(),reservations:new ResourceReservations(root,'actor-'+id),sourceCoherence:{matches:true}},canDo:()=>true};}
class PaidActor{}
PaidActor.prototype.refineEquipped=GameInstance.prototype.refineEquipped;
paid.installPaidActions(PaidActor);
async function main(){
 const i=actor(0),r=i.v2.reservations;
 assert(runtime.refineOpportunity(i),'native resources can fund a first step');
 r.reserve('old',{Ore:1},{Ore:1},{build:'previous'});r.started('old');r.finish('old','UNCERTAIN');
 assert.equal(runtime.refineOpportunity(i),null,'planner never travels for ore already held by an unknown old payment');
 assert.equal(paid.preflight(i,'refineEquipped',[{targetId:'w',guaranteedOnly:true}]).missing[0].name,'Ore');
 i.lastSave.materials.Ore=2;assert(runtime.refineOpportunity(i),'new surplus can progress without clearing old evidence');
 i.lastSave.petActive=null;Object.setPrototypeOf(i,PaidActor.prototype);
 assert.equal((await i.refineEquipped({targetId:'w',guaranteedOnly:true})).reservationNotSent,true);
 assert.equal(r.data.claims.at(-1).status,'CANCELLED','only explicit current pre-dispatch rejection releases its own claim');
 assert.equal(r.data.claims[0].status,'UNCERTAIN','historical unknown is never erased');assert.equal(r.totals().Ore,1);
 const j=actor(1);Object.setPrototypeOf(j,PaidActor.prototype);
 j.openTownService=async()=>({ok:true});let clicks=0;
 j.eval=async()=>{clicks++;const durable=JSON.parse(fs.readFileSync(j.v2.reservations.file));assert.equal(durable.claims[0].transactionId,j.developmentLedger.rows[0].id,'ledger link persisted before native dispatch');throw Error('native transport lost after dispatch');};
 await assert.rejects(()=>j.refineEquipped({targetId:'w',guaranteedOnly:true}),/transport lost/);
 assert.equal(clicks,1);assert.equal(j.v2.reservations.data.claims[0].status,'UNCERTAIN');
 const restored=new ResourceReservations(root,'actor-1');assert.equal(restored.data.claims[0].transactionId,j.developmentLedger.rows[0].id,'restart retains exact outcome correlation');
 assert.equal((await j.refineEquipped({targetId:'w',guaranteedOnly:true})).refined,0);assert.equal(clicks,1,'unresolved native outcome cannot be sent twice');
 assert.equal(j.developmentLedger.rows[0].dispatchTracking.state,'possible','native evaluation has a durable possible-send boundary');
 const noSend=actor(30);Object.setPrototypeOf(noSend,PaidActor.prototype);noSend.openTownService=async()=>{throw Error('NPC route cancelled before payment');};
 await assert.rejects(()=>noSend.refineEquipped({targetId:'w',guaranteedOnly:true}),/NPC route/);
 assert.equal(noSend.developmentLedger.rows[0].status,'not_sent');assert.equal(noSend.developmentLedger.rows[0].evidence,'failed_before_native_payment_dispatch');assert.equal(noSend.v2.reservations.data.claims[0].status,'CANCELLED');assert(!noSend.developmentLedger.blocking('refine'));
 const recovery=require('../src/runtime/paid-outcome-recovery'),scope=require('../src/runtime/refine-scope'),{ResultLedger}=require('../src/result-ledger');let serial=0;
 function recoveryActor(){
  const n=Date.now(),i=actor(40+serial++);i.lastSave.bag=[];i.actorIdentity={actorId:'actor-'+'a'.repeat(32)};i.socialInbox={generation:0};i.bagSessionStartedAt=n-800000;i.status='playing';i.page={};
  const ledger=i.developmentLedger=new ResultLedger(root,'recovery-'+serial);ledger.context={actorId:i.actorIdentity.actorId,build:cat.build,sessionStartedAt:i.bagSessionStartedAt,generation:0,baselineRev:10};ledger.expectedCost={Copper:175,Ore:1};ledger.costCatalog=cat;
  const row=ledger.begin('refine',{id:'w'},i.lastSave,n-700000);i.acceptedSaveReceipt={state:i.lastSave,proof:{authority:'server_accepted_save',actorId:i.actorIdentity.actorId,build:cat.build,sessionStartedAt:i.bagSessionStartedAt,generation:0,rev:11,requestAt:n-1,at:n}};
  i.recycle=async()=>true;return {i,row,n};
 }
 for(const patch of [{autoChores:false},{status:'stopping'},{teamControl:true},{dailyTeamPending:true},{dailyWorkStatus:{ownsNavigation:true}},{tickBusy:true},{choresBusy:true},{fleetActivityBusy:true},{pendingTravel:{}},{recycling:true},{healthRecovery:true},{survivalRecovery:true},{pvpMission:{}},{nativeFreshSaveFlight:{}},{livePos:{room:'gd#1',at:Date.now()}},{livePos:{room:'town',at:Date.now()-11000}},{lastSaveAt:Date.now()-31000},{teamTradeStatus:{phase:'UNCERTAIN'}},{activityState:{gd:{run:{id:'active',done:false}}}}]){const {i}=recoveryActor();Object.assign(i,patch);assert.equal(recovery.inspect(i).state,'waiting',JSON.stringify(patch));}
 for(const proofPatch of [{actorId:'actor-'+'b'.repeat(32)},{build:'old'},{rev:10},{generation:1},{at:Date.now()-31000},{requestAt:Date.now()+10000}]){const {i}=recoveryActor();Object.assign(i.acceptedSaveReceipt.proof,proofPatch);assert.equal(recovery.inspect(i).state,'waiting');}
 {const {i,row,n}=recoveryActor();row.at=n-599999;assert.equal(recovery.inspect(i,n).state,'idle');row.at=n-700000;i.v2.scheduler.active={kind:'tick'};assert.equal(recovery.inspect(i,n).state,'waiting');i.v2.scheduler.active=null;i.v2.scheduler.queue=[{kind:'fleet-OPENING'}];assert.equal(recovery.inspect(i,n).state,'waiting');}
 const {i:recovered,row:oldRow}=recoveryActor();let recoveredCalls=0;const originalId=oldRow.id,originalBefore=JSON.stringify(oldRow.before);
 recovered.recycle=async()=>{recoveredCalls++;assert.equal(oldRow.status,'unresolved');assert(oldRow.executorRecovery.attempted);assert.equal(recovered.status,'recycling');recovered.page={};const now=Date.now();recovered.bagSessionStartedAt=now;recovered.socialInbox.generation=1;
  const proof={authority:'server_readback',actorId:recovered.actorIdentity.actorId,build:cat.build,sessionStartedAt:now,generation:1,rev:12,requestAt:now,at:now+1};assert(recovered.developmentLedger.reconcileRefineState(recovered.lastSave,proof,cat));recovered.status='playing';return true;};
 assert.equal(await recovery.tick(recovered),'awaiting_native_reconciliation');assert.equal(recoveredCalls,1);assert.equal(oldRow.id,originalId);assert.equal(JSON.stringify(oldRow.before),originalBefore);assert.equal(oldRow.status,'reconciled_refine_state');assert.equal(oldRow.reconciliation.historicalSuccessKnown,false);assert.equal(oldRow.reconciliation.costKnown,false);assert.equal(oldRow.serverReceipt,undefined);
 assert(scope.blocks(recovered,'w'),'same unknown target/level cannot be rolled again after budget rebase');
 assert(!paid.preflight(recovered,'refineEquipped',[{targetId:'w',guaranteedOnly:true}]).allowed,'town payment preflight obeys exact unknown-step fence too');
 recovered.v2.journal={rows:[]};assert(!scope.blocks(recovered,'another-item'),'different target is independent');recovered.lastSave.refine.w=1;assert(!scope.blocks(recovered,'w'),'a higher actual level is a different step');assert(oldRow.reconciliation.replayBlocked);
 await recovery.tick(recovered);assert.equal(recoveredCalls,1,'same original payment cannot trigger recovery repeatedly');
 const {i:failedRecovery,row:failedRow}=recoveryActor();let failedCalls=0;failedRecovery.recycle=async()=>{failedCalls++;return false;};assert.equal(await recovery.tick(failedRecovery),'recovery_not_confirmed');assert.equal(failedRecovery.status,'playing');await recovery.tick(failedRecovery);assert.equal(failedCalls,1);assert.equal(failedRow.status,'unresolved');

 // A lost queued contract before the tracked native ledger wrapper cannot
 // consume resources. An arbitrary/untracked implementation remains unknown.
 for(const tracked of [true,false]){
  class BeforeLedger{async refineEquipped(){throw Error('connection generation changed while queued');}}
  BeforeLedger.prototype.refineEquipped.paidDispatchTracked=tracked;paid.installPaidActions(BeforeLedger);
  const a=actor(100+Number(tracked));Object.setPrototypeOf(a,BeforeLedger.prototype);
  await assert.rejects(()=>a.refineEquipped({targetId:'w',guaranteedOnly:true}),/generation changed/);
  const claim=a.v2.reservations.data.claims.at(-1);assert.equal(claim.status,tracked?'CANCELLED':'UNCERTAIN');
  assert.equal(claim.transactionId,undefined);const restored=new ResourceReservations(root,'actor-'+(100+Number(tracked)));assert.equal(restored.data.claims.at(-1).status,claim.status);
 }
 class Possible{async refineEquipped(){this.v2.reservations.markDispatch(this.activeResourceClaim.id);throw Error('native outcome lost');}}
 Possible.prototype.refineEquipped.paidDispatchTracked=true;paid.installPaidActions(Possible);const possible=actor(103);Object.setPrototypeOf(possible,Possible.prototype);
 await assert.rejects(()=>possible.refineEquipped({targetId:'w',guaranteedOnly:true}),/outcome lost/);assert.equal(possible.v2.reservations.data.claims.at(-1).status,'UNCERTAIN');
 const early=recoveryActor();early.row.status='spent_without_change';early.i.bagSessionStartedAt=early.row.at+42000;early.i.acceptedSaveReceipt.proof.sessionStartedAt=early.i.bagSessionStartedAt;
 assert.equal(recovery.inspect(early.i).state,'recoverable','early reconnect permits one idle executor close, without replay');
 early.i.bagSessionStartedAt=early.row.context.sessionStartedAt-1;assert.equal(recovery.inspect(early.i).state,'waiting','session cannot move backward');
 const oldClaim=r.data.claims[0];assert.equal(r.cancelPreparation(oldClaim.id),false,'historical untracked resources stay held');
 const k=actor(2);k.lastSave.lv=119;k.lastSave.exp=0;k.livePos.room='field';k.expeditionAuto=async()=>{throw Error('night training diverted');};
 assert.equal(await runtime.tick(k,{}, {townOnly:true}),null,'overdue training does not create extra travel');
 k.livePos.room='town';k.screen=async()=>({hp:'100 / 100'});k.expeditionAuto=async()=>{};k.closeGamePanel=async()=>{};k.refineEquipped=async()=>{k.lastSave.refine.w=1;k.lastSaveAt=Date.now()+1;return {refined:1};};
 assert.match(await runtime.tick(k,{}, {townOnly:true}),/change_observed/,'existing town visit can confirm one guaranteed under-cap improvement');
 k.lastSave.refine.w=0;k.teamControl=true;k.refineEquipped=async()=>{throw Error('team interrupted');};assert.equal(await runtime.tick(k,{}, {townOnly:true}),null,'team ownership remains ahead of optional upgrade');
 console.log('PASS shared durable budget, surplus-only progression, exact no-send cancellation, pre-dispatch durable ledger link, restart no replay and bounded night-town development');
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1;});
