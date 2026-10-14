'use strict';
// Close only a proven idle executor of an old unknown refinement. A new native
// server load can rebase its budget; it never certifies or replays that payment.
const fresh=require('./freshness').fresh;
const unknown=new Set(['pending','unresolved','change_observed','spent_without_change']);
function inspect(i,now=Date.now(),owned=false){
 const rows=i.developmentLedger?.rows;
 const row=Array.isArray(rows)?rows.find(r=>['craft','refine'].includes(r.kind)&&unknown.has(r.status)&&Number.isFinite(r.at)&&now-r.at>=600000):null;
 if(!row)return {state:'idle'};
 const base={transactionId:row.id,ageMs:now-row.at,target:row.target?.id||null,spend:0,replayed:false};
 const blocked=reason=>({...base,state:'waiting',reason});
 const cat=i.catalog?.(),actor=i.actorIdentity?.actorId,c=row.context;
 // A reconnect can close the paid executor too soon for the sixty-second
 // native rebase fence. Close the now-idle current executor once, after the
 // original request has aged; keep its identity and unknown outcome intact.
 if(!/^actor-[a-f0-9]{32}$/.test(actor||'')||!cat?.build||!c||row.legacyIdentityUnknown||c.actorId!==actor||c.build!==cat.build||!Number.isFinite(c.sessionStartedAt)||!Number.isFinite(i.bagSessionStartedAt)||c.sessionStartedAt>i.bagSessionStartedAt||row.at<c.sessionStartedAt)return blocked('same actor/build/current executor required');
 if(i.autoChores!==true||i.status!=='playing'||i.recycling||i.healthRecovery||i.survivalRecovery||i.livePos?.dead||!fresh(i.lastSaveAt,30000,now)||!fresh(i.livePos?.at,10000,now)||i.v2?.sourceCoherence?.matches!==true)return blocked('fresh safe native actor required');
 if(i.tickBusy||i.choresBusy||i.fleetActivityBusy||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||i.v2?.trial?.active()||/^(tw|dx|gd|pv)/.test(i.livePos?.room||'')||require('./team-trade').blocksNavigation(i))return blocked('current owner must finish');
 const scheduler=i.v2?.scheduler,active=scheduler?.active;
 if(!scheduler||active&&!(owned&&active.kind==='paid-outcome-recovery')||scheduler.queue?.length)return blocked('idle native scheduler required');
 if(i.pvpMission||[...Object.values(i.activityState||{}),...Object.values(require('../planning/fleet-activity').publicActivity(i))].some(s=>s?.run&&!s.run.done))return blocked('native activity still active');
 const proof=[i.acceptedSaveReceipt?.proof,i.serverSaveReceipt?.proof].find(p=>['server_accepted_save','server_readback'].includes(p?.authority)&&p.actorId===actor&&p.build===cat.build&&p.sessionStartedAt===i.bagSessionStartedAt&&p.generation===i.socialInbox?.generation&&Number.isSafeInteger(p.rev)&&p.rev>c.baselineRev&&fresh(p.at,30000,now)&&Number.isFinite(p.requestAt)&&p.requestAt>=p.sessionStartedAt&&p.requestAt<=p.at);
 if(!proof)return blocked('fresh same-session server receipt required');
 if(row.executorRecovery?.attempted)return blocked('one recovery attempted; await native reconciliation');
 if(i.nativeFreshSaveFlight)return blocked('native save still in flight');
 return {...base,state:'recoverable',proof:{at:proof.at,rev:proof.rev},reason:'old refinement unknown; close executor and observe native load'};
}
function rebaseCurrent(i,a){
 const p=a.proof,state=a.state,cat=i.catalog(),actor=i.actorIdentity?.actorId;if(!require('./closed-gear-scope').native(i)||p.actorId!==actor||p.build!==cat.build||p.generation!==i.socialInbox?.generation||p.sessionStartedAt!==i.bagSessionStartedAt||!fresh(p.at,30000))return false;
 let changed=false;for(const r of i.developmentLedger.rows){const c=r.context,id=r.target?.id;
  if(r.kind!=='refine'||r.legacyIdentityUnknown||!unknown.has(r.status)||!c||c.actorId!==actor||!cat.items[id]||!Number.isSafeInteger(c.baselineRev)||p.rev<=c.baselineRev||!Number.isFinite(r.at)||p.sessionStartedAt-r.at<60000)continue;
  const owned=require('./typed-upgrade-cost').gear(state,id),before=r.before?.refine?.[id]??(Object.values(r.before?.equip||{}).includes(id)?0:null),current=state.refine?.[id]??(owned!==null?0:null);
  if(!Number.isSafeInteger(owned)||owned<0||!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(current)||current<0||current>cat.world.REFINE.max)continue;
  r.originalOutcome||={status:r.status,evidence:r.evidence,finishedAt:r.finishedAt};r.status='reconciled_refine_state';r.evidence='native_current_refine_after_closed_session';r.finishedAt=p.at;r.reconciliation={...p,targetId:id,beforeRefine:before,currentRefine:current,currentOwned:owned,currentStateOnly:true,costKnown:false,historicalSuccessKnown:false,replayBlocked:true,budgetRebased:true};changed=true;
 }
 if(changed)i.developmentLedger.save();return changed;
}
async function readback(i,now=Date.now()){
 const rows=i.developmentLedger?.rows||[],actor=i.actorIdentity?.actorId;
 const closed=rows.some(r=>unknown.has(r.status)&&r.context?.actorId===actor&&Number.isFinite(r.at)&&i.bagSessionStartedAt-r.at>=60000&&['craft','refine'].includes(r.kind));
 if(!closed||i.paidReadbackFlight||!i.canDo?.('closedPaidReadback',30000)||i.activeResourceClaim||i.activeDevelopmentAttempt||i.recycling||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.v2?.sourceCoherence?.matches!==true||i.registryV32?.store?.validateOwner(i.actorOwner)!==true||!require('./freshness').decisionGate(i,now).allowed||i.page&&i.evalFencedPage===i.page||require('./team-trade').blocksNavigation(i))return false;
 i.paidReadbackFlight=true;
 try{const a=await require('./isolated-storage').readback(i);if(!a||!require('./closed-gear-scope').native(i))return false;const l=i.developmentLedger,changed=l.rebaseUncertainCraft(a.state,a.proof,i.catalog())|l.reconcileRefineState(a.state,a.proof,i.catalog())|rebaseCurrent(i,a);
  if(changed)for(const claim of i.v2?.reservations?.data.claims||[]){const row=l.rows.find(r=>r.id===claim.transactionId);if(require('./native-reservation-result').result(row,actor)==='RECONCILED')i.v2.reservations.finish(claim.id,'RECONCILED');}
  i.paidOutcomeReadback={at:Date.now(),changed:!!changed,proof:a.proof,historicalSuccessKnown:false,historicalCostKnown:false,replayed:false};return !!changed;
 }catch{return false;}finally{i.paidReadbackFlight=false;}
}
async function tick(i){
 if(await readback(i))return 'closed paid native budget rebased; original outcome unknown and never replayed';
 const view=inspect(i);i.paidOutcomeRecovery=view;
 if(view.state!=='recoverable'||typeof i.recycle!=='function')return null;
 try{return await i.v2.scheduler.run('paid-outcome-recovery',async()=>{
  const current=inspect(i,Date.now(),true);i.paidOutcomeRecovery=current;
  if(current.state!=='recoverable')return null;
  const row=i.developmentLedger.rows.find(r=>r.id===current.transactionId);
  row.executorRecovery={attempted:true,at:Date.now(),originalStatus:row.status,sessionStartedAt:i.bagSessionStartedAt,build:i.catalog().build,nativeProof:current.proof,replayed:false};
  if(row.status==='pending'){row.status='unresolved';row.evidence='historical_outcome_unknown_preserved_no_replay';}
  i.developmentLedger.save();
  // Publish recovery before waiting for the shared recycle queue. Peers cannot
  // accept a new team action while this actor closes its old owned executor.
  const page=i.page;i.status='recycling';
  try{
   const result=await i.recycle('AI execution: reconcile old unknown refinement without replay');
   if(result===false&&i.page===page&&!i.recycling)i.status='playing';
   i.paidOutcomeRecovery={...current,state:result===true?'awaiting_native_reconciliation':'recovery_not_confirmed',attempted:true,at:Date.now(),reason:'executor recovery is not a payment receipt'};
   return i.paidOutcomeRecovery.state;
  }catch(e){i.paidOutcomeRecovery={...current,state:'recovery_not_confirmed',attempted:true,reason:'original outcome retained; no replay'};throw e;}
 },{priority:0,leaseMs:900000,contract:require('./action-contract').contract(i,'recycle',{recovery:true})});}catch{i.paidOutcomeRecovery={...view,state:'recovery_not_confirmed',reason:'native recovery not confirmed; original outcome retained'};return 'paid outcome recovery not confirmed';}
}
module.exports={inspect,tick,readback,rebaseCurrent};
