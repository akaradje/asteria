'use strict';
const {fresh,decisionGate}=require('./freshness');
async function tick(i,screen,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const at=now(),s=i.lastSave,target=i.credentials?.job;
 if(s?.job!=='novice'||s.jobLv<10||!Number.isInteger(s.jobLv)||i.autoBuild===false||!target||!i.catalog().jobs?.[target]||!decisionGate(i,at).allowed||i.v2?.sourceCoherence?.matches===false)return null;
 if(screen.death||i.recycling||i.choresBusy||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||require('./room-policy').roomPolicy(i.livePos?.room).dungeon||i.v2?.trial?.active()||i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))return null;
 if(!i.canDo('firstClassPriority',60000))return null;
 i.firstClassStatus={at,target,status:'preparing',reason:'Job Lv10 แล้ว · เลือกอาชีพก่อนงานเสริมและฟาร์มเสี่ยง'};
 await i.expeditionAuto(false);
 try{
  if(i.livePos?.room!=='town'){const home=await i.returnToTown();if(!home?.ok){i.firstClassStatus.status='waiting_town';return 'first class: waiting for verified town';}}
  if(i.livePos?.room!=='town'||!fresh(i.lastSaveAt,30000,now()))return 'first class: waiting for fresh town save';
  const opened=await i.openTownService('jobMaster');if(!opened?.ok){i.firstClassStatus.status='waiting_panel';return 'first class: job master not ready';}
  const available=await i.eval(`(() => [...document.querySelectorAll('#pBody .jc-pick')].filter(b=>!b.disabled).map(b=>b.dataset.job))()`);
  if(!available?.includes(target)){i.firstClassStatus.status='target_unavailable';return 'first class: target class not offered by native controls';}
  const sentAt=now();await i.chooseJob([target]);const until=now()+10000;
  while(now()<until&&(i.lastSave?.job!==target||i.lastSaveAt<=sentAt))await sleep(400);
  const ok=i.lastSave?.job===target&&i.lastSaveAt>sentAt;i.firstClassStatus={at:now(),target,status:ok?'confirmed':'awaiting_save',reason:ok?'อาชีพเป้าหมายยืนยันจากเซฟใหม่':'ยังไม่ยืนยัน ไม่อ้างว่าเลื่อนสำเร็จ',evidence:ok?'fresh_native_save_job_change':'native_controls_only'};
  if(ok){i.goal=null;i.teamGoal=null;i.campaignGoal=null;i.huntMap=null;i.refreshGoal?.();return 'first class confirmed: '+target;}
  return 'first class: awaiting native save';
 }finally{await i.closeGamePanel?.();}
}
module.exports={tick};
