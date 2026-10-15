'use strict';
// A new budgeted roll is a new intent. It cannot certify, amend or resend the
// archived transaction whose executor has closed. The policy is explicit.
function enabled(i){return require('../equipment-goal').policy(i.catalog()).freshRefineAfterClosedOutcome===true;}
function allowed(i,id,now=Date.now(),continuation=null){
 if(!enabled(i)||!require('./closed-gear-scope').native(i,now))return false;
 const receipt=i.serverSaveReceipt,p=receipt.proof,s=receipt.state,live=i.lastSave;
 if(now-p.at>60000||i.status!=='playing'||i.autoChores!==true||i.recycling||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||i.survivalRecovery||i.v2?.trial?.active()||require('./team-trade').blocksNavigation(i))return false;
 if(!Object.values(s.equip).includes(id)||!Object.values(live?.equip||{}).includes(id)||(s.refine[id]??0)!==(live.refine?.[id]??0)||!Number.isInteger(s.refine[id]??0)||(s.refine[id]??0)<0||(s.refine[id]??0)>=i.catalog().world?.REFINE?.max)return false;
 // Exclude only this executor's exact tracked preparation at final dispatch.
 if((i.developmentLedger?.rows||[]).some(r=>['pending','unresolved','change_observed','spent_without_change'].includes(r.status)&&!(r.id===i.activeDevelopmentAttempt?.id&&r.kind==='refine'&&r.status==='pending'&&(r.dispatchTracking?.state==='preparing'||continuation===r&&r.dispatchTracking?.state==='dispatched')&&r.target?.id===id&&r.context?.actorId===p.actorId&&r.context?.build===p.build&&r.context?.sessionStartedAt===p.sessionStartedAt&&r.context?.generation===p.generation)))return false;
 return true;
}
function evidence(i,id,now=Date.now()){
 if(!allowed(i,id,now))return null;
 const old=(i.developmentLedger?.rows||[]).filter(r=>r.kind==='refine'&&r.target?.id===id&&r.reconciliation?.replayBlocked===true&&r.reconciliation.historicalSuccessKnown===false&&require('./native-reservation-result').result(r,i.actorIdentity.actorId)==='RECONCILED');
 const legacy=(i.v2?.journal?.rows||[]).filter(r=>r.kind==='refine'&&r.target?.id===id&&require('./closed-gear-scope').history(i,r,now));
 if(!old.length&&!legacy.length)return null;
 const historyArchives=require('./refine-history-archive').preserve(i,legacy);
 return {version:2,kind:'new_budgeted_refine_intent',at:now,targetId:id,from:i.serverSaveReceipt.state.refine[id]??0,proof:{...i.serverSaveReceipt.proof},nativeBudget:{coins:i.serverSaveReceipt.state.coins,materials:{...i.serverSaveReceipt.state.materials}},originalTransactionIds:[...old.map(r=>r.id),...legacy.flatMap(r=>[r.id,r.id.replace(/^development:/,'')])],historyTransactionIds:legacy.map(r=>r.id),historyArchives,historicalSuccessKnown:false,historicalCostKnown:false,replayed:false};
}
function dispatch(i,row,step,now=Date.now(),continuation=false){
 if([row?.id,i.activeResourceClaim?.id,i.activeDevelopmentAttempt?.id].some(id=>require('./legacy-material-reserve').blocked(i,id)))return false;
 if(!require('./legacy-material-reserve').verified(i))return false;
 const e=row?.freshNativeIntent;
 if(!e)return true;
 return e.version===2&&e.kind==='new_budgeted_refine_intent'&&Array.isArray(e.originalTransactionIds)&&row.id!==undefined&&!e.originalTransactionIds.includes(row.id)&&e.targetId===step.id&&e.from===step.from&&require('./refine-history-archive').verified(i,e)&&row.context?.actorId===e.proof.actorId&&row.context?.build===e.proof.build&&row.context?.sessionStartedAt===e.proof.sessionStartedAt&&row.context?.generation===e.proof.generation&&allowed(i,step.id,now,continuation?row:null);
}
async function prepare(i,row,step){
 if(row&&(row.status!=='pending'||row.dispatchTracking?.state!=='preparing'||i.activeDevelopmentAttempt?.id!==row.id))return false;
 if(dispatch(i,row,step))return true;
 const e=row?.freshNativeIntent,c=row?.context,p=i.serverSaveReceipt?.proof,now=Date.now();
 if(!e||e.version!==2||e.kind!=='new_budgeted_refine_intent'||!Array.isArray(e.originalTransactionIds)||e.originalTransactionIds.includes(row.id)||e.targetId!==step.id||e.from!==step.from||!require('./refine-history-archive').verified(i,e)||!require('./legacy-material-reserve').verified(i)||[row.id,i.activeResourceClaim?.id].some(id=>require('./legacy-material-reserve').blocked(i,id)))return false;
 if((i.developmentLedger?.rows||[]).some(r=>r.id!==row.id&&['pending','unresolved','change_observed','spent_without_change'].includes(r.status)))return false;
 // A single zero-spend GET may renew ownership after the NPC search. Keep the
 // original intent/proof, baseline wallet and all payment contracts unchanged.
 if(!e||row.status!=='pending'||row.dispatchTracking?.state!=='preparing'||row.preDispatchReadback||i.activeDevelopmentAttempt?.id!==row.id||i.activeDevelopmentAttempt?.kind!=='refine'||c?.actorId!==i.actorIdentity?.actorId||c.build!==i.catalog().build||c.sessionStartedAt!==i.bagSessionStartedAt||c.generation!==i.socialInbox?.generation||p?.actorId!==c.actorId||p.build!==c.build||p.sessionStartedAt!==c.sessionStartedAt||p.generation!==c.generation||now-p.at<30000||!require('./closed-gear-scope').native(i,now)||i.livePos?.room!=='town'||i.livePos?.dead||i.status!=='playing'||i.recycling||i.healthRecovery||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||i.survivalRecovery||i.v2?.trial?.active()||require('./team-trade').blocksNavigation(i)||i.nativeReadbackFlight||i.nativeFreshSaveFlight)return false;
 row.preDispatchReadback={state:'requested',at:now,replayAllowed:false};i.developmentLedger.save();
 let receipt;try{receipt=await require('./native-save-probe').authoritativeReadback(i);}catch{}
 const typed=require('./typed-upgrade-cost'),cost=row.expectedCost,types=row.costTypes;
 const sameBudget=!!cost&&Object.keys(cost).length>0&&!!types&&Object.entries(cost).every(([name,n])=>{const before=typed.amount(row.before,types[name]),after=typed.amount(receipt?.state,types[name]);return Number.isSafeInteger(n)&&n>=0&&before!==null&&before===after&&after>=n;});
 const verified=row.status==='pending'&&row.dispatchTracking?.state==='preparing'&&i.activeDevelopmentAttempt?.id===row.id&&receipt===i.serverSaveReceipt&&receipt?.proof?.requestAt>=now&&sameBudget&&dispatch(i,row,step);
 row.preDispatchReadback={...row.preDispatchReadback,state:verified?'verified':'not_verified',finishedAt:Date.now(),...(receipt?.proof?{proof:{...receipt.proof}}:{})};i.developmentLedger.save();return !!verified;
}
module.exports={enabled,allowed,evidence,dispatch,prepare};
