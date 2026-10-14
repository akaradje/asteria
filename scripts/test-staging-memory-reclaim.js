'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {maintenanceBlock,purgeBlock}=require('../src/runtime/memory-maintenance');
const {Supervisor}=require('../src/supervisor'),{installRuntimeV2}=require('../src/runtime/v2-instance');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-staging-memory-'));
const now=Date.now();
function staging(kind='tower'){
 const room=kind==='guild'?'gh#15':'town';
 return {slot:0,root,buildHash:'b1',status:'playing',teamControl:true,lastSave:{mapId:room},lastSaveAt:now,livePos:{room,at:now},fleetActivityIntent:{id:'workflow',kind,phase:'PREPARING',build:'b1',at:now,deadline:now+600000}};
}
class Actor{
 async screen(){return {};}
 async tick(){return 'ok';}
 async stop(){throw Error('staging actor must not stop');}
 snapshot(){return {};}
 async purgeMemory(){this.purges=(this.purges||0)+1;this.onPurge?.();return {heapMB:20};}
}
async function main(){
 for(const kind of ['tower','rift','guild']){
  const i=staging(kind);assert.equal(purgeBlock(i,{now}),null);assert(maintenanceBlock(i),'GC eligibility must not enable destructive maintenance');
  i.fleetActivityIntent.phase='GATHERING';assert.equal(purgeBlock(i,{now}),null);
 }
 const patches=[
  {fleetActivityIntent:{...staging().fleetActivityIntent,phase:'OPENING'}},
  {fleetActivityIntent:{...staging().fleetActivityIntent,phase:'RUNNING'}},
  {fleetActivityIntent:{...staging().fleetActivityIntent,build:'other'}},
  {fleetActivityIntent:{...staging().fleetActivityIntent,at:now-15000}},
  {fleetActivityIntent:{...staging().fleetActivityIntent,at:now+1}},
  {fleetActivityIntent:{...staging().fleetActivityIntent,deadline:now}},
  {lastSaveAt:now-30000},{livePos:{room:'town',at:now-10000}},{livePos:{room:'w1',at:now}},
  {lastSave:{mapId:'tw#1'}},{pendingTravel:{}},{choresBusy:true},{healthRecovery:true},
  {v2:{scheduler:{view:()=>({queued:[{kind:'fleet-OPENING'}]})}}},
  {v2:{scheduler:{view:()=>({active:{kind:'memory-gc'}})}}},
  {v2:{journal:{pending:()=>({status:'UNCERTAIN'})}}},
  {developmentLedger:{pending:()=>({status:'pending'})}},
  {teamTradeStatus:{phase:'UNCERTAIN'}},
  {credentials:{charName:'Fixture'},teamTradeIntent:{phase:'GATHERING',offer:{donor:'Fixture',receiver:'Other'}}},
  {tradeJournal:{sessionId:1,phase:'UNCERTAIN'}}
 ];
 for(const patch of patches)assert(purgeBlock({...staging(),...patch},{now}),JSON.stringify(patch)+' must block GC');
 const potion={kind:'purchase',status:'UNCERTAIN',at:now-600000,target:{item:'Blue Potion'}},oldPurchase={...staging(),startedAt:now-100000,v2:{journal:{rows:[potion],pending:()=>potion}}};
 assert.equal(purgeBlock(oldPurchase,{now}),null,'old known potion in closed session cannot prevent nondestructive GC');assert(maintenanceBlock(oldPurchase),'same exception must never enable recycle or shedding');assert.equal(potion.status,'UNCERTAIN','GC does not clear or replay payment');
 oldPurchase.v2.journal.rows=[{...potion,status:'WAITING_CONFIRMATION'}];assert(purgeBlock(oldPurchase,{now}),'active purchase still protects GC');
 assert(purgeBlock({...staging('guild'),livePos:{room:'town',at:now}},{now}),'guild staging must be at guild hall');
 const guarded=staging();let stopped=false;
 guarded.stop=async()=>{stopped=true;};
 await Supervisor.prototype.ramGovernor.call({instances:[guarded],criticalFreeMb:350,freeMb:()=>200,log(){},maybePurgeFor:async()=>false},200);
 assert.equal(stopped,false,'critical shedding still cannot interrupt staging');

 installRuntimeV2(Actor);
 const i=Object.assign(new Actor(),staging(),{credentials:{charName:'Fixture'}});
 assert(await i.purgeMemory('deferred slot headroom'));assert.equal(i.purges,1,'owned memory-gc passes second guard');
 const run=i.v2.scheduler.run.bind(i.v2.scheduler);
 i.v2.scheduler.run=(kind,fn,options)=>{if(kind==='memory-gc')i.fleetActivityIntent.phase='OPENING';return run(kind,fn,options);};
 assert.equal(await i.purgeMemory('deferred slot headroom'),null);assert.equal(i.purges,1,'phase changes between admission and execution refuse dispatch');
 i.v2.scheduler.run=run;i.fleetActivityIntent.phase='PREPARING';
 await run('fleet-PREPARING',async()=>assert.equal(await i.purgeMemory('deferred slot headroom'),null));
 assert.equal(i.purges,1,'existing action cannot disguise itself as GC owner');
 i.teamControl=false;
 await run('tick',()=>i.purgeMemory('scheduled'));assert.equal(i.purges,2,'ordinary scheduled GC inside its own tick remains available');
 i.teamControl=true;

 let free=1200,spawns=0;i.onPurge=()=>{free=1700;};
 const farm=Object.assign(Object.create(Supervisor.prototype),{instances:[i],deferred:[2],serialBoot:true,windowCostMb:900,minFreeMb:600,purgeEveryMs:600000,lastGovernorPurgeAt:0,freeMb:()=>free,log(){},spawn:async()=>{spawns++;}});
 await farm.launchDeferred();assert.equal(spawns,1,'staging GC breaks admission circular wait only after measured headroom exists');
 assert.equal(farm.admission.requiredMb,1500);assert.equal(farm.lastReclaim.completed,1);assert.equal(farm.lastReclaim.state,'completed');
 i.fleetActivityIntent.phase='RUNNING';farm.lastGovernorPurgeAt=0;
 assert.equal(await farm.purgeRound('deferred slot headroom'),false);assert.equal(farm.lastReclaim.state,'blocked');assert.equal(farm.lastReclaim.blocked[0].reason,'activity not idle staging');assert.equal(farm.lastGovernorPurgeAt,0,'blocked round does not consume reclaim cooldown');
 console.log('PASS idle fresh staging GC, unchanged destructive guard and physical headroom, real scheduler owner/phase races, scheduled GC, admission recovery and blocked diagnostics');
}
main().finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}).catch(e=>{console.error(e);process.exitCode=1;});
