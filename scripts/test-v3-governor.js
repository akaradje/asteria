'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {ExperimentGovernor}=require('../src/learning/experiment-governor');
let now=1000000;const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-v3-governor-'));
const baseline={kind:'exp',monsterKind:'normal',mapId:'w1',monsterId:'a',kills:10,travelMs:0,routeEvidence:{at:now,confidence:'observational',samples:30,ms:600000,coveragePct:100,deaths:0,expLossEvents:0,expPerHour:1000}},candidate={...baseline,monsterId:'b',routeEvidence:null};
function actor(){return {lastSave:{lv:110,exp:0,job:'asura',potions:40},lastSaveAt:now,livePos:{at:now,room:'w1'},vitals:{at:now,hp:1},lastFps:23,lastFpsAt:now,catalog:()=>({build:'b1'}),v2:{sourceCoherence:{matches:true},journal:{pending:()=>false}}};}
function fresh(i){i.lastSaveAt=now;i.livePos.at=now;i.vitals.at=now;i.lastFpsAt=now;}
function window(ms,exp){return {at:now,confidence:'observational',samples:30,knownMs:ms,ms,fieldMs:ms,netExp:exp,deaths:0,expLossEvents:0};}
try{
 const gov=new ExperimentGovernor(root,'first','host',{now:()=>now}),i=actor();assert(gov.beginRoute(i,'b1',candidate,baseline,now).ok);assert(gov.active().bootstrap);
 const second=new ExperimentGovernor(root,'second','host',{now:()=>now});assert(!second.beginRoute(i,'b1',candidate,baseline,now).ok,'host cannot run two experiments');
 now+=480000;fresh(i);i.v2.expRouteEvidence={window:()=>window(480000,400)};assert.equal(gov.select(i,'b1',[baseline,candidate],now).monsterId,'a');assert.equal(gov.active().phase,'confirmation','candidate advantage requires baseline recheck');
 now+=300000;fresh(i);i.v2.expRouteEvidence.window=()=>window(300000,83.3333);assert.equal(gov.select(i,'b1',[baseline,candidate],now).monsterId,'b');assert.equal(gov.data.rows[0].status,'accepted');assert(gov.data.explorationMs>=780000,'unknown intervals still consume the wall-time exploration budget');assert(!gov.data.rows[0].causalVerified);assert(!second.beginRoute(i,'b1',candidate,{...baseline,routeEvidence:{...baseline.routeEvidence,at:now}},now).ok,'daily host bootstrap cannot be reused by another actor');
 const inMemory=()=>new ExperimentGovernor(null,'fixture','host',{now:()=>now});let g=inMemory(),a=actor(),b={...baseline,routeEvidence:{...baseline.routeEvidence,at:now}};
 assert.equal(g.beginRoute(a,'b1',candidate,{...b,routeEvidence:null},now).ok,false,'field-only baseline cannot authorize');assert.equal(g.beginRoute(a,'b1',{...candidate,travelMs:Infinity},b,now).ok,false);
 assert(g.beginRoute(a,'b1',candidate,b,now).ok);now+=480000;fresh(a);a.v2.expRouteEvidence={window:()=>window(480000,10)};assert.equal(g.select(a,'b1',[b,candidate],now).monsterId,'a');assert.equal(g.data.rows[0].status,'rejected');
 for(const failure of ['death','fps','save','context','payment']){g=inMemory();a=actor();b={...baseline,routeEvidence:{...baseline.routeEvidence,at:now}};assert(g.beginRoute(a,'b1',candidate,b,now).ok);now+=1000;fresh(a);if(failure==='death')a.livePos.dead=true;if(failure==='fps')a.lastFps=10;if(failure==='save')a.lastSaveAt=now-31000;if(failure==='context')a.lastSave.equip={weapon:'new'};if(failure==='payment')a.v2.journal.pending=()=>true;g.observe(a,'b1',now);assert(!g.active(),failure+' closes trial');assert(g.data.rows[0].rollbackRequired);assert.notEqual(g.data.rows[0].status,'accepted');}
 g=new ExperimentGovernor(root,'restart','other',{now:()=>now});a=actor();b={...baseline,routeEvidence:{...baseline.routeEvidence,at:now}};assert(g.beginRoute(a,'b1',candidate,b,now).ok);const reload=new ExperimentGovernor(root,'restart','other',{now:()=>now});assert(!reload.active());assert.equal(reload.data.rows[0].status,'inconclusive');assert(reload.data.rows[0].rollbackRequired);

 {const b={...baseline,routeEvidence:{...baseline.routeEvidence,at:now}};let a=actor(),g=inMemory();a.lastFps=18;assert(g.beginRoute(a,'b1',candidate,b,now).ok,'proven normal route can learn at real18 FPS');
  a=actor();a.lastFps=18;g=inMemory();assert(!g.beginRoute(a,'b1',{...candidate,kills:0},b,now).ok,'novel reconnaissance still requires20 FPS');
  const old={id:'old',kind:'purchase',status:'UNCERTAIN',at:now-700000,target:{item:'White Potion'}};
  a=actor();a.lastFps=18;a.startedAt=now-10000;a.tradeAvailability={at:now,clear:true};a.v2.journal={rows:[old],pending:()=>old};g=inMemory();assert(g.beginRoute(a,'b1',candidate,b,now).ok,'isolated old potion does not own a zero-spend route');assert.equal(old.status,'UNCERTAIN');
  now+=1000;fresh(a);a.tradeAvailability.at=now;g.observe(a,'b1',now);assert(g.active(),'old purchase does not abort independent learning');
  a.v2.journal.rows.push({id:'current',kind:'purchase',status:'WAITING_CONFIRMATION',at:now,target:{item:'White Potion'}});g.observe(a,'b1',now);assert(!g.active(),'new current purchase aborts trial');assert.equal(old.status,'UNCERTAIN','never clear or resend old payment');
 }
 console.log('PASS one governor/host lease, explicit bootstrap budget, whole-route A/B/A confirmation, rejection, stale/death/FPS/context/payment abort and durable restart evidence');
}finally{fs.rmSync(root,{recursive:true,force:true});}
