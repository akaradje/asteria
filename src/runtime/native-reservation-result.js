'use strict';
function result(row,actorId){
 if(!row||row.legacyIdentityUnknown||row.context?.actorId!==actorId)return null;
 if(row.status==='reconciled_craft_unknown'&&row.evidence==='native_current_budget_after_closed_craft_session'){
  const p=row.reconciliation,c=row.context;
  if(row.kind==='craft'&&p?.authority==='server_readback'&&p.actorId===actorId&&p.build&&p.budgetRebased===true&&p.replayBlocked===true&&p.costKnown===false&&p.historicalSuccessKnown===false&&Number.isInteger(p.generation)&&Number.isSafeInteger(p.rev)&&p.rev>c.baselineRev&&Number.isFinite(p.sessionStartedAt)&&p.sessionStartedAt-row.at>=60000&&p.requestAt>=p.sessionStartedAt&&p.at>=p.requestAt&&p.at-p.requestAt<=30000&&p.targetId===row.target?.id&&Number.isSafeInteger(p.currentOwned)&&p.currentOwned>=0)return 'RECONCILED';
  return null;
 }
 if(row.status==='reconciled_refine_state'&&row.evidence==='native_current_refine_after_closed_session'){
  const p=row.reconciliation,c=row.context;
  if(row.kind==='refine'&&p?.authority==='server_readback'&&p.actorId===actorId&&p.build&&p.budgetRebased===true&&p.replayBlocked===true&&p.costKnown===false&&p.historicalSuccessKnown===false&&Number.isInteger(p.generation)&&Number.isSafeInteger(p.rev)&&p.rev>c.baselineRev&&Number.isFinite(p.sessionStartedAt)&&p.sessionStartedAt-row.at>=60000&&p.requestAt>=p.sessionStartedAt&&p.at>=p.requestAt&&p.at-p.requestAt<=30000&&p.targetId===row.target?.id&&Number.isInteger(p.beforeRefine)&&p.beforeRefine>=0&&Number.isInteger(p.currentRefine)&&(p.currentRefine>=p.beforeRefine||p.currentStateOnly===true&&Number.isSafeInteger(p.currentOwned)&&p.currentOwned>=0&&p.currentRefine>=0))return 'RECONCILED';
  return null;
 }
 if(row.status==='reconciled_craft_state'&&row.evidence==='native_current_inventory_after_closed_session'){
  const p=row.reconciliation,c=row.context;
  if(row.kind==='craft'&&p?.budgetRebased===true&&p.replayBlocked===true&&p.costKnown===false&&p.historicalSuccessKnown===false&&['server_readback','server_accepted_save'].includes(p.authority)&&p.actorId===actorId&&p.build===c.build&&Number.isInteger(p.generation)&&Number.isSafeInteger(p.rev)&&p.rev>c.baselineRev&&Number.isFinite(p.sessionStartedAt)&&p.sessionStartedAt-row.at>=60000&&p.requestAt>=p.sessionStartedAt&&p.at>=p.requestAt&&p.targetId===row.target?.id&&p.currentOwned>=p.observedOwned&&p.observedOwned>0)return 'RECONCILED';
  return null;
 }
 if(!['server_confirmed','server_no_increase','reconciled_increase','reconciled_no_increase'].includes(row.status)||row.evidence!=='server_accepted_exact_save_revision')return null;
 const c=row.context,p=row.serverReceipt;
 if(!p||p.actorId!==c.actorId||p.build!==c.build||p.generation!==c.generation||p.sessionStartedAt!==c.sessionStartedAt||!Number.isSafeInteger(p.rev)||p.rev<=c.baselineRev||!Number.isFinite(p.at)||!Number.isFinite(p.requestAt)||p.requestAt<=row.at||p.at<p.requestAt)return null;
 return 'CONFIRMED'; // A server-proven failed refine settles spending too.
}
function reconcile(i){for(const claim of i.v2?.reservations?.data.claims||[]){if(claim.status!=='UNCERTAIN'||!claim.transactionId)continue;const row=i.developmentLedger?.rows?.find(r=>r.id===claim.transactionId),status=result(row,i.actorIdentity?.actorId);if(status)i.v2.reservations.finish(claim.id,status);}}
module.exports={result,reconcile};
