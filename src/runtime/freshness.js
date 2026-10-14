'use strict';
function fresh(at,maxAge,now=Date.now()){return Number.isFinite(at)&&at>0&&at<=now&&now-at<maxAge;}
function decisionGate(i,now=Date.now()){
 if(i.recycling||i.healthRecovery)return {allowed:false,reason:'recovery_in_progress'};
 if(!fresh(i.lastSaveAt,30000,now))return {allowed:false,reason:'fresh_save_required'};
 if(i.livePos&&!fresh(i.livePos.at,10000,now))return {allowed:false,reason:'fresh_position_required'};
 return {allowed:true,reason:'fresh_game_evidence'};
}
module.exports={fresh,decisionGate};
