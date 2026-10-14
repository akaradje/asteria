'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {roomPolicy,isGuildHall}=require('./room-policy');
const count=o=>Object.values(o||{}).reduce((n,v)=>n+(Number.isFinite(v)?v:0),0);
class FarmWatchdog{
 constructor(root,identity,{now=Date.now}={}){this.now=now;this.file=path.join(root,'logs','farm-watchdog',crypto.createHash('sha256').update(identity).digest('hex').slice(0,24)+'.json');this.rows=[];try{this.rows=JSON.parse(fs.readFileSync(this.file)).rows.slice(-60);}catch{}this.viewState={status:'waiting',reason:'รอข้อมูลฟาร์มสด'};this.quietMs=0;this.stage=0;this.prev=null;this.lastActionAt=0;}
 observe(i,now=this.now()){
  const s=i.lastSave,p=i.livePos;const fresh=at=>Number.isFinite(at)&&at<=now&&now-at<30000;
  const assistance=i.assistanceReservation&&require('./assistance-reservation').state(i,now);
  let paused=!s||!fresh(i.lastSaveAt)||!p||!Number.isFinite(p.at)||p.at>now||now-p.at>=10000?'ข้อมูลเก่า':i.status!=='playing'||i.recycling?'กำลังเชื่อมต่อ':roomPolicy(p.room).dungeon?'กิจกรรมทีมเป็นเจ้าของการควบคุม':p.dead?'รอฟื้น':i.teamControl?'กำลังประสานทีม':i.choresBusy?'กำลังดูแลอุปกรณ์และเสบียง':i.pendingTravel?'กำลังเดินทาง':i.campaignGoal?.kind==='campaign-wait'&&now-i.endgameCampaign?.at<45000&&i.endgameCampaign?.hunt?.boardFresh?'รอรอบบอสจากข้อมูลเซิร์ฟเวอร์สด':isGuildHall(p.room)?'อยู่ในบ้านกิลด์ ไม่ประเมินเป็นพื้นที่ฟาร์ม':p.room==='town'?'อยู่ในเมือง':i.v2?.trial?.active?.()?'กำลังทดลองแบบจำกัด':null;
  if(!paused&&assistance)paused='งานรวมพลบอสถือการควบคุม · ตรวจการจองและข้อมูลสดแทนผลฟาร์ม';
  const row=i.reports?.data?.slots?.[i.slot],buckets=row?.name===(i.character?.name||i.credentials?.charName)?row?.buckets||[]:[];
  const sample={at:now,saveAt:i.lastSaveAt,room:p?.room,lv:s?.lv,exp:s?.exp,kills:count(s?.bestiary),materials:count(s?.materials)+count(s?.keyItems),damage:buckets.reduce((n,b)=>n+(b.damage||0),0),support:buckets.reduce((n,b)=>n+(b.supportRecipients||0)+(b.healReceivedServer||0),0)};
  const build=i.catalog?.().build||i.buildHash||null;sample.build=build;
  const previous=this.prev;this.prev=sample;
  const same=previous&&previous.build===build&&sample.saveAt>previous.saveAt&&now-previous.at<30000;
  const expGoal=s?.lv<i.catalog?.().world?.MAX_LV&&(i.nightTraining?.active||i.goal?.kind==='night-training'||i.goal?.kind==='level-training'||i.goal?.kind==='training'||i.goal?.nightTraining);
  const activity=same&&(sample.kills>previous.kills||sample.damage>previous.damage||sample.support>previous.support);
  if(activity)this.lastActivityAt=now;
  const effective=same&&(sample.lv>previous.lv||sample.lv===previous.lv&&sample.exp>previous.exp||(!expGoal&&(sample.kills>previous.kills||sample.materials>previous.materials||sample.damage>previous.damage||sample.support>previous.support)));
  if(effective){this.quietMs=0;this.stage=0;this.lastResultAt=now;if(this.rows.at(-1)?.result==='เริ่มตรวจและกู้คืนเฉพาะตัว'){this.rows.at(-1).result='พบผลฟาร์มใหม่หลังคำสั่ง · ยังไม่ยืนยันเหตุและผล';this.persist();}}
  if(paused){
   const waiting=paused==='อยู่ในเมือง'&&i.campaignGoal?.kind==='campaign-wait'&&i.endgameCampaign?.ready;
   const key=waiting?i.endgameCampaign.target:null;
   if(!waiting||this.townWaitKey!==key){this.townWaitAt=waiting?now:0;this.townWaitKey=key;}
   const waitMs=waiting?now-this.townWaitAt:0,blocked=waiting&&waitMs>=180000;
   this.quietMs=0;this.stage=0;this.viewState={status:blocked?'attention':'paused',reason:blocked?'วัตถุดิบครบแต่คราฟยังไม่สำเร็จ: '+(i.endgameCampaign.action?.result?.reason||'รอผลเซฟยืนยัน'):paused,at:now,waitMs,lastResultAt:this.lastResultAt||null};return {action:'none'};
  }
  this.townWaitAt=0;this.townWaitKey=null;
  if(!previous||previous.room!==sample.room||previous.build!==build||now-previous.at>=30000){this.quietMs=0;this.stage=0;}
  else if(sample.saveAt>previous.saveAt&&!effective)this.quietMs+=Math.max(0,Math.min(20000,now-previous.at));
  const recent=this.rows.filter(r=>now-r.at<900000),limited=recent.length>=3;
  let action=this.quietMs>=120000&&now-this.lastActionAt>=90000&&!limited?(this.stage===0?'repair_auto':'reroute'):'none';
  this.viewState={status:limited&&this.quietMs>=120000?'attention':action!=='none'?'recovering':this.quietMs>=60000?'watching':'working',reason:limited&&this.quietMs>=120000?'หยุดส่งคำสั่งซ้ำ: ถึงเพดาน 3 ครั้งใน 15 นาที':action!=='none'?expGoal?'ข้อมูลสดแต่ EXP ไม่เพิ่ม 2 นาที แม้ยังต่อสู้อยู่':'ข้อมูลสดแต่ไม่มี EXP/ฆ่า/ดาเมจ/วัสดุ/ผลสนับสนุน 2 นาที':s.lv>=i.catalog?.().world?.MAX_LV?'เลเวลถึงเพดาน · ตรวจผลต่อสู้และวัสดุแทน EXP':'ตรวจผลฟาร์มจริง',at:now,quietMs:this.quietMs,objective:expGoal?'EXP':'farm-output',lastActivityAt:this.lastActivityAt||null,lastResultAt:this.lastResultAt||null,nextAction:action,recentInterventions:recent.length};
  return {action,room:p.room,reason:this.viewState.reason};
 }
 mark(action,room,result,now=this.now()){this.stage++;this.lastActionAt=now;this.rows.push({at:now,action,room,result:String(result).slice(0,240)});this.rows=this.rows.slice(-60);this.persist();}
 persist(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({rows:this.rows}));fs.renameSync(this.file+'.tmp',this.file);}
 view(){return {...this.viewState,history:this.rows.slice(-8).reverse()};}
}
module.exports={FarmWatchdog};
