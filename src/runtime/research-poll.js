'use strict';
const {fresh}=require('./freshness');
// Public research has no navigation/payment owner. One observer per host, one
// request per family per five minutes, coalesced with existing class queries.
async function poll(i,now=Date.now()){
 if(i.slot!==0||i.researchPolling||i.status!=='playing'||i.recycling||i.healthRecovery||i.v2?.sourceCoherence?.matches!==true||!fresh(i.lastSaveAt,30000,now)||!i.socialInbox?.generation||i.socialInbox.criticalGap||i.resourceHealth?.mode==='reduced')return false;
 if(i.researchPollAt&&now-i.researchPollAt<300000)return false;
 const market=i.socialInbox.market,lab=i.socialInbox.buildLab;
 const requestMarket=market&&!fresh(market.board?.at,30000,now)&&!i.promotionMarketQuery&&!require('./promotion-priority').target(i);
 const requestLab=lab&&!fresh(lab.status?.at,30000,now)&&!lab.session?.active;
 if(!requestMarket&&!requestLab)return false;
 i.researchPolling=true;i.researchPollAt=now;i.researchPollStatus={at:now,market:'not_required',lab:'not_required',mode:'read_only_no_entry_or_payment'};
 try{
  if(requestMarket){const r=await i.socialSend('mq',{q:'',cat:'all',sort:'cheap',slot:''});i.researchPollStatus.market=r?.ok===true?'requested':'not_sent';}
  if(requestLab){const r=await i.socialSend('btq',{});i.researchPollStatus.lab=r?.ok===true?'requested':'not_sent';}
 }catch{i.researchPollStatus.error='read_request_unverified';}finally{i.researchPolling=false;}
 return true;
}
module.exports={poll};
