'use strict';
const fresh=require('../runtime/freshness').fresh;
function remaining(save,world,target){
 if(!Number.isInteger(target)||!Number.isInteger(world?.MAX_LV)||target>world.MAX_LV||!Number.isInteger(save?.lv)||save.lv<1||!Number.isFinite(save.exp)||save.exp<0)return null;
 if(save.lv>=target)return 0;
 let n=-save.exp;for(let lv=save.lv;lv<target;lv++){const v=world.expToNext?.(lv);if(!Number.isFinite(v)||v<=0)return null;n+=v;}
 return n>=0?n:null;
}
function assess(save,cat,{now=Date.now(),saveAt=null,rate=null,measuredMs=0}={}){
 const p=require('../equipment-goal').policy(cat).nightTraining;
 if(!p?.enabled)return {active:false,status:'disabled'};
 const target=p.target,deadline=Date.parse(p.deadline),start=Date.parse(p.startedAt),remainingExp=remaining(save,cat.world,target);
 if(!Number.isFinite(start)||!Number.isFinite(deadline)||deadline<=start||!Number.isFinite(now)||now<start||remainingExp===null)return {active:false,status:'unverified',target,deadline};
 if(!fresh(saveAt,30000,now))return {active:false,status:'waiting_fresh_save',target,deadline};
 const pet=require('./progression-priority').assess(save,cat).pet;
 const overdue=now>=deadline,continueUntilTarget=p.continueUntilTarget!==false;
 const active=remainingExp>0&&pet&&(!overdue||continueUntilTarget);
 const measured=Number.isFinite(rate)&&rate>0&&measuredMs>=300000,etaMs=measured?remainingExp/rate*3600000:null;
 return {active,status:remainingExp===0?'reached':!pet?'pet_required':overdue?(continueUntilTarget?'overdue_continuing':'deadline_passed'):measured?'estimated':'collecting',target,deadline,remainingExp,deadlineMissed:overdue&&remainingExp>0,continueUntilTarget,
  requiredExpPerHour:now<deadline?Math.ceil(remainingExp*3600000/(deadline-now)):null,observedExpPerHour:measured?rate:null,etaMs,estimatedAt:etaMs!==null?now+etaMs:null,
  onPace:etaMs!==null&&now<deadline?now+etaMs<=deadline:null,guaranteed:false,reason:'เร่ง EXP สุทธิถึงเป้าหมาย; คลาส/ปีกที่พร้อมทำได้ทันที; ความอยู่รอดและข้อมูลสดมาก่อน; ETA เป็นประมาณการไม่ใช่คำรับรอง'};
}
function view(i,now=Date.now(),rate=i.levelProgress?.state?.expPerHour,measuredMs=i.levelProgress?.state?.measuredMs){return assess(i.lastSave,i.catalog(),{now,saveAt:i.lastSaveAt,rate,measuredMs});}
function preferKnown(rows){const proven=rows.filter(g=>Number.isFinite(g.kills)&&g.kills>0);return proven.length?proven:rows;}
function select(i,wiki,now=Date.now()){
 if(!view(i,now).active||i.v2?.sourceCoherence?.matches===false||!require('../runtime/freshness').decisionGate(i,now).allowed)return null;
 // Retain new native normal targets for bounded reconnaissance. The route
 // optimizer chooses a proven baseline before allowing an untried trial.
 if(!fresh(i.vitals?.at,15000,now)||!Number.isFinite(i.vitals?.maxHp)||i.vitals.maxHp<=0)return null;
 const rows=require('./level-training').candidates(i.lastSave,wiki,i.catalog(),{room:i.livePos?.room,blocked:i.brain.blocked(),maxTravelMs:620000,maxHp:i.vitals.maxHp,now,measurements:require('../runtime/route-travel').view(i,i.campaignRoutes,now)});
 const ranked=i.v2?.farmEvidence?i.v2.farmEvidence.rank(rows,i.lastSave,i.v2.learningRevision||i.catalog().build):rows;
 const decorated=i.v2?.expRouteEvidence?i.v2.expRouteEvidence.decorate(ranked,i.lastSave,i.v2.learningRevision||i.catalog().build):ranked;
 const choice=require('./training-route').choose(i,decorated,now);
 i.trainingRouteStatus=choice.status;
 const pick=choice.goal;if(!pick)return null;
 return {...pick,nightTraining:true,label:pick.label+' · เร่งถึง Lv '+view(i,now).target,reason:pick.reason+' · เป้าหมายยังเดินต่อหลังพ้นกำหนดจนถึงเลเวลที่ตั้งไว้'};
}
module.exports={remaining,assess,view,select,preferKnown};
