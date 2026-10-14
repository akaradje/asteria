'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {inspect,travelMoving}=require('../src/runtime/work-continuity');
const {FleetActivity}=require('../src/planning/fleet-activity');
const now=1000000;
const {GameInstance}=require('../src/instance'),combat=room=>({livePos:{room,at:Date.now()},lastSave:{lv:50},catalog:()=>({world:{MAX_LV:120}}),brain:{data:{deaths:{}}}});
for(const room of ['town','gh#1',undefined])for(const teamControl of [false,true])assert.equal(GameInstance.prototype.huntAutoAllowed.call({...combat(room),teamControl}),false,'town/unknown room never authorizes dummy combat, including during team gathering');
assert.equal(GameInstance.prototype.huntAutoAllowed.call(combat('w1')),true,'verified field combat remains possible');
assert.equal(GameInstance.prototype.huntAutoAllowed.call({...combat('gd#1'),teamControl:true}),true,'active dungeon combat remains owned by its readiness checks');
const townSource=fs.readFileSync('src/instance.js','utf8');
for(const [start,end]of [['  async start()','  /** Full unattended run:'],['  async recycle(','  async hardReload('],['  async hardReload(','  async workQuestBoard(']]){
 const block=townSource.slice(townSource.indexOf(start),townSource.indexOf(end,townSource.indexOf(start)));
 assert(!block.includes('await this.enableAuto()'),'boot and recovery cannot enable combat before fresh target verification');assert(block.includes('await this.expeditionAuto(false)'));
}
const townWork=require('../src/runtime/work-continuity').optionalTownWorkAllowed;assert(townWork({}));assert(townWork({campaignGoal:{kind:'campaign-wait',mapId:'town'}}));for(const patch of [{pendingTravel:{mapId:'w1'}},{campaignGoal:{kind:'card-collection',mapId:'w1',sideWork:true}},{campaignGoal:{kind:'wing',mapId:'town'}},{teamControl:true},{dailyWorkStatus:{ownsNavigation:true}}])assert(!townWork(patch),'optional town work cannot steal route/campaign ownership');
const actor=()=>({status:'playing',lastSaveAt:now,livePos:{room:'w1',at:now},teamControl:true,fleetActivityIntent:{phase:'GATHERING',deadline:now-1},dailyTeamPending:true});
let i=actor();assert(inspect(i,now).release);assert(!i.teamControl&&!i.dailyTeamPending);
for(const patch of [{tickBusy:true},{fleetActivityBusy:true},{choresBusy:true},{workflowAck:{sent:true}},{livePos:{room:'tw#1',at:now}},{lastSaveAt:now-31000},{fleetActivityIntent:{phase:'OPENING',deadline:now-1,openAt:now-90000}},{fleetActivityIntent:{phase:'RUNNING',deadline:now-1,runId:7}}]){i=Object.assign(actor(),patch);assert(!inspect(i,now).release);assert(i.teamControl,'started/uncertain/stale/busy work never released');}
for(const phase of ['CONFIRMED','CANCELLED','UNCERTAIN']){const i={...actor(),teamControl:false,teamTradeIntent:{phase,offer:{},deadline:now-1}};assert.equal(inspect(i,now).kind,'farm','terminal old trade is not an active wait');assert(!i.workContinuity.overdue);}
for(const name of ['Donor','Receiver','Other',undefined]){const i={...actor(),teamControl:false,character:{name},teamTradeIntent:{phase:'READY',offer:{donor:'Donor',receiver:'Receiver'},deadline:now+1000}};assert.equal(inspect(i,now).kind,name==='Other'?'farm':'trade','only a known unrelated pair is excluded from the display owner');assert(!i.workContinuity.release,'display classification never cancels a trade');}
const prepActor={...actor(),teamControl:false,dailyTeamPending:false,milestonePreparationStatus:{at:now,lastIntentAt:now,expiresAt:now+900000,recipient:'Recipient',state:'ready-waiting-for-group'}};assert.equal(inspect(prepActor,now).kind,'class-preparation');assert.equal(prepActor.workContinuity.deadline,now+900000);assert.match(prepActor.workContinuity.reason,/Recipient/);assert.equal(inspect(prepActor,now+45001).kind,'farm','old preparation evidence does not label an endless active owner');
prepActor.assistanceReservation={expiresAt:now+900000,assignment:{recipient:'Recipient'}};assert.equal(inspect(prepActor,now).kind,'class-group');
const optional=require('../src/runtime/v3-instance').optionalWork;for(const patch of [{assistanceReservation:{expiresAt:now+1}},{milestonePreparationStatus:{at:now,expiresAt:now+1}},{classBossProbeActive:{status:'running',deadline:now+1}},{pendingTravel:{}},{dailyTeamPending:true},{teamControl:true}])assert(!optional(patch,now),'held mandatory work excludes optional wrapper actions');assert(optional({},now));
const closed={kind:'purchase',status:'UNCERTAIN',at:now-10000,closedSessionEvidence:{kind:'authoritative_server_load_after_session_restart',sessionStartedAt:now-5000,at:now-4000,rev:1,outcome:'unknown',replayBlocked:true}},oldStock={bagSessionStartedAt:now-5000,v2:{journal:{rows:[closed]}}};assert(optional(oldStock,now),'closed old potion history does not indefinitely suppress unrelated optional rewards');assert.equal(closed.status,'UNCERTAIN');closed.closedSessionEvidence.rev=null;assert(!optional(oldStock,now),'unproven payment closure still blocks');
let pending={};assert(!travelMoving(pending,{room:'w1',x:1,z:1,mv:true,at:now},now));assert(!travelMoving(pending,{room:'w1',x:1,z:1,mv:true,at:now+1000},now+1000),'moving flag without position change');assert(travelMoving(pending,{room:'w1',x:3,z:1,mv:true,at:now+2000},now+2000));assert(!travelMoving(pending,{room:'w1',x:3,z:1,mv:true,at:now+18000},now+18000),'old motion cannot extend travel');assert(!travelMoving(pending,{room:'w2',x:3,z:1,mv:true,at:now-20000},now));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-offline-'));let clock=now;
try{const config={leader:'A',members:[{machine:'tum',slot:0,charName:'A'},{machine:'windows',slot:0,charName:'B'}]},a=new FleetActivity(root,config,'tum',{now:()=>clock});assert(a.begin('tower','b',{enabled:true}));assert.equal(a.reconcile([],null).phase,'GATHERING');clock+=29999;assert.equal(a.reconcile([],null).phase,'GATHERING');clock+=2;assert.equal(a.reconcile([],null).phase,'WITHDRAWN');assert.equal(a.state.evidence,'no_quota_command_dispatched');assert(!a.state.openAt&&!a.state.runId);assert.equal(a.handled.size,0);
 a.state={phase:'OPENING',build:'b',leader:'A',kind:'tower',deadline:clock+100000,openAt:clock-1000};assert.equal(a.reconcile([],null).phase,'WITHDRAWING','started round follows withdrawal rather than silently releasing');
 const source=fs.readFileSync('src/instance.js','utf8');assert(source.indexOf("work-continuity').inspect(this)")<source.indexOf('if (!this.teamControl && Date.now() >= next)'),'lease observation runs even when navigation ownership skips ticks');
 console.log('PASS bounded pre-opening offline wait, active/uncertain work protection, real travel movement and outer-loop ownership recovery');
}finally{fs.rmSync(root,{recursive:true,force:true});}

