'use strict';
const assert=require('assert/strict');
const {Supervisor}=require('../src/supervisor');
const {maintenanceBlock}=require('../src/runtime/memory-maintenance');
const idle=()=>({slot:0,status:'playing',livePos:{room:'town'},lastSave:{mapId:'town'}});
async function main(){
 let free=1200,spawns=0,purges=0,release;
 const farm=Object.assign(Object.create(Supervisor.prototype),{instances:[],deferred:[2],serialBoot:true,windowCostMb:900,minFreeMb:600,
   freeMb:()=>free,log(){},spawn:async()=>{spawns++;},maybePurgeFor:async()=>{purges++;await new Promise(r=>{release=r;});}});
 const admission=farm.launchDeferred();await farm.launchDeferred();await farm.ramGovernor(100);
 assert.equal(purges,1,'one reclaim across concurrent admission/governor passes');assert.equal(spawns,0);
 free=1700;release();await admission;assert.equal(spawns,1);assert.deepEqual(farm.deferred,[]);
 farm.deferred=[1];free=1200;farm.maybePurgeFor=async()=>false;await farm.launchDeferred();
 assert.equal(spawns,1);assert.equal(farm.admission.state,'waiting_for_memory');assert.equal(farm.admission.requiredMb,1500);
 farm.maybePurgeFor=async()=>{free=1700;farm.stopping=true;};await farm.launchDeferred();assert.equal(spawns,1,'stop during reclaim cannot launch');
 farm.stopping=false;free=1200;farm.maybePurgeFor=async()=>{free=1700;farm.instances=[{status:'booting'}];};await farm.launchDeferred();assert.equal(spawns,1,'boot that starts during reclaim is serialized');
 for(const patch of [{livePos:{room:'gd#1'}},{lastSave:{mapId:'pv#1'}},{v2:{scheduler:{view:()=>({active:{kind:'craft'}})}}},{teamTradeStatus:{phase:'UNCERTAIN'}},{developmentLedger:{pending:()=>({status:'pending'})}},{teamControl:true}]){
   const victim={...idle(),...patch,stop:async()=>{throw Error('protected character stopped');}};
   assert(maintenanceBlock(victim));
   const f=Object.assign(Object.create(Supervisor.prototype),{instances:[victim],criticalFreeMb:350,freeMb:()=>200,log(){},maybePurgeFor:async()=>false});
   await f.ramGovernor(200);assert.equal(victim.status,'playing');
 }
 assert.equal(maintenanceBlock(idle()),null);
 // A transport failure followed by low RAM must not strand a stopped actor.
 let retryFree=2000,closed=0;
 const retry=Object.assign(Object.create(Supervisor.prototype),{instances:[],deferred:[],machine:'test',runtimeV2:true,
   windowCostMb:900,minFreeMb:600,freeMb:()=>retryFree,log(){},teamRoom:{post(){}},serialBoot:true,
   makeInstance:()=>({status:'booting',start:async()=>{throw Error('private_authority_unavailable');},
     async stop(){closed++;this.status='stopped';retryFree=1200;}})});
 await retry.spawn(2);assert.equal(closed,1);assert.equal(retry.instances[2],null);
 assert.deepEqual(retry.deferred,[2]);assert.equal(retry.capacityAdmissions.view().heldMb,0);
 retryFree=2200;let restarted=0;retry.spawn=async slot=>{assert.equal(slot,2);restarted++;};
 await retry.launchDeferred();assert.equal(restarted,1);assert.deepEqual(retry.deferred,[]);
 // An unrelated occupied slot has no positive close proof from this spawn.
 const existing={status:'playing'};retry.instances[2]=existing;retryFree=100;
 await Supervisor.prototype.spawn.call(retry,2);assert.equal(retry.instances[2],existing);
 const victim={...idle(),stop:async()=>{throw Error('activity started during purge');}};
 const f=Object.assign(Object.create(Supervisor.prototype),{instances:[victim],criticalFreeMb:350,freeMb:()=>200,log(){},maybePurgeFor:async()=>{victim.livePos.room='gd#2';return false;}});
 await f.ramGovernor(200);assert.equal(victim.status,'playing','recheck activity after asynchronous reclaim');
 console.log('PASS reclaim before admission; headroom preserved; concurrent/stop/boot races; dungeon, paid and trade protection');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
