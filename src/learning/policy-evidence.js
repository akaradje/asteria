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
module.exports={assess};
