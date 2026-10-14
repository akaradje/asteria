'use strict';
// Existing native adapters retain payment journals, freshness contracts and
// source reviews. This module neither clears uncertainty nor restarts a host.
async function run(action,i,screen,t){
 if(action==='resolve-soft-cycle')return require('./team-trade').cancelUncommittedForSpace(i)?'ยกเลิกเทรดที่ยังไม่ส่ง · จัดพื้นที่ก่อนวางแผนแลกใหม่':null;
 if(action==='reobserve'){await require('./native-save-probe').requestNativeResave(i);return 'ขอเซฟใหม่ · ยังไม่ถือว่างานสำเร็จ';}
 if(action==='travel'){const r=require('./work-continuity').reconcileTravel(i);return r?'ตรวจการเดินทาง: '+r:null;}
 if(action==='supplies')return require('./survival').tick(i,screen);
 if(action==='inventory'){
  if(i.endgameCampaign?.phase==='wing'&&i.endgameCampaign.ready===true){
   const r=await require('./wing-inventory').prepare(i);return r.ok?'เปิดพื้นที่คราฟปีกยืนยันแล้ว':null;
  }
  return require('./equipment-headroom').tick(i);
 }
 if(action==='campaign')return require('./capped-campaign').tick(i,screen);
 if(action==='farm')return await i.farmGuardTick?.(screen)?'watchdog ตรวจเป้าหมายและผลสนาม':null;
 if(action==='replan'){
  // An ambiguous native trade still owns its protocol. Do not drop that owner
  // simply because its navigation status says UNCERTAIN.
  if(require('./team-trade').blocksNavigation(i)||i.survivalRecovery||i.pendingTravel)return null;
  if(i.campaignGoal&&i.campaignRetry?.safeSideWork!==true)return require('./capped-campaign').tick(i,screen);
  if(i.campaignGoal?.kind==='campaign-wait'&&i.campaignRetry?.safeSideWork===true)return require('./capped-campaign').tick(i,screen);
  i.goal=null;i.refreshGoal();return 'ทวนแผนจากข้อมูลจริง · รอยืนยันการออกฟาร์ม';
 }
 return null;
}
async function recover(i,screen){
 // Run the existing scheduler-owned remediation first. Never turn AUTO on in
 // town or enable it for a stale/unknown target merely because a model said so.
 const local=await i.progressionTick?.(screen);if(local)return local;
 const room=require('./room-policy').currentRoom(i);
 if(room==='town'||!i.goal?.monsterId||i.goal.mapId!==room)return null;
 return await i.farmGuardTick?.(screen)?'existing watchdog verified native recovery':null;
}
module.exports={run,recover};
