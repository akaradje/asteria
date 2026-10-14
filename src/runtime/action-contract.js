'use strict';
const {decisionGate}=require('./freshness');
const build=i=>i.cache?.dir?require('path').basename(i.cache.dir):i.buildHash;
// Revalidate at dispatch, including nested actions already owned by tick.
function contract(i,kind,{recovery=false,now=Date.now}={}){
 const createdAt=now(),page=i.page,revision=build(i),actorId=i.actorIdentity?.actorId,owner=i.actorOwner,policyRevision=i.registryV32?.policy.policyRevision,generation=i.socialInbox?.generation;
 // A chain owns several individually bounded native gate crossings. The old
 // three-minute dispatch deadline expired between healthy hops. Keep the
 // scheduler's fifteen-minute hard bound; every checkpoint still requires
 // fresh save/position and the same page/build. Paid actions keep three minutes.
 // Recovery includes a bounded shared queue and up to nine minutes of native
 // navigation/selector/boot waits. A three-minute contract cancelled valid boots.
 // Keep the scheduler's fifteen-minute hard bound; payments retain three minutes.
 const duration=recovery||kind==='chainWalkTo'?900000:180000;
 let transitioning=false;
 const result={version:4,kind,createdAt,deadline:createdAt+duration,beginRecovery(){
  if(!recovery||!['recycle','hardReload'].includes(kind))throw Error('Not a native recovery contract');
  const verdict=result.validate(now());if(!verdict.allowed)throw Error('Recovery start rejected: '+verdict.reason);
  if(now()>=result.deadline)throw Error('Recovery start expired');
  transitioning=true;
 },validate(at){
  if(actorId&&actorId!==i.actorIdentity?.actorId)return {allowed:false,reason:'actor identity changed while queued'};
  if(!transitioning&&generation!==undefined&&generation!==i.socialInbox?.generation)return {allowed:false,reason:'connection generation changed while queued'};
  if(owner&&(!i.registryV32?.store.validateOwner(owner)||policyRevision!==i.registryV32?.policy.policyRevision))return {allowed:false,reason:'owner fence or policy revision changed'};
  if(!require('../registry/worker').valid(i))return {allowed:false,reason:'global assignment fenced'};
  if(recovery)return revision===build(i)?{allowed:true}:{allowed:false,reason:'recovery build changed'};
  if(i.page&&i.evalFencedPage===i.page)return {allowed:false,reason:'old evaluation unsettled; close context before any new action'};
  if(i.socialInbox?.criticalGap)return {allowed:false,reason:'critical observation overflow/parse gap; reconciliation required'};
  if(page!==i.page||revision!==build(i))return {allowed:false,reason:'session or build changed while queued'};
  const gate=decisionGate(i,at);
  if(gate.reason==='fresh_save_required'&&require('./trade-dispatch').allowed(i,kind,at))return {allowed:true,reason:'owned_native_trade_pauses_periodic_saves'};
  return gate;
 }};return result;
}
module.exports={contract};
