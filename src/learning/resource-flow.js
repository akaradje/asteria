'use strict';
const crypto=require('node:crypto');
const amount=x=>Number.isSafeInteger(x)&&x>=0;
// Paired transfer accounting consumes verified receipts; it never authorizes or
// repeats a transfer. Team totals must not count an internal transfer as income.
function pair(a,b){
 const valid=r=>r&&typeof r.transferId==='string'&&typeof r.actorId==='string'&&r.build&&r.authority==='server_accepted_exact_save_revision'&&Number.isSafeInteger(r.rev)&&r.rev>=0&&Number.isSafeInteger(r.at)&&Array.isArray(r.flows)&&r.flows.length>0&&r.flows.every(f=>typeof f.resource==='string'&&['in','out'].includes(f.direction)&&amount(f.amount)&&f.amount>0);
 if(!valid(a)||!valid(b)||a.transferId!==b.transferId||a.actorId===b.actorId||a.build!==b.build)return {state:'UNCONFIRMED',usable:false};
 const totals=new Map();for(const r of [a,b])for(const f of r.flows){const k=f.resource,v=totals.get(k)||{in:0,out:0};v[f.direction]+=f.amount;if(!amount(v[f.direction]))return {state:'UNCONFIRMED',usable:false};totals.set(k,v);}
 if([...totals.values()].some(v=>v.in!==v.out))return {state:'CONFLICT',usable:false};
 return {state:'PAIRED',usable:true,transferId:a.transferId,actors:[a.actorId,b.actorId].sort(),netTeamIncome:0,flows:[...totals].map(([resource,v])=>({resource,transferred:v.in})),proofHash:crypto.createHash('sha256').update(JSON.stringify([a,b].sort((x,y)=>x.actorId.localeCompare(y.actorId)))).digest('hex')};
}
function costEvidence(entry,cycle,proof){
 const c=entry?.context,r=entry?.serverReceipt;
 if(!c||c.actorId!==proof.actorId||c.build!==proof.build||entry.evidence!=='server_accepted_exact_save_revision'||!['CONFIRMED','server_confirmed','server_no_increase'].includes(entry.status)||!r||!Number.isFinite(r.at)||r.at<cycle.startedAt||r.at>proof.at)return null;
 const linked=c.goalId===cycle.goal.id||entry.goalId===cycle.goal.id||entry.target?.id===cycle.goal.id||Object.values(entry.target?.equip||{}).includes(cycle.goal.id);
 const cost=entry.cost;if(!cost||typeof cost!=='object'||Object.values(cost).some(n=>!amount(n)))return {id:entry.id,scope:linked?'goal':'concurrent',known:false};
 return {id:entry.id,scope:linked?'goal':'concurrent',known:true,cost:{...cost},authority:'confirmed_journal_cost',actualDeltaVerified:false};
}
module.exports={pair,costEvidence};
