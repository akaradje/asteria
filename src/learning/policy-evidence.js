'use strict';
// A policy is scoped to exact actor/build/context. Statistical evidence never
// grants an action permission. Failures and interrupted trials remain visible.
function assess(rows,{actorId,build,signature,candidate,minimumCycles=30,minimumGain=.2,now=Date.now(),maxAgeMs=86400000}={}){
 if(!actorId||!build||!signature||!candidate||!Number.isSafeInteger(minimumCycles)||minimumCycles<30||!Number.isFinite(minimumGain)||minimumGain<0)return {state:'UNAVAILABLE',reason:'predeclared_exact_context_required'};
 const matching=rows.filter(r=>r.actorId===actorId&&r.build===build&&r.signature===signature&&r.candidate===candidate&&Number.isFinite(r.finishedAt)&&r.finishedAt<=now&&now-r.finishedAt<=maxAgeMs);
 const unique=[...new Map(matching.filter(r=>typeof r.id==='string').map(r=>[r.id,r])).values()];
 const failures=unique.filter(r=>r.status==='safety_abort'),usable=unique.filter(r=>['accepted','rejected'].includes(r.status)&&r.candidateCoverage>=.9&&Number.isFinite(r.baselineRate)&&r.baselineRate>0&&Number.isFinite(r.candidateRate)&&r.candidateRate>=0&&r.minimumGain===minimumGain&&r.causalVerified!==true);
 const base={scope:{actorId,build,signature,candidate},cycles:unique.length,comparableCycles:usable.length,negativeCycles:usable.filter(r=>r.status==='rejected').length,safetyAborts:failures.length,censored:unique.length-usable.length,causalVerified:false,fieldValidationRequired:true};
 if(failures.length)return {...base,state:'REJECTED',reason:'survival_budget_exceeded'};
 if(usable.length<minimumCycles)return {...base,state:'INCONCLUSIVE',reason:'insufficient_comparable_whole_cycles'};
 // Wins are capped at +100%, losses at -100%; no single huge ratio dominates.
 const gains=usable.map(r=>Math.max(-1,Math.min(1,r.candidateRate/r.baselineRate-1))),mean=gains.reduce((a,b)=>a+b,0)/gains.length;
 const radius=2*Math.sqrt(Math.log(40)/(2*gains.length)),lower=mean-radius;
 return {...base,state:lower>minimumGain?'PROMOTION_CANDIDATE':'INCONCLUSIVE',meanRelativeGain:mean,lowerBound:lower,confidenceMethod:'bounded_Hoeffding_95pct_requires_independent_cycles',independenceVerified:false,executable:false,reason:lower>minimumGain?'effect_threshold_met_pending_independence_and_field_review':'uncertainty_exceeds_gain'};
}
function combatStratum(r){return JSON.stringify([r.actorId,r.build,r.sourceSignature,r.session,r.generation,r.job,r.level,r.role,r.map,r.target,r.party]);}
function combatRate(r){if(!r?.ready||r.confounded===true||r.deaths!==0||r.observedMs<300000||r.samples<10)return null;if(r.role==='dps')return r.killsPerHour>0&&r.dps>0?r.killsPerHour:null;if(r.role==='tank')return r.damageTakenPerSecond>0&&Number.isFinite(r.potionsPerMinute)?1/(r.damageTakenPerSecond*(1+r.potionsPerMinute)):null;return null;}
// Naturally observed A/B/A windows, with no overlapping cycles. This can adopt
// an owned loadout preference, never authorize a reset, enchant or transaction.
function assessCombat(windows,context,{now=Date.now(),minimumCycles=30,minimumGain=.2}={}){
 if(!context?.actorId||!context.build||!context.sourceSignature||!context.loadoutSignature||!Number.isSafeInteger(minimumCycles)||minimumCycles<30||!Number.isFinite(minimumGain)||minimumGain<.2)return {state:'UNAVAILABLE',reason:'exact_native_context_required',automatic:false};
 if(windows.some(w=>w.observedMs<300000))windows=require('./combat-windows').aggregate(windows,{now}).map(require('./combat-evidence').metrics);
 const strata=combatStratum(context),rows=[...new Map(windows.filter(w=>typeof w.id==='string').map(w=>[w.id,w])).values()].filter(r=>combatStratum(r)===strata&&Number.isFinite(r.startedAt)&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<=86400000).sort((a,b)=>a.startedAt-b.startedAt),cycles=[];let end=-Infinity;
 for(let n=0;n+2<rows.length;n++){const [a,b,c]=rows.slice(n,n+3);if(a.startedAt<end||a.at>b.startedAt||b.at>c.startedAt||a.loadoutSignature!==c.loadoutSignature||b.loadoutSignature===a.loadoutSignature||b.loadoutSignature!==context.loadoutSignature)continue;const rates=[a,b,c].map(combatRate);if(rates.some(x=>!Number.isFinite(x)||x<=0))continue;const [base,treat,confirm]=rates;if(Math.abs(confirm/base-1)>.25)continue;if(b.role==='tank'&&(!Number.isFinite(b.killsPerHour)||b.killsPerHour<Math.min(a.killsPerHour,c.killsPerHour)*.8))continue;cycles.push({id:[a.id,b.id,c.id].join(':'),gain:Math.max(-1,Math.min(1,treat/Math.max(base,confirm)-1)),at:c.at});end=c.at;n+=2;}
 const failure=rows.some(r=>r.loadoutSignature===context.loadoutSignature&&r.deaths>0),mean=cycles.length?cycles.reduce((n,c)=>n+c.gain,0)/cycles.length:null,lower=mean===null?null:mean-2*Math.sqrt(Math.log(40)/(2*cycles.length)),automatic=!failure&&cycles.length>=minimumCycles&&lower>minimumGain;
 return {state:failure?'REJECTED':automatic?'PROMOTED':'INCONCLUSIVE',automatic,scope:{...context},cycles:cycles.length,cycleIds:cycles.map(c=>c.id),meanRelativeGain:mean,lowerBound:lower,at:now,reason:context.role==='support'?'party_outcome_and_uptime_evidence_required':failure?'candidate_death_observed':automatic?'repeated_matched_ABA_conservative_gain':'collect_nonoverlapping_matched_ABA_windows',causalVerified:false,independenceVerified:false,executable:false,spend:0};
}
module.exports={assess,assessCombat,combatRate,combatStratum};
