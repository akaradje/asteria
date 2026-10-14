'use strict';
// Accepted state measures completion time, not a guaranteed drop rate. A changed
// goal/build or missing interval is not silently credited to the next target.
const path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
function goal(i){const c=i.endgameCampaign,d=i.developmentProgress;if(['class','wing','equip'].includes(c?.phase)&&typeof c.target==='string')return {id:c.target,kind:c.phase==='class'?'class':'equipment'};if(typeof d?.target?.id==='string')return {id:d.target.id,kind:'equipment'};return null;}
function phase(i){if(i.livePos?.dead||i.healthRecovery||i.survivalRecovery)return 'recovery';if(i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(i.teamTradeStatus.phase))return 'trade';if(i.pendingTravel)return 'travel';if(i.v2?.phase==='MAINTENANCE')return 'maintenance';if(i.livePos?.room==='town')return 'town';if(i.choresBusy||i.teamControl)return 'other_owner';return 'field';}
class GoalCycle{
 constructor(root,actorId){this.actorId=actorId;this.doc=require('../runtime/canonical-document').open(root,path.join(root,'logs/goal-cycles.json'),{version:1,actorId,active:null,rows:[]});this.data=this.doc.data;if(this.data.version!==1||this.data.actorId!==actorId)throw Error('Goal cycle namespace mismatch');}
 persist(force=false,at=Date.now()){if(!force&&this.persistedAt!=null&&at-this.persistedAt<30000)return;require('../runtime/canonical-document').save(this.doc,this.data);this.persistedAt=at;}
 observe(i,state,p){if(p?.authority!=='server_accepted_save'||p.actorId!==this.actorId||!Number.isSafeInteger(p.rev))return;const g=goal(i),r=this.data.active,at=p.at;
  const completed=t=>t.kind==='class'?state.job===t.id:Object.values(state.equip||{}).includes(t.id);
  if(r&&(r.build!==p.build||r.generation!==p.generation||r.goal.id!==g?.id&&!completed(r.goal))){r.status='interrupted';r.finishedAt=at;r.elapsedMs=Math.max(0,at-r.startedAt);r.censored=true;r.reason='goal/build/session_changed';this.data.rows.push(r);this.data.active=null;this.persist(true,at);}
  if(!g&&!this.data.active)return;const complete=g&&completed(g);
  if(!this.data.active&&!complete)this.data.active={id:crypto.randomUUID(),goal:g,build:p.build,generation:p.generation,preContext:require('./completion-measurements').context(state),startedAt:at,lastAt:at,lastRev:p.rev,previousPhase:phase(i),phases:{},knownMs:0,gaps:0,deaths:0,receipts:[],spent:{},status:'running'};
  const current=this.data.active;if(!current)return;
  const dt=at-current.lastAt,currentPhase=phase(i);if(p.rev<=current.lastRev||dt<0){if(current.startedAt===at)this.persist(true,at);return;}
  if(dt<=60000&&current.previousPhase===currentPhase){current.knownMs+=dt;current.phases[currentPhase]=(current.phases[currentPhase]||0)+dt;}else if(dt>60000)current.gaps++;
  if(i.livePos?.dead&&!current.dead)current.deaths++;current.dead=!!i.livePos?.dead;
  current.resourceFlows ||= [];
  for(const entry of [...(i.v2?.journal?.rows||[]),...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[])]){const flow=require('./resource-flow').costEvidence(entry,current,p);if(!flow||current.receipts.includes(entry.id))continue;current.receipts.push(entry.id);current.resourceFlows.push(flow);if(flow.known&&flow.scope==='goal')for(const[k,n]of Object.entries(flow.cost))current.spent[k]=(current.spent[k]||0)+n;}
  current.lastAt=at;current.lastRev=p.rev;current.previousPhase=currentPhase;
  const terminal=completed(current.goal);if(terminal){current.status='native_state_completed';current.finishedAt=at;current.elapsedMs=at-current.startedAt;current.receipt={actorId:p.actorId,rev:p.rev,at,authority:p.authority};current.benefitMeasured=false;current.externalHelperCostKnown=false;this.data.rows.push(current);this.data.active=null;}
  this.data.rows=this.data.rows.slice(-128);this.persist(terminal,at);i.wholeCycle=this.view();
 }
 view(){return {version:1,actorId:this.actorId,active:this.data.active?{goal:this.data.active.goal,startedAt:this.data.active.startedAt,knownMs:this.data.active.knownMs,phases:this.data.active.phases}:null,recent:this.data.rows.slice(-6).map(r=>({goal:r.goal,build:r.build,status:r.status,elapsedMs:r.elapsedMs,knownMs:r.knownMs,unknownMs:Number.isFinite(r.elapsedMs)?Math.max(0,r.elapsedMs-r.knownMs):null,censored:r.censored===true,phases:r.phases,deaths:r.deaths,spent:r.spent,spendScope:r.resourceFlows?'linked_confirmed_journal_cost_not_exact_wallet_delta':'legacy_unscoped_cost',resourceFlows:r.resourceFlows?.slice(-32)||[],gaps:r.gaps,nativeConfirmed:!!r.receipt,benefitMeasured:false,externalHelperCostKnown:false})),causalVerified:false};}
 estimates(state,build){const signature=require('./completion-measurements').context(state),groups={};for(const r of this.data.rows)if(r.build===build&&r.preContext===signature&&r.status==='native_state_completed'&&r.gaps===0&&r.knownMs>=r.elapsedMs*.9){const a=groups[r.goal.id]||=[];a.push(r.elapsedMs);}return Object.fromEntries(Object.entries(groups).filter(([,a])=>a.length>=3).map(([id,a])=>[id,{build,confirmed:true,samples:a.length,meanMs:a.reduce((n,v)=>n+v,0)/a.length,authority:'native_state_completion_with_whole_cycle_time',helperCostKnown:false}]));}
}
module.exports={GoalCycle,goal,phase,hash};