(async()=>{
 let clock=0;const native=new Set(),calls=[];
 const keys=require('../src/runtime/movement-keys').movementKeys({async down(k){native.add(k);calls.push(['down',k]);},async up(k){native.delete(k);calls.push(['up',k]);}},{now:()=>clock});
 await keys.set('w',true);native.clear(); // Actual native blur wipes held inputs.
 clock=999;await keys.set('w',true);assert.equal(calls.length,1,'bounded input traffic');
 clock=1000;await keys.set('w',true);assert(native.has('w'),'walking recovers from a native blur without changing route');
 await keys.set('d',true);await keys.set('w',false);assert(!native.has('w'));assert(native.has('d'));
 await keys.release();assert.equal(native.size,0,'arrival/cancellation leaves no held movement');
 const cleanup=[],broken=require('../src/runtime/movement-keys').movementKeys({async down(){},async up(k){cleanup.push(k);if(k==='w')throw Error('page closed');}});
 await broken.set('w',true);await broken.set('d',true);await broken.release();assert.deepEqual(cleanup,['w','d'],'one rejected release cannot skip remaining cleanup');
 const vm=require('vm'),panel={hidden:false},body={dataset:{panel:'news'}},close={click(){panel.hidden=true;}},els={panel,pBody:body,pClose:close};
 const pageEvents=[[],[]],keyboardFor=slot=>require('../src/runtime/movement-keys').pageMovementKeyboard({eval:async code=>vm.runInNewContext(code,{KeyboardEvent:class{constructor(type,opts){this.type=type;Object.assign(this,opts);}},window:{dispatchEvent:e=>{pageEvents[slot].push([e.type,e.code]);return true;}}})});
 const first=keyboardFor(0),second=keyboardFor(1);await first.down('w');await second.down('a');await first.up('w');await second.up('a');
 assert.deepEqual(pageEvents,[[['keydown','KeyW'],['keyup','KeyW']],[['keydown','KeyA'],['keyup','KeyA']]],'input stays in the owned page while other actors move');
 assert.throws(()=>first.down('x'),/Unsupported/);
 const {ActionScheduler}=require('../src/runtime/action-scheduler'),scheduler=new ActionScheduler(),cleaned=[],owned={page:{},v2:{scheduler},eval:async code=>{scheduler.checkpoint();cleaned.push(code);return true;}},cancelKeys=require('../src/runtime/movement-keys').pageMovementKeyboard(owned);
 await scheduler.run('walk',async()=>{await cancelKeys.down('w');scheduler.cancel();await cancelKeys.up('w');await assert.rejects(cancelKeys.down('w'),/cancelled/);});
 assert.equal(cleaned.length,2,'cancellation releases keys but cannot start more movement');
 owned.page={};await assert.rejects(cancelKeys.up('w'),/page replaced/,'old owner must not release a new page input');
 const reader={eval:async code=>vm.runInNewContext(code,{document:{getElementById:k=>els[k]}})},dismiss=require('../src/runtime/startup-news').dismissStartupNews;
 assert.equal(await dismiss(reader),true,'news cannot block boot/travel until the stall ladder');
 for(const name of ['trade','potionShop','craft','loginReward']){panel.hidden=false;body.dataset.panel=name;assert.equal(await dismiss(reader),false);assert.equal(panel.hidden,false,'other dialogs remain owned');}
 assert(!fs.readFileSync('src/instance.js','utf8').includes("tap('#autoBtn')"),'AUTO fallbacks use the town/target combat gate');
 console.log('PASS movement restored after native blur, bounded repeat and all-key release');
})().catch(e=>{console.error(e);process.exitCode=1;});

