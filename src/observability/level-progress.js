'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function delta(a,b,curve){
 if(!Number.isInteger(a.lv)||!Number.isInteger(b.lv)||!Number.isFinite(a.exp)||!Number.isFinite(b.exp)||b.lv<a.lv||b.lv-a.lv>10)return null;
 let n=b.exp-a.exp;for(let lv=a.lv;lv<b.lv;lv++){const need=curve?.(lv);if(!Number.isFinite(need)||need<=0)return null;n+=need;}
 return n;
}
class LevelProgress{
 constructor(root,name){this.file=path.join(root,'logs/level-progress',crypto.createHash('sha256').update(String(name)).digest('hex').slice(0,16)+'.json');this.samples=[];this.previous=null;this.lastWriteAt=0;this.state={status:'waiting'};try{const saved=JSON.parse(fs.readFileSync(this.file));this.samples=(saved.samples||[]).slice(-720);}catch{}}
 observe(i,now=Date.now()){
  const s=i.lastSave,c=i.catalog(),p=i.livePos,fresh=require('../runtime/freshness').fresh;
  if(!s||!fresh(i.lastSaveAt,30000,now)||!fresh(p?.at,10000,now)){this.previous=null;this.state={at:now,status:'waiting',reason:'รอเซฟและตำแหน่งสด'};return this.state;}
  if(this.previous?.saveAt===i.lastSaveAt)return this.view(i,now);
  const eligible=require('../learning/context-learning').farmWindowEligible(i,now);
  const sample={at:now,saveAt:i.lastSaveAt,build:c.build,job:s.job,lv:s.lv,exp:s.exp,jobLv:s.jobLv,jobExp:s.jobExp,room:p.room,dead:!!p.dead,eligible};
  const before=this.previous;this.previous=sample;
  if(before&&before.build===sample.build&&before.job===sample.job&&now>before.at&&now-before.at<=90000){
   const amount=delta(before,sample,c.world?.expToNext),jexp=delta({lv:before.jobLv,exp:before.jobExp},{lv:sample.jobLv,exp:sample.jobExp},lv=>c.world?.jobToNext?.(lv,s.job==='novice'));
   if(amount!==null)this.samples.push({at:now,build:c.build,job:s.job,ms:now-before.at,exp:amount,jobExp:jexp,levels:sample.lv-before.lv,deaths:sample.dead&&!before.dead?1:0,fieldMs:eligible&&before.eligible&&sample.room===before.room?now-before.at:0});
   this.samples=this.samples.filter(r=>r.build===c.build&&r.job===s.job&&now-r.at<3600000&&r.at<=now).slice(-720);
   this.persist(now);
  }
  return this.view(i,now);
 }
 persist(now=Date.now(),force=false){if(!force&&now>=this.lastWriteAt&&now-this.lastWriteAt<15000)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});const result=require('../runtime/telemetry-file').writeTelemetry(this.file,{version:1,samples:this.samples});if(result.ok)this.lastWriteAt=now;return result;}
 view(i,now=Date.now()){
  const s=i.lastSave||{},c=i.catalog(),rows=this.samples.filter(r=>r.build===c.build&&r.job===s.job&&now-r.at<3600000&&r.at<=now),sum=k=>rows.reduce((n,r)=>n+(r[k]||0),0),ms=sum('ms'),field=sum('fieldMs'),exp=sum('exp');
  const jobRows=rows.filter(r=>Number.isFinite(r.jobExp)),jobMs=jobRows.reduce((n,r)=>n+r.ms,0);
  const capped=Number.isInteger(c.world?.MAX_LV)&&s.lv>=c.world.MAX_LV,need=c.world?.expToNext?.(s.lv),rate=ms>=300000&&rows.length>=5?Math.round(exp*3600000/ms):null;
  return this.state={at:now,saveAt:i.lastSaveAt,build:c.build,nightTraining:require('../planning/night-training').assess(s,c,{now,saveAt:i.lastSaveAt,rate,measuredMs:ms}),trainingRoute:i.goal?.kind==='survival'?i.survivalTrainingRoute||null:i.trainingRouteStatus||null,status:capped?'capped':ms>=300000?'measured':'collecting',lv:s.lv,job:s.job,jobLv:s.jobLv,measuredMs:ms,samples:rows.length,netExp:exp,expPerHour:rate,jobMeasuredMs:jobMs,jobExpPerHour:jobMs>=300000&&jobRows.length>=5?Math.round(jobRows.reduce((n,r)=>n+r.jobExp,0)*3600000/jobMs):null,fieldPct:ms?Math.round(field*100/ms):null,deaths:sum('deaths'),levelsGained:sum('levels'),nextLevelMinutes:!capped&&rate>0&&Number.isFinite(need)?Math.ceil(Math.max(0,need-s.exp)*60/rate):null,reason:capped?'เลเวลตัน · พัฒนาคลาส อุปกรณ์ และของแทน EXP':rate===null?'กำลังเก็บอย่างน้อย 5 นาที ก่อนประเมิน EXP/ชม.':'EXP สุทธิรวมเวลาตายในเมืองและเดินทางจากเซฟสด',evidence:'observed_native_save_deltas_not_server_reward_receipts'};
 }
}
module.exports={LevelProgress,delta};
