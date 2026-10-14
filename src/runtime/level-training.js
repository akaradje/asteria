'use strict';
const kinds=new Set(['exp','income','refine','pet','bestiary','wing','gear','craft','promotion']);
async function tick(i,screen){
 const g=i.goal;if(!g?.monsterId||!kinds.has(g.kind)||i.lastSave?.lv>=i.catalog().world?.MAX_LV)return null;
 if(screen.death||screen.panelOpen||i.pendingTravel||i.teamControl||i.dailyTeamPending||i.choresBusy||i.recycling||i.survivalRecovery||i.v2?.sourceCoherence?.matches===false||!require('./freshness').decisionGate(i).allowed||require('./room-policy').roomPolicy(i.livePos?.room).dungeon||i.livePos?.room!==g.mapId)return null;
 const key=[i.catalog().build,g.mapId,g.monsterId].join(':');
 if(i.managedHuntReady===key&&screen.autoOn==='true')return null;
 if(!i.canDo('levelTrainingTarget',15000))return 'training: waiting for target verification cooldown';
 await i.expeditionAuto(false);
 const selected=await require('./main-quest').selectTarget(i,g);
 i.levelTrainingStatus={at:Date.now(),build:i.catalog().build,mapId:g.mapId,monsterId:g.monsterId,status:selected?'target_confirmed':'target_unavailable',evidence:selected?'native_hunt_target_control':'no_matching_native_target'};
 if(!selected)return 'training: target unavailable; AUTO off';
 await i.expeditionAuto(true);return 'training: verified target '+g.monsterId;
}
module.exports={tick};
