'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {installRuntimeV2}=require('../src/runtime/v2-instance');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-v2-integration-'));
 try{
  class Fake{
   async screen(){return {inGame:true,...this.mockScreen};}
   async tick(){await this.walkTo();return 'ok';}
   async walkTo(){this.walks=(this.walks||0)+1;}
   async chainWalkTo(to){await new Promise(r=>setTimeout(r,5));this.livePos={room:to,at:Date.now()};return !this.chainFailure;}
   async socialLast(){return this.mockGuildState;}
   async guildDungeonJoin(){this.guildJoins=(this.guildJoins||0)+1;return {ok:true};}
   async purgeMemory(){this.gcs=(this.gcs||0)+1;return {ok:true};}
   async eval(){return {online:true,connected:true,paused:false,...this.mockVitals};}
   async recycle(){this.sessionRecoveries=(this.sessionRecoveries||0)+1;this.lastSaveAt=Date.now();}
   async restockPotions(){this.v2.journal.purchaseDispatch(this.activePotionPurchase,this.lastSave,Date.now());await new Promise(r=>setTimeout(r,2));this.lastSave.potions+=20;this.lastSave.coins-=1000;this.lastSaveAt=Date.now();this.acceptedSaveReceipt={state:structuredClone(this.lastSave),proof:{authority:'server_accepted_save',actorId:'fixture',sessionStartedAt:this.bagSessionStartedAt,generation:this.socialInbox.generation,build:'fixture',rev:11,requestAt:this.lastSaveAt,at:this.lastSaveAt+1}};return {ok:true,quantity:20,price:50};}
   async craftAtExchange(){this.crafted=true;return {ok:true};}
   async planBag(){this.bagReads=(this.bagReads||0)+1;return {sell:[{name:'protected'},{name:'junk'}]};}
   snapshot(){return {slot:0};}
   async stop(){this.status='stopped';}
   catalog(){return {items:{},world:{}};}
  }
  Fake.prototype.refineEquipped=Object.assign(async function(){return {refined:0,reservationNotSent:true};},{paidDispatchTracked:true});
  installRuntimeV2(Fake);
  assert.equal(Fake.prototype.refineEquipped.paidDispatchTracked,true,'real v2 and paid wrappers preserve the preparation contract');const i=new Fake();Object.assign(i,{root,slot:0,credentials:{username:'tester'},status:'playing',lastSave:{potions:0,coins:5000},lastSaveAt:Date.now(),livePos:{room:'town',at:Date.now()}});
  await i.screen();assert.equal(await i.tick(),'ok');assert.equal(i.walks,1);assert.equal(i.snapshot().runtimeV2.scheduler.state,'idle');
  const nav=new Fake();Object.assign(nav,{root,slot:1,page:{},credentials:{charName:'route-fixture'},status:'playing',buildHash:'fixture',lastSave:{},lastSaveAt:Date.now(),livePos:{room:'n1',at:Date.now()}});await nav.screen();nav.v2.sourceCoherence={matches:true};nav.loadedSourceIdentity=()=>({build:'fixture',signature:'a'.repeat(24),missing:[]});
  assert.equal(await nav.chainWalkTo('n2'),true);assert.equal(require('../src/runtime/route-travel').view(nav)['n1>n2'].samples,1,'wrapper records only actual completed native route');
  nav.livePos={room:'n1',at:Date.now()};nav.chainFailure=true;await nav.chainWalkTo('n2');assert.equal(require('../src/runtime/route-travel').view(nav)['n1>n2'].failures,1,'unconfirmed return stays a failed route even with a changed room');
  const rewards=require('../src/runtime/free-rewards'),assist=require('../src/runtime/milestone-assistance'),originalRewards=rewards.run,originalIntent=assist.supplyIntent;let rewardReads=0;try{rewards.run=async()=>{rewardReads++;};i.v2.rewardsAt=0;i.v2.gearCheckAt=0;i.assistanceReservation={expiresAt:Date.now()+60000};const beforeBags=i.bagReads||0;await i.tick();assert.equal(rewardReads,0);assert.equal(i.bagReads||0,beforeBags,'held class owner excludes wrapper equipment work');delete i.assistanceReservation;
   assist.supplyIntent=()=>({due:true});await i.tick();assert.equal(rewardReads,0,'due preparation preempts rewards before instance-level checks');assert.equal(i.bagReads||0,beforeBags);assist.supplyIntent=originalIntent;await i.tick();assert.equal(rewardReads,1,'ordinary unowned farming still collects rewards');
  }finally{delete i.assistanceReservation;rewards.run=originalRewards;assist.supplyIntent=originalIntent;}
  i.teamControl=true;i.mockVitals={hp:'98 / 100',mp:'30 / 40'};await i.observeContinuity();assert.equal(i.vitals.hp,.98);assert.equal(i.vitals.mp,.75);assert(Date.now()-i.vitals.at<1000,'read timestamp belongs to current observation while team owns actor');
  i.v2.observationAttemptAt=Date.now()-6000;i.mockVitals={hp:'',mp:''};await i.observeContinuity();assert.equal(i.vitals.hp,null);assert.equal(i.vitals.mp,null,'missing HUD cannot reuse previous healthy reading');i.teamControl=false;
  Object.assign(i,{buildHash:'fixture',actorIdentity:{actorId:'fixture'},bagSessionStartedAt:Date.now()-1000,socialInbox:new(require('../src/runtime/social-inbox').SocialInbox)(),serverSaveObservation:{rev:10}});const bought=await i.restockPotions();assert.equal(bought.ok,true);assert.equal(bought.status,'CONFIRMED');assert.equal(bought.evidence,'server_accepted_exact_save_revision');
  i.buildHash='fixture';i.livePos={room:'gh#15',at:Date.now()};Object.assign(i.lastSave,{hp:100,equip:{weapon:'w',armor:'a',head:'h',boots:'b'}});i.mockScreen={hp:'100 / 100',mp:'100 / 100'};i.teamEntryGate=()=>({canEnter:false,reason:'leader already entered a different room'});
  i.fleetActivityIntent={kind:'guild',phase:'JOINING',build:'fixture',runId:123,joinDeadline:Date.now()+60000};i.mockGuildState={_receivedAt:Date.now(),run:{id:123,member:false,done:null}};
  assert.equal((await i.guildDungeonJoin(123)).ok,true,'verified member can join after leader changes room');assert.equal(i.guildJoins,1);
  assert.equal((await i.guildDungeonJoin(124)).sent,false);i.mockGuildState._receivedAt=Date.now()-45001;assert.equal((await i.guildDungeonJoin(123)).sent,false);assert.equal(i.guildJoins,1,'mismatched or stale run sends no join');i.livePos.room='town';
  assert.equal((await i.craftAtExchange()).ok,false);assert.equal(i.crafted,undefined);
  const oldCatalog=i.catalog; i.catalog=()=>({build:'fixture',items:{upgrade:{id:'upgrade',name:'Upgrade',slot:'weapon',stats:{atk:5}}},world:{},nativeRecipes:[{type:'gear',resultId:'upgrade',result:'Upgrade',reqLv:1,cost:{Copper:1000},source:'reviewed_native_client'}]});
  const gated=await i.craftAtExchange('Upgrade','gear');assert.equal(gated.reservationNotSent,true,'actual runtime capability rejection reports no native dispatch');assert.equal(i.v2.reservations.data.claims.at(-1).status,'CANCELLED','real capability wrapper cannot poison a resource claim before reaching adapter');assert.equal(i.crafted,undefined);i.catalog=oldCatalog;
  i.v2.objective={nodes:[{name:'protected'}]};assert.deepEqual((await i.planBag()).sell,[{name:'junk'}]);
  i.livePos={room:'gd#1',at:Date.now()};assert.equal((await i.restockPotions()).ok,false);assert.equal((await i.craftAtExchange()).ok,false);
  assert.equal(await i.purgeMemory(),null);assert.equal(i.gcs,undefined);
  i.livePos.room='town';i.pendingTravel=true;assert.equal(await i.purgeMemory(),null);i.pendingTravel=false;
  assert.deepEqual(await i.purgeMemory(),{ok:true});assert.equal(i.gcs,1);
  i.lastSaveAt=Date.now()-240000;assert.match(await i.tick(),/checking session/);
  i.v2.sessionWatchdog.lastCheck=Date.now()-21000;assert.match(await i.tick(),/checking session/);
  i.v2.sessionWatchdog.lastCheck=Date.now()-21000;assert.equal(await i.tick(),'recovered stale save session');assert.equal(i.sessionRecoveries,1);
  i.lastSaveAt=Date.now()-240000;i.livePos.room='gd#1';assert.equal(await i.tick(),'fresh_save_required');assert.equal(i.sessionRecoveries,1);
  await i.stop();await assert.rejects(i.walkTo(),/stopped/);
  const {objective}=require('../src/planning/progression-objective');
  const cat={items:{w:{id:'w',name:'Sword',slot:'weapon',tier:1,stats:{atk:1}},a:{id:'a',name:'Armor',slot:'armor',tier:1,stats:{def:1}}},world:{MONSTERS:[],EQUIPMENT_SETS:{}}};
  const o=objective({job:'knight',lv:1,coins:5000,equip:{weapon:'w'},bag:[]},cat,{maps:[],monsters:[],crafting:{recipes:[]}},{build:'b'});assert.ok(o.targets.some(t=>t.id==='w'));assert.equal(o.build,'b');assert.ok(o.reserved.Copper>=1000); const actual=require('../src/economy'); const real=objective({job:'knight',lv:97,coins:50000,equip:{},bag:[]},actual.loadCatalog(process.cwd(),actual.newestBuild(process.cwd())),actual.loadWiki(process.cwd()),{build:'fixture'});assert.ok(real.targets.length>0); assert.ok(objective({job:'knight',lv:1,coins:5000,equip:{},bag:[]},cat,{maps:[],monsters:{region:[{dropTable:[{item:'w'}]}]},crafting:{recipes:[]}},{build:'b'}).targets.length>0);
  const {route}=require('../machines/tum/routes');const facts={townGates:{r1:{x:200,z:-18}},links:{r1:{prev:null,next:'r2'},r2:{prev:'r1',next:null}},fieldGates:{home:{x:0,z:40},previous:{x:-38,z:-2},next:{x:16,z:-42}}};
  assert.deepEqual(route('town','r2',facts).map(g=>g.target),['r1','r2']);facts.townGates.r1.x=NaN;assert.equal(route('town','r2',facts),null);
  console.log('v2 integration: nested actions, inventory confirmation, blocked unknown mechanics/dungeons, protected gear, objectives and observed routes passed');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
