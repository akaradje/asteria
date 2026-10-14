'use strict';
// The AI sets strategy without a stall or model consensus. Native executors
// implement its intent with current eligibility, ownership and receipt checks.
function feasibleFocus(action,m){
 if(action==='focus_income'&&m?.personalBrain?.lowFunds===false)return false;
 const gates=m?.executionGates,refine=gates?.refine;
 if(action==='focus_refine'&&(refine?.status==='pending'||refine?.kind==='refine'&&['unresolved','change_observed','spent_without_change'].includes(refine.status)))return false;
 if(action==='focus_craft'&&m?.personalBrain?.craft?.ready&&gates?.craft)return false;
 return true;
}
function allowed(action,m,p,now=Date.now()){
 const focus=Object.hasOwn(require('../character-brain').FOCUSES,action);
 if(!m||!/^actor-[a-f0-9]{32}$/.test(m.actorId||'')||!m.build||m.status!=='playing'||m.busy&&!focus&&action!=='sync_game'||!Number.isFinite(m.saveAgeSeconds)||m.saveAgeSeconds<0||m.saveAgeSeconds>30||!focus&&action!=='sync_game'&&(!Number.isFinite(m.noProgressSeconds)||m.noProgressSeconds<120))return false;
 if(p?.version!==2||p.actorId!==m.actorId||p.build!==m.build||p.maxSpend!==0||!Number.isFinite(p.at)||p.at>now||now-p.at>120000||!Number.isFinite(p.expiresAt)||p.expiresAt<=now||p.expiresAt>p.at+120000||p.stopRule?.stopOnUncertain!==true||p.stopRule?.maxDeaths!==0||!Number.isSafeInteger(p.stopRule?.maxActiveMs)||p.stopRule.maxActiveMs<1000||p.stopRule.maxActiveMs>900000||!Array.isArray(p.evidenceIds)||!p.evidenceIds.length||p.evidenceIds.some(id=>typeof id!=='string'||!id.startsWith(m.actorId+':')))return false;
 if(action==='sync_game')return m.system?.needsReview===true&&m.system.liveFresh===true;
 if(m.recovery?.blockedNodes?.some(n=>['evidence','health'].includes(n)||n==='execute'&&!focus&&m.independentStrategy!==true)||m.recovery?.suppressedActions?.includes('replan'))return false;
 if(m.development?.campaign?.ready&&['class','wing'].includes(m.development.campaign.phase))return false;
 if(action==='review_route')return true;
 if(!['focus_craft','focus_gear','focus_refine','focus_growth','focus_income'].includes(action)||!m.personalBrain?.availableFocuses?.includes(action)||!feasibleFocus(action,m))return false;
 if(action==='focus_income')return m.personalBrain.lowFunds===true;
 if(action==='focus_growth')return m.level<120||['pet','class','wing'].includes(m.personalBrain.milestones?.stage);
 return true;
}
module.exports={allowed,feasibleFocus};
