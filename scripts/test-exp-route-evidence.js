'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {ExpRouteEvidence,routeContext}=require('../src/learning/exp-route-evidence');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-exp-route-'));let now=1000000;
try{
 const g={kind:'exp',monsterKind:'normal',mapId:'d3',monsterId:'chrono'},s={lv:108,job:'asura',exp:0,potions:30,equip:{weapon:'w'},autoTargets:['chrono'],autoOpt:{potPct:50,ph:true},bestiary:{chrono:0}};
 const i={lastSave:{...s,bestiary:{chrono:0}},lastSaveAt:now,goal:g,livePos:{room:'d3',at:now},catalog:()=>({world:{expToNext:()=>10000}}),v2:{sourceCoherence:{matches:true}}};
 const e=new ExpRouteEvidence(root,'public',{now:()=>now});
 const sample=(exp=0,kills=0,ms=10000)=>{now+=ms;i.lastSaveAt=now;i.livePos.at=now;i.lastSave.exp+=exp;i.lastSave.bestiary.chrono+=kills;e.observe(i,'build1');};
 e.observe(i,'build1');for(let n=0;n<30;n++)sample(100,1);
 let v=e.decorate([g],i.lastSave,'build1')[0].routeEvidence;assert.equal(v.expPerHour,36000);assert.equal(v.fieldPct,100);assert.equal(v.confidence,'observational');
 // Continuous saves still charge a blocked async walk and native town refill.
 i.pendingTravel={};i.livePos.room='town';i.lastSave.autoOpt.potPct=90;for(let n=0;n<30;n++)sample();i.lastSave.potions+=20;sample();i.pendingTravel=null;i.livePos.room='d3';sample(100,1);
 v=e.decorate([g],i.lastSave,'build1')[0].routeEvidence;assert(v.expPerHour<19000);assert(v.townMs>=290000);assert.equal(v.refills,1);assert.equal(v.fieldMs+v.townMs+v.travelMs+v.recoveryMs+v.unconfirmedMs,v.knownMs,'time categories partition known wall time without overlap');
 const before=v.netExp;i.lastSave.autoTargets=['other'];for(let n=0;n<5;n++)sample(1000,1);v=e.decorate([g],i.lastSave,'build1')[0].routeEvidence;assert.equal(v.netExp,before,'wrong native target cannot inflate EXP');
 i.lastSave.autoTargets=['chrono'];i.livePos.dead=true;sample(-200);i.livePos.dead=false;sample();v=e.decorate([g],i.lastSave,'build1')[0].routeEvidence;assert.equal(v.deaths,1);assert.equal(v.expLossEvents,1);assert.equal(v.netExp,before-200,'death loss remains a real cost');
 // Duplicate and stale/future/ownership evidence never boosts the rate.
 const count=v.samples;e.observe(i,'build1');assert.equal(e.decorate([g],i.lastSave,'build1')[0].routeEvidence.samples,count);
 i.teamControl=true;sample(999999,1);i.teamControl=false;sample();assert.equal(e.decorate([g],i.lastSave,'build1')[0].routeEvidence.samples,count);
 i.v2.sourceCoherence.matches=false;sample(999999,1);i.v2.sourceCoherence.matches=true;sample();assert.equal(e.decorate([g],i.lastSave,'build1')[0].routeEvidence.samples,count);
 i.lastSaveAt=now+1;e.observe(i,'build1');assert.equal(e.previous,null);
 i.lastSaveAt=now;e.observe(i,'build1');sample(0,0,120000);v=e.decorate([g],i.lastSave,'build1')[0].routeEvidence;assert(v.coveragePct<100,'unobserved gap remains in cost/coverage');
 const sig=routeContext('build1',s);assert.equal(sig,routeContext('build1',{...s,autoTargets:['other'],autoOpt:{potPct:90,ph:false}}));assert.notEqual(sig,routeContext('build1',{...s,refine:{w:1}}));assert.notEqual(sig,routeContext('build2',s));assert.notEqual(sig,routeContext('build1',{...s,elixirT:10}));
 assert.equal(e.decorate([g],{...i.lastSave,refine:{w:1}},'build1')[0].routeEvidence,null);
 assert.equal(e.window(i.lastSave,'build1',g,now),null,'pooled old samples are excluded from trial');
 // Level rollover uses the current native curve, not an invented EXP reset.
 const f=new ExpRouteEvidence(root,'rollover',{now:()=>now});i.lastSave={...s,lv:108,exp:9900,bestiary:{chrono:0}};i.lastSaveAt=now;f.observe(i,'build1');now+=10000;i.lastSaveAt=now;i.livePos.at=now;i.lastSave.lv=109;i.lastSave.exp=100;i.lastSave.bestiary.chrono=1;f.observe(i,'build1');assert.equal(f.decorate([g],i.lastSave,'build1')[0].routeEvidence.netExp,200);
 const recovery=new ExpRouteEvidence(root,'recovery',{now:()=>now});i.goal={...g,kind:'survival'};i.lastSaveAt=now;recovery.observe(i,'build1');now+=10000;i.lastSaveAt=now;i.livePos.at=now;i.lastSave.exp+=50;i.lastSave.bestiary.chrono++;recovery.observe(i,'build1');assert.equal(recovery.decorate([g],i.lastSave,'build1')[0].routeEvidence.netExp,50,'safe recovery farming also learns actual EXP economics');
 e.persist();assert(fs.existsSync(e.file));
 console.log('PASS whole-route native EXP/cost, blocked-walk saves, refill, exclusive target, death loss, duplicates/gaps/future/ownership/source isolation, context/probe separation and native level rollover');
}finally{fs.rmSync(root,{recursive:true,force:true});}
