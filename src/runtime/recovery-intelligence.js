'use strict';
// Durable diagnostic memory belongs to the character controller, never the LLM.
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const actions=new Set(['inventory','supplies','campaign','travel','farm','replan','reobserve','resolve-soft-cycle']);
const history=data=>Array.isArray(data.recoveryMemory)?data.recoveryMemory:[];
function signature(i,t){
 const s=i.lastSave||{},c=i.endgameCampaign||{};
 const ids=rows=>(Array.isArray(rows)?rows:[]).map(x=>typeof x==='string'?x:x?.id).filter(Boolean).sort();
 return hash([t.key,t.build,t.owner,t.ready,t.unknown,t.free,Math.min(10,t.hpPots),i.livePos?.room,
  s.storeTier,ids(s.bag),ids(s.storage?.gear),s.equip,s.refine,s.locks,
  (c.requirements||[]).map(r=>[r.name,Math.min(r.have||0,r.want||0),r.want]),
  c.action?.result?.reason||i.campaignRetry?.reason||null]);
}
function record(data,pending,result,now){
 if(!pending?.fingerprint||!actions.has(pending.action))return;
 const rows=history(data);
 rows.push({at:now,task:pending.task,build:pending.build,fingerprint:pending.fingerprint,action:pending.action,result,
  evidence:result==='observed'?'native_state_observed_not_causal_proof':'no_verified_recovery_result'});
 data.recoveryMemory=rows.slice(-96);
}
function failed(data,fingerprint,action){
 let failures=0;
 for(const r of history(data).slice().reverse()){
  if(r.fingerprint!==fingerprint||r.action!==action)continue;
  if(r.result==='observed')break;
  if(['unconfirmed','interrupted'].includes(r.result))failures++;
 }
 return failures>=2;
}
function view(data,t,state,fingerprint,now,instance=null){
 const rows=history(data).filter(r=>r.build===t.build&&r.task===t.key).slice(-8);
 const suppressed=[...actions].filter(a=>failed(data,fingerprint,a));
 const stalled=['attention','reconcile','waiting-evidence','watching'].includes(state.state)||suppressed.length>0;
 const ownedStall=state.state==='owned'&&state.quietMs>=300000;
 const needed=(stalled||ownedStall)&&state.quietMs>=90000&&!(t.waitUntil>now)&&state.state!=='paused';
 return {version:1,incidentKey:hash([t.key,fingerprint,state.state,suppressed]),fingerprint,
  needsDiagnosis:needed,mode:needed?'diagnosis_required':'local_recovery',
  suppressedActions:suppressed,reason:state.reason,owner:state.owner,
  blockedNodes:t.nodes.filter(n=>['blocked','reconcile','unknown'].includes(n.state)).map(n=>n.id),
  attempts:rows.map(r=>({action:r.action,result:r.result,at:r.at,evidence:r.evidence})),
  activity:t.owner==='team'&&instance?.fleetActivityIntent?{id:instance.fleetActivityIntent.id,phase:instance.fleetActivityIntent.phase,kind:instance.fleetActivityIntent.kind,joinDeadline:instance.fleetActivityIntent.joinDeadline||null,deadline:instance.fleetActivityIntent.deadline||null,dispatch:require('../planning/fleet-activity').publicDispatch(instance)}:null,
  outcome:'not_verified',at:now};
}
function project(v){
 if(!v)return null;
 const text=x=>typeof x==='string'?x.slice(0,240):null;
 return {version:1,incidentKey:text(v.incidentKey),fingerprint:text(v.fingerprint),needsDiagnosis:v.needsDiagnosis===true,
  mode:text(v.mode),reason:text(v.reason),owner:text(v.owner),at:v.at,
  suppressedActions:(v.suppressedActions||[]).filter(a=>actions.has(a)).slice(0,8),
  blockedNodes:(v.blockedNodes||[]).filter(n=>['evidence','health','supplies','space','resources','execute','native-result'].includes(n)),
  attempts:(v.attempts||[]).slice(-8).map(r=>({action:actions.has(r.action)?r.action:null,result:text(r.result),at:r.at,evidence:text(r.evidence)})),activity:v.activity?{id:text(v.activity.id),phase:text(v.activity.phase),kind:text(v.activity.kind),joinDeadline:Number.isFinite(v.activity.joinDeadline)?v.activity.joinDeadline:null,deadline:Number.isFinite(v.activity.deadline)?v.activity.deadline:null,dispatch:require('../planning/fleet-activity').publicDispatch({activityDispatchResult:v.activity.dispatch})}:null,outcome:'not_verified'};
}
module.exports={signature,record,failed,view,project};
