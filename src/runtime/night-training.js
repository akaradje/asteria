'use strict';
async function tick(i,screen){
 const now=Date.now();
 if(screen.death||screen.panelOpen||i.teamControl||i.recycling||i.choresBusy||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.survivalRecovery||i.goal?.kind==='survival'||i.survivalStatus?.deaths?.length&&i.survivalStatus.until>now||i.v2?.trial?.active()&&i.v2.trial.active().purpose!=='route'||i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase)||require('./room-policy').roomPolicy(i.livePos?.room).dungeon)return null;
 const goal=require('../planning/night-training').select(i,require('../economy').loadWiki(i.root),now);if(!goal)return null;
 i.goal=goal;i.huntMap=goal.mapId;i.teamGoal=null;
 // The legacy director moves only from town. A useful old field keeps making
 // EXP, so its stall timer will never migrate it to the better selected field.
 if(i.livePos?.room!==goal.mapId&&i.livePos?.room!=='town'&&!i.pendingTravel&&i.canDo('nightTrainingRoute',45000)){
  await i.expeditionAuto(false);const home=await i.returnToTown();return home.ok?'night training: confirmed home then '+goal.mapId:'night training: waiting for native home route';
 }
 return null;
}
module.exports={tick};
