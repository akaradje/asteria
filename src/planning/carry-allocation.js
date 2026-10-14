'use strict';
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
function allocate(previous,members,demands,{now=Date.now(),build,maxCarry=2,maxCommitmentMs=1200000}={}){
 const cohort=members.filter(m=>m.identity?.actorId),revision=hash([build,cohort.map(m=>m.identity.actorId).sort()]);
 const foundational=cohort.filter(m=>m.teamWork?.milestones?.equipmentAllowed),complete=cohort.filter(m=>m.teamWork?.equipment?.complete);
 const mode=foundational.length<Math.min(2,cohort.length)?'OPEN_CAPACITY':foundational.length<cohort.length?'EXPAND_PRODUCTION':complete.length<cohort.length?'COMPLETE_COHORT':'PUSH_VERIFIED_CAPS';
 const prior=previous?.cohortRevision===revision?previous:null,history=prior?.history||[],last=id=>history.filter(h=>h.actorId===id).at(-1)?.finishedAt||0;
 const candidates=cohort.filter(m=>!m.actionOwner&&m.vitals?.hp>=.85&&!m.livePos?.dead&&m.teamWork?.needs?.length).map(m=>({actorId:m.identity.actorId,name:m.charName,job:m.job,legendary:m.teamWork.equipment?.legendaryEquipped??null,gap:m.teamWork.equipment?8-m.teamWork.equipment.legendaryEquipped:null,priority:Math.min(...m.teamWork.needs.map(r=>r.priority)),last:last(m.identity.actorId)})).sort((a,b)=>a.priority-b.priority||a.last-b.last||(a.gap??99)-(b.gap??99)||a.actorId.localeCompare(b.actorId));
 let commitments=(prior?.commitments||[]).filter(c=>c.deadline>now&&c.mode===mode&&candidates.some(m=>m.actorId===c.actorId)&&demands.some(d=>d.receiver===c.name));
 for(const old of prior?.commitments||[])if(!commitments.some(c=>c.actorId===old.actorId)){const current=cohort.find(m=>m.identity.actorId===old.actorId);history.push({actorId:old.actorId,finishedAt:now,reason:old.deadline<=now?'fairness_deadline':!current?'actor_unavailable':'milestone_or_mode_changed',recipientProgressObserved:!!current&&(current.teamWork.equipment?.legendaryEquipped??0)>(old.legendary??0),nativeConfirmed:false});}
 for(const c of candidates)c.last=last(c.actorId);candidates.sort((a,b)=>Number(a.last>0)-Number(b.last>0)||a.priority-b.priority||a.last-b.last||(a.gap??99)-(b.gap??99)||a.actorId.localeCompare(b.actorId));
 for(const m of candidates)if(commitments.length<maxCarry&&!commitments.some(c=>c.actorId===m.actorId)){commitments.push({...m,mode,startedAt:now,deadline:now+maxCommitmentMs});}
 const carryNames=new Set(commitments.map(c=>c.name));for(const d of demands){d.beneficiaryActorId=cohort.find(m=>m.charName===d.receiver)?.identity.actorId||null;d.allocationPriority=d.priority-(carryNames.has(d.receiver)?5:0);}
 const surplusCopper=cohort.reduce((n,m)=>n+Math.max(0,(m.teamInventory?.copper?.spare??Math.max(0,(m.teamInventory?.coins||0)-(m.teamInventory?.reservedCoins||0)))),0);
 return {version:1,at:now,build,cohortRevision:revision,mode,commitments,history:history.slice(-60),investmentBudgetCopper:Math.floor(surplusCopper*.35),maxCarry,maxCommitmentMs,nextRecipients:candidates.filter(c=>!carryNames.has(c.name)).slice(0,2),exitCondition:mode==='PUSH_VERIFIED_CAPS'?'verified native caps or changed rules':'recipient milestone, timeout, readiness or cohort change',scope:'allocation proposals only; native trades and per-account reservations authorize spending',fairness:'bounded rotating commitments; personal supplies and progression bills stay protected'};
}
module.exports={allocate};
