'use strict';
const assert=require('assert/strict');
const {stalledRenderer}=require('../src/runtime/renderer-health');
const {GameInstance}=require('../src/instance');
const {Supervisor}=require('../src/supervisor');
async function main(){
 const now=1000000;
 const instance={startedAt:now-600000,lastSaveAt:now-200000,livePos:{at:now,room:'town'},v2:{lastScreenAt:now-200000,observation:{at:now-200000}},rendererHealth:{lastSuccessAt:now-200000,consecutiveTimeouts:3,firstTimeoutAt:now-150000,lastTimeoutAt:now-10000}};
 assert.equal(stalledRenderer(instance,now),true,'fresh socket frames do not hide renderer freeze');
 for(const update of [{consecutiveTimeouts:2},{lastSuccessAt:now},{firstTimeoutAt:now-60000},{lastTimeoutAt:now-100000}]){
  assert.equal(stalledRenderer({...instance,rendererHealth:{...instance.rendererHealth,...update}},now),false);
 }
 assert.equal(stalledRenderer({...instance,lastSaveAt:now},now),false,'fresh save prevents disruptive recovery');
 assert.equal(stalledRenderer({...instance,v2:{lastScreenAt:now}},now),false,'fresh screen prevents recovery');
 const actor={page:{evaluate:()=>new Promise(()=>{})},evalTimeoutMs:5};
 await assert.rejects(GameInstance.prototype.eval.call(actor,'1'),/timed out/);
 assert.equal(actor.rendererHealth.consecutiveTimeouts,1);
 await assert.rejects(GameInstance.prototype.eval.call(actor,'1'),/context must close/);
 assert.equal(actor.rendererHealth.consecutiveTimeouts,1,'fenced page is never evaluated again');
 actor.page={evaluate:async()=>42};
 assert.equal(await GameInstance.prototype.eval.call(actor,'1'),42);
 assert.equal(actor.rendererHealth.consecutiveTimeouts,0,'successful page evaluation clears failure streak');
 let finish;actor.page.evaluate=()=>new Promise(r=>{finish=r;});
 const pending=GameInstance.prototype.eval.call(actor,'1');await new Promise(r=>setImmediate(r));
 actor.page={evaluate:async()=>43};finish(42);await pending;
 assert.equal(actor.rendererHealth.consecutiveTimeouts,0,'old page result cannot change new page health');
 const closed=[],events=[];
 const slot=(n,room='town')=>({...instance,slot:n,status:'playing',livePos:{at:now,room},v2:{...instance.v2,
  scheduler:{view:()=>({active:{overdue:false}})},recovery:{begin:(kind,reason)=>{const e={kind,reason};events.push(e);return e;},save:()=>{},finish:()=>{}}},ctx:{close:async()=>{closed.push(n);}}});
 const farm={instances:[slot(0,'tw#1'),slot(1),slot(2)],log:()=>{}};
 Supervisor.prototype.checkSlotHealth.call(farm,now);await new Promise(r=>setImmediate(r));
 assert.deepEqual(closed,[1],'protect dungeon and recover only one unhealthy context');
 assert.match(events[0].reason,/socket position/);
 Supervisor.prototype.checkSlotHealth.call(farm,now+10000);await new Promise(r=>setImmediate(r));
 assert.equal(closed.length,1,'farm-wide ninety-second recovery cooldown');
 const fullyFrozen=n=>{const i=slot(n);delete i.rendererHealth;i.livePos.at=now-200000;i.v2.scheduler={view:()=>({active:{overdue:true}})};return i;};
 const protectedGuild=fullyFrozen(3);protectedGuild.lastSave={mapId:'gd#1'};
 const frozenFarm={instances:[protectedGuild,fullyFrozen(4),fullyFrozen(5)],log(){}};
 Supervisor.prototype.checkSlotHealth.call(frozenFarm,now);await new Promise(r=>setImmediate(r));
 assert.deepEqual(closed,[1,4],'fully frozen path also protects guild runs and closes only one actor');
 Supervisor.prototype.checkSlotHealth.call(frozenFarm,now+10000);assert.deepEqual(closed,[1,4],'fully frozen path shares the recovery cooldown');
 let purged=0;
 const busyFarm={instances:[{status:'playing',v2:{scheduler:{view:()=>({active:{kind:'tick'}})}},purgeMemory:async()=>{purged++;}}],log:()=>{}};
 assert.equal(await Supervisor.prototype.purgeRound.call(busyFarm,'test'),false);
 assert.equal(purged,0,'busy renderer is skipped instead of queuing GC behind navigation');
 assert.equal(busyFarm.purgeRoundBusy,false,'memory governor is released immediately');
 console.log('PASS timeout detection independent of socket positions; fresh evidence resets; one-context recovery/dungeon protection/cooldown; busy GC does not wedge memory governor');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
