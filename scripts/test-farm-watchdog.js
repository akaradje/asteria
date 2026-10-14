'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {FarmWatchdog}=require('../src/runtime/farm-watchdog');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-farm-guard-'));let now=2000000;
try{
 const i={status:'playing',slot:0,character:{name:'A'},lastSave:{lv:120,exp:0,bestiary:{m:1},materials:{Ore:2}},livePos:{room:'w1'},catalog:()=>({world:{MAX_LV:120}})},g=new FarmWatchdog(root,'SECRET_LOGIN',{now:()=>now});
 const sample=(ms=15000)=>{now+=ms;i.lastSaveAt=i.livePos.at=now;return g.observe(i,now);};
 sample();for(let n=0;n<8;n++)assert.equal(sample().action,n===7?'repair_auto':'none');assert(g.view().reason.includes('2 นาที'));g.mark('repair_auto','w1','sent',now);
 for(let n=0;n<5;n++)assert.equal(sample().action,'none');assert.equal(sample().action,'reroute');g.mark('reroute','w1','sent',now);
 i.lastSave.bestiary.m++;assert.equal(sample().action,'none');assert.equal(g.view().quietMs,0,'capped character kills count as progress');assert(g.view().reason.includes('เพดาน'));
 i.reports={data:{slots:{0:{name:'A',buckets:[{damage:50}]}}}};sample();i.reports.data.slots[0].buckets[0].damage=100;assert.equal(sample().action,'none');assert.equal(g.view().quietMs,0);
 for(const patch of [{choresBusy:true},{pendingTravel:{mapId:'w2'}},{teamControl:true}]){Object.assign(i,patch);for(let n=0;n<16;n++)assert.equal(sample().action,'none');delete i.choresBusy;delete i.pendingTravel;delete i.teamControl;}
 const leases=require('../src/runtime/assistance-reservation'),nativeState=leases.state;let held=true,checks=0;
 try{leases.state=(actor,at)=>{assert.equal(actor,i);assert.equal(at,now);checks++;return held?{waiting:false}:null;};i.assistanceReservation={};for(let n=0;n<20;n++)assert.equal(sample().action,'none','reserved boss wait cannot enable AUTO or reroute');assert(g.view().reason.includes('รวมพล'));assert.equal(g.quietMs,0);held=false;sample();assert(!g.view().reason.includes('รวมพล'),'released ownership resumes ordinary farm observation');assert(checks>0);}finally{leases.state=nativeState;delete i.assistanceReservation;}
 for(const room of ['town','tw#1','dx#1','gd#1','pv#1']){i.livePos.room=room;for(let n=0;n<10;n++)assert.equal(sample().action,'none');assert.equal(g.view().status,'paused');}
 i.livePos.room='town';i.campaignGoal={kind:'campaign-wait'};i.endgameCampaign={ready:true,target:'wing',action:{result:{reason:'exchange-not-open'}}};sample();for(let n=0;n<12;n++)sample();assert.equal(g.view().status,'attention');assert(g.view().reason.includes('exchange-not-open'));delete i.campaignGoal;delete i.endgameCampaign;sample();assert.equal(g.view().status,'paused');
 i.livePos.room='w1';sample();now+=60000;i.livePos.at=now;assert.equal(g.observe(i,now).action,'none');assert.equal(g.view().reason,'ข้อมูลเก่า');
 g.mark('repair_auto','w1','sent',now);g.mark('reroute','w1','sent',now);g.mark('reroute','w1','sent',now);const restarted=new FarmWatchdog(root,'SECRET_LOGIN',{now:()=>now});sample();for(let n=0;n<9;n++){now+=15000;i.lastSaveAt=i.livePos.at=now;assert.equal(restarted.observe(i,now).action,'none');}assert.equal(restarted.view().status,'attention');assert(!fs.readFileSync(g.file,'utf8').includes('SECRET_LOGIN'));
 i.livePos.room='w2';assert.equal(restarted.observe(i,now).action,'none');assert.equal(restarted.view().quietMs,0);
 i.livePos.room='field';i.goal={nightTraining:true};i.lastSave.lv=90;i.lastSave.exp=100;const expGuard=new FarmWatchdog(root,'exp-objective',{now:()=>now});for(let n=0;n<9;n++){now+=15000;i.lastSaveAt=i.livePos.at=now;i.lastSave.bestiary.m++;i.reports.data.slots[0].buckets[0].damage+=100;const result=expGuard.observe(i,now);assert.equal(result.action,n===8?'repair_auto':'none');}assert.equal(expGuard.view().objective,'EXP');i.lastSave.exp++;now+=15000;i.lastSaveAt=i.livePos.at=now;assert.equal(expGuard.observe(i,now).action,'none');assert.equal(expGuard.view().quietMs,0);
 console.log('PASS two-minute output detection, AUTO then reroute, capped kills/damage progress, stale/travel/maintenance/team exclusions, restart intervention cap, private persistence and room reset');
}finally{fs.rmSync(root,{recursive:true,force:true});}
