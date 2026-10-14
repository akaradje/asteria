'use strict';
const fresh=require('./freshness'),headroom=require('./equipment-headroom');
function allowed(i,s){
 return i.autoChores&&!s.death&&!s.panelOpen&&!i.choresBusy&&!i.pendingTravel&&!i.survivalRecovery&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&(!i.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))&&!i.v2?.trial?.active()&&i.v2?.sourceCoherence?.matches!==false&&fresh.decisionGate(i).allowed&&fresh.fresh(i.vitals?.at,15000)&&Number.isFinite(i.vitals?.hp)&&i.vitals.hp>=.95&&!require('./room-policy').roomPolicy(i.livePos?.room).dungeon&&!['boss','miniboss'].includes(i.goal?.monsterKind)&&!headroom.journalBlocks(i)&&!headroom.developmentBlocks(i)&&!i.equipmentLedger?.pending();
}
async function tick(i,s){
 if(!require('../equipment-goal').policy(i.catalog()).top10Progression||!allowed(i,s)||!i.canDo('ownedGearCheck',45000))return null;
 const plan=await i.planBag(i.roster),rows=(plan.equip||[]).sort((a,b)=>Number(!i.lastSave.equip?.[b.slot])-Number(!i.lastSave.equip?.[a.slot])||(b.comparison?.gain||0)-(a.comparison?.gain||0));
 const pick=rows[0];
 if(!pick){
  if(i.livePos?.room==='town'&&(i.lastSave.storage?.gear||[]).some(g=>!g.lk&&!g.up&&require('../gear-value').compare(i.lastSave,i.catalog(),g.id).upgrade)&&i.canDo('ownedStorageCheck',600000)&&allowed(i,s)){
   const out=await i.recoverStoredUpgrades();return out.equipped?'owned storage upgrades: saved equipment observed':null;
  }return null;
 }
 if(!allowed(i,s)||!require('../gear-value').compare(i.lastSave,i.catalog(),pick.id).upgrade)return null;
 await i.expeditionAuto(false);
 try{
  if(!allowed(i,s))return null;
  const at=Date.now(),out=await i.equipItems([pick]),observed=i.lastSaveAt>at&&i.lastSave.equip?.[pick.slot]===pick.id;
  i.equipmentMaintenanceStatus={at:Date.now(),kind:'equip',id:pick.id,name:pick.name,status:observed?'change_observed':out.equipped?'awaiting_outcome':'not_sent',reason:pick.comparison?.bridge?'สวมของที่ถืออยู่เพื่อเพิ่มพลังระหว่างไล่ Legendary +10; ยังไม่ถือว่าเป้าสำเร็จ':'สวมของที่ถืออยู่และคะแนนชุดเพิ่มก่อนกลับไปฝึก',evidence:observed?'outgoing_client_save':'no_confirmed_equipment_change'};
  return 'owned gear: '+i.equipmentMaintenanceStatus.status;
 }finally{await i.closeGamePanel();}
}
module.exports={tick,allowed};