{
 const {reconcileTravel}=require('../src/runtime/work-continuity');let at=2000000,failures=0,arrivals=0;
 const make=()=>({pendingTravel:{mapId:'n1',until:at+180000},livePos:{room:'town',x:160,z:7,at},brain:{arrived:()=>arrivals++,travelFailure:()=>{failures++;return false;}}});
 let a=make();assert.equal(reconcileTravel(a,at),null);a.livePos.at=at+45000;assert.equal(reconcileTravel(a,at+45000),'released');assert.equal(failures,1);assert.equal(a.pendingTravel,null);
 a=make();a.livePos.room='n1';assert.equal(reconcileTravel(a,at),'arrived');assert.equal(arrivals,1);assert.equal(a.pendingTravel,null);
 a=make();a.lastSaveAt=at;a.teamTradeStatus={phase:'UNCERTAIN',navigationReleased:true,at};a.tradeAvailability={clear:true,at};a.livePos.room='n1';assert.equal(reconcileTravel(a,at),'arrived','native idle evidence releases travel only, leaving trade unknown');assert.equal(a.teamTradeStatus.phase,'UNCERTAIN');
 a=make();a.lastSaveAt=at;a.teamTradeStatus={phase:'UNCERTAIN',navigationReleased:true,at};a.tradeAvailability={clear:false,at};assert.equal(reconcileTravel(a,at),null,'native paused/current session still protects navigation');assert(a.pendingTravel);
 for(const patch of [{teamControl:true},{teamTradeStatus:{phase:'READY'}},{dailyTeamPending:true},{livePos:{room:'town',at:at-11000}}]){a=Object.assign(make(),patch);assert.equal(reconcileTravel(a,at+180001),null);assert(a.pendingTravel);}
 a=make();reconcileTravel(a,at);a.livePos={room:'town',x:170,z:7,at:at+44000,mv:true};assert.equal(reconcileTravel(a,at+44000),null);a.livePos.at=at+46000;assert.equal(reconcileTravel(a,at+46000),null,'fresh real motion keeps route');
 a.pendingTravel.until=at+46000;assert.equal(reconcileTravel(a,at+46000),'moving');assert.equal(a.pendingTravel.extends,1);
 console.log('PASS early arrival and stationary travel release, active owners and actual-motion extension');
}
