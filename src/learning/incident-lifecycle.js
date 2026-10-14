'use strict';
const crypto=require('node:crypto'),{metrics,compare}=require('./advice-outcome');
const key=m=>crypto.createHash('sha256').update(JSON.stringify([m.actorId,m.build,m.recovery?.incidentKey])).digest('hex');
const fresh=m=>m?.actorId&&m.build&&m.status==='playing'&&Number.isFinite(m.saveAgeSeconds)&&m.saveAgeSeconds>=0&&m.saveAgeSeconds<=30;
const playbooks=require('./incident-playbooks');
function reconcile(data,state,now){
 const rows=data.incidents||[];
 for(const m of state.members.filter(fresh)){
  // Check the original target before consulting the diagnostic flag. A stale
  // flag cannot hide a completed target, and an unrelated upgrade cannot close it.
  for(const r of rows.filter(r=>r.actorId===m.actorId&&r.build===m.build&&!r.resolved)){
   r.playbook ||=playbooks.select(m);
   const outcome=compare(r.baseline,m),meaningful=playbooks.terminal(r.playbook,outcome.effects,m,r.baseline);
   if(meaningful.length){r.status='PROGRESS_OBSERVED';r.resolved=true;r.closedAt=now;r.closure={effects:meaningful,evidence:'fresh_native_snapshot_original_target',causalVerified:false};}
  }
  const completed=rows.find(r=>r.id===key(m)&&r.resolved);
  if(completed&&playbooks.terminal(completed.playbook,compare(completed.baseline,m).effects,m,completed.baseline).length)continue;
  if(m.recovery?.needsDiagnosis&&m.recovery.incidentKey){const k=key(m);let r=rows.find(r=>r.id===k);if(!r){r=rows.find(r=>r.actorId===m.actorId&&r.build===m.build&&!r.resolved);if(r){r.previousKeys=[...(r.previousKeys||[]),r.incidentKey].slice(-16);r.id=k;r.incidentKey=m.recovery.incidentKey;}}if(!r){r={id:k,actorId:m.actorId,build:m.build,incidentKey:m.recovery.incidentKey,firstAt:now,lastAt:now,status:'OPEN',baseline:metrics(m),attempts:[],resolved:false};rows.push(r);}else if(r.resolved){r.status='RECURRED';r.resolved=false;r.recurrences=(r.recurrences||0)+1;r.baseline=metrics(m);}r.lastAt=now;r.reason=m.recovery.reason;r.playbook ||=playbooks.select(m);const budget=playbooks.gate(r.playbook,r.attempts,now);if(budget.reason==='attempt_budget_exhausted'){r.status='ESCALATED';r.nextCheck=budget.nextCheck;r.fallback=budget.fallback;}continue;}
  for(const r of rows.filter(r=>r.actorId===m.actorId&&r.build===m.build&&!r.resolved)){
   const outcome=compare(r.baseline,m);
   r.playbook ||=playbooks.select(m);
   const meaningful=playbooks.terminal(r.playbook,outcome.effects,m,r.baseline);
   // Missing diagnosis alone or a fresh heartbeat is never a recovery receipt.
   if(meaningful.length){r.status='PROGRESS_OBSERVED';r.resolved=true;r.closedAt=now;r.closure={effects:meaningful,evidence:'fresh_native_snapshot_progress',causalVerified:false};}
   else{const gate=playbooks.gate(r.playbook,r.attempts,now);r.status=gate.reason==='attempt_budget_exhausted'?'ESCALATED':'AWAITING_RESULT';r.nextCheck=gate.nextCheck||now+60000;r.fallback=gate.fallback||r.playbook.fallback;}
  }
 }
 // Retain every unresolved incident, bounded upstream by the registered roster;
 // coalesce changed fingerprints under the same actor/build rather than deleting.
 const open=rows.filter(r=>!r.resolved),closed=rows.filter(r=>r.resolved).sort((a,b)=>b.closedAt-a.closedAt).slice(0,128);
 data.incidents=[...open,...closed];for(const r of open){const m=state.members.find(m=>m.actorId===r.actorId&&m.build===r.build);r.playbook ||=playbooks.select(m||{});r.nextCheck ||=now+r.playbook.verifyMs;}return data.incidents;
}
function dispatched(data,{actorId,build,action,commandId,result,at}){
 const row=(data.incidents||[]).filter(r=>r.actorId===actorId&&r.build===build&&!r.resolved).sort((a,b)=>b.lastAt-a.lastAt)[0];if(!row)return;
 row.attempts=[...(row.attempts||[]),{action,commandId,at,result:result.ok===false?'REJECTED':'ACCEPTED_NOT_CONFIRMED'}].slice(-32);row.status=result.ok===false?'OPEN':'VERIFYING';row.nextCheck=at+60000;
}
module.exports={reconcile,dispatched};
