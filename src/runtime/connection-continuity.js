'use strict';
// The rejected call has unwound. Yield to a NEW tick, never retry its command,
// change its contract, clear a payment or treat a read timeout as a receipt.
function category(e){
 const m=String(e?.message||'');
 if(e?.code==='ASTERIA_CAPACITY_TRANSPORT_WAIT'&&m==='capacity settlement transport unavailable')return 'capacity_acknowledgement_transport';
 if(/^page\.evaluate: Execution context was destroyed, most likely because of a navigation/.test(m))return 'navigation_context_changed';
 if(m==='action contract rejected: connection generation changed while queued')return 'connection_generation_changed';
 if(m==='native save diagnostic timeout')return 'native_read_timeout';
 return null;
}
function pause(i,e,now=Date.now()){
 const kind=category(e),page=i.page;
 if(kind==='capacity_acknowledgement_transport'&&(!i.capacityGrant||i.capacityGrant.id!==e.capacityId||i.enrollmentId))return null;
 if(!kind||!page||page.isClosed?.()||i.evalFencedPage===page||i.recycling||i.healthRecovery||i.status!=='playing'||!i.actorOwner||!i.registryV32?.policy||i.registryV32?.store?.validateOwner(i.actorOwner)!==true||!require('../registry/worker').valid(i))return null;
 const old=i.connectionContinuity,within=old&&now>=old.windowAt&&now-old.windowAt<120000,count=within?old.count+1:1;
 i.connectionContinuity={at:now,windowAt:within?old.windowAt:now,count,category:kind,state:count<=3?'waiting_fresh_context':'escalate_cleanup',retryAt:now+Math.min(8000,2000*2**(count-1)),paymentReplayAllowed:false};
 return count<=3?i.connectionContinuity:null;
}
async function settled(i){
 const grant=i.capacityGrant,owner=i.actorOwner,assignment=i.globalAssignment;
 try{return await require('../registry/worker').settled(i);}
 catch(e){
  // Existing exact-owner capacity release is idempotent. No new grant, login,
  // native payment or enrollment may be retried through this boundary.
  if(!grant||i.capacityGrant!==grant||i.actorOwner!==owner||i.globalAssignment!==assignment||i.enrollmentId||!['fetch failed','private_authority_unavailable'].includes(e.message))throw e;
  throw Object.assign(Error('capacity settlement transport unavailable'),{code:'ASTERIA_CAPACITY_TRANSPORT_WAIT',capacityId:grant.id});
 }
}
module.exports={category,pause,settled};
