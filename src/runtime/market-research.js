'use strict';
const {fresh}=require('./freshness');
function eligible(i,s,now){
 if(i.status!=='playing'||i.livePos?.room!=='town'||s?.death||s?.panelOpen||i.recycling||i.choresBusy||i.pendingTravel||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.assistanceReservation||i.healthRecovery||i.survivalRecovery||i.aiPending)return false;
 if(i.v2?.sourceCoherence?.matches!==true||!fresh(i.lastSaveAt,30000,now)||!fresh(i.vitals?.at,15000,now)||i.vitals.hp<.85||i.v2?.journal?.pending()||i.v2?.trial?.active())return false;
 if(i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))return false;
 // Native mq has no query correlation ID: never compete with the class buyer.
 if(require('./promotion-priority').target(i)||i.promotionMarketQuery)return false;
 return !!i.socialInbox?.market&&i.socialInbox.generation>0;
}
async function tick(i,s,now=Date.now()){
 const state=i.marketResearchStatus;
 if(state?.state==='requested'){
  const board=i.socialInbox?.market?.board;
  if(board&&board.generation===state.generation&&board.at>=state.requestedAt){i.marketResearchStatus={...state,state:'observed',receivedAt:board.at,visibleListings:board.list.length,total:board.total,queryComplete:board.queryComplete,parametersKnown:[board.tax,board.fee,board.max].every(x=>x!==null),mode:'read_only'};}
  else if(now-state.requestedAt>=15000||state.generation!==i.socialInbox?.generation)i.marketResearchStatus={...state,state:'response_unverified',mode:'read_only'};
  if(i.marketResearchStatus?.state==='observed')require('../planning/market-shadow').observe(i,now);
  return;
 }
 if(!eligible(i,s,now)||state&&now<state.nextAt)return;
 const owner=i.v2?.scheduler?.context?.getStore();if(!owner||owner.kind!=='tick'||i.v2.scheduler.closed)return;
 i.v2.scheduler.checkpoint();
 i.marketResearchStatus={state:'requested',requestedAt:now,generation:i.socialInbox.generation,nextAt:now+300000+(i.slot||0)*1700,mode:'read_only'};
 try{const result=await i.socialSend('mq',{q:'',cat:'all',sort:'cheap',slot:''});if(result?.ok!==true)i.marketResearchStatus.state='query_not_sent';}
 catch{i.marketResearchStatus.state='response_unverified';}
}
module.exports={eligible,tick};
