'use strict';
const {FOCUSES}=require('../character-brain');
const actionable=a=>['review_route','recover'].includes(a)||Object.hasOwn(FOCUSES,a);
function ownerBusy(instance){return /^(tw|dx|gd|pv)/.test(instance.livePos?.room||instance.lastSave?.mapId||'')||!!(instance.dailyTeamPending||instance.dailyWorkStatus?.ownsNavigation||instance.v2?.trial?.active()||instance.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(instance.teamTradeStatus.phase)||instance.choresBusy||instance.teamControl||instance.recycling||instance.pendingTravel);}
function eligible(command,instance,now=Date.now(),{queueOnly=false}={}) {
  const defer=queueOnly&&Object.hasOwn(FOCUSES,command?.action);
  if(!command||!actionable(command.action)||typeof command.id!=='string'||!Number.isFinite(command.expiresAt)||command.expiresAt<now)return 'คำสั่งหมดอายุหรือไม่รองรับ';
  if(command.actorId&&command.actorId!==instance.actorIdentity?.actorId)return 'คำแนะนำเป็นของตัวละครอื่น';
  if(command.proposal&&(command.proposal.version!==2||command.proposal.maxSpend!==0||command.proposal.stopRule?.stopOnUncertain!==true||command.proposal.expiresAt<now))return 'สัญญา AI ไม่ผ่านงบหรือหมดอายุ';
  if (!defer&&/^(tw|dx|gd|pv)/.test(instance.livePos?.room || instance.lastSave?.mapId || '')) return 'กำลังอยู่ในดันเจี้ยน ไม่เปลี่ยนแผนระหว่างรัน';
  if(instance.status!=='playing'||!instance.lastSaveAt||now-instance.lastSaveAt>30000||instance.lastSaveAt>now)return 'รอข้อมูลตัวละครสด';
  if(command.build&&command.build!==instance.catalog?.().build)return 'รุ่นของคำแนะนำไม่ตรง build ที่โหลด';
  if(instance.livePos?.dead||Number.isFinite(instance.vitals?.hp)&&instance.vitals.hp<.35||instance.survivalRecovery||instance.healthRecovery)return 'ความอยู่รอดมาก่อนการเปลี่ยนแผน AI';
  if(instance.endgameCampaign?.ready===true&&['class','wing'].includes(instance.endgameCampaign.phase))return 'คลาสหรือปีกพร้อมแล้ว ให้คิวหลักจบก่อนเปลี่ยนโฟกัส';
  if(instance.v2?.journal?.pending()){
    const focus=Object.hasOwn(FOCUSES,command.action);
    if(!focus&&(command.action!=='review_route'||!require('./storage-payment-scope').independent(instance,{action:'combat-gather'},now)))return 'รอ reconcile รายการเดิมก่อนเปลี่ยนแผน';
  }
  if(instance.aiControl?.id===command.id&&instance.aiControl.state!=='deferred')return 'คำสั่งซ้ำ';
  if(now-(instance.aiActionAt||0)<300000)return 'พักการเปลี่ยนแผน 5 นาที';
  if(instance.v2?.sourceCoherence?.matches===false||!defer&&ownerBusy(instance))return 'กำลังทำงานหรือเดินทาง';
  const measuredQuiet=instance.v3?.controller?.view()?.quietMs;
  const quiet=Number.isFinite(measuredQuiet)?measuredQuiet:instance.progressAt?now-instance.progressAt:0;
  if(!Object.hasOwn(FOCUSES,command.action)&&quiet<120000)return 'ยังมีความคืบหน้า ไม่แทรกแซง';
  return null;
}
function expire(instance,now=Date.now()){const c=instance.aiPending;if(c&&Number.isFinite(c.expiresAt)&&c.expiresAt<now){instance.aiPending=null;instance.aiControl={id:c.id,action:c.action,at:now,state:'rejected',status:'แผนหมดอายุระหว่างรอเจ้าของงาน ต้องวางแผนจากข้อมูลใหม่',evidence:'expired_intent_not_executed'};return true;}return false;}
function accept(command,instance,now=Date.now()){return eligible(command,instance,now,{queueOnly:true});}
module.exports={eligible,accept,ownerBusy,expire,actionable};
