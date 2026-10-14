'use strict';
const {plan}=require('../planning/astral-objective');
const crypto=require('node:crypto');
async function poll(i,now=Date.now()){
 if(!i.actorIdentity||i.status!=='playing'||i.recycling||!i.socialInbox?.generation||i.v2?.sourceCoherence?.matches!==true||i.astralQueryFlight||now-(i.astralQueryAt||0)<25000)return false;
 i.astralQueryAt=now;i.astralQueryFlight=true;
 try{const result=await i.socialSend('asq',{});i.astralQueryStatus={at:now,requested:result?.ok===true,reason:result?.ok===true?'native_read_requested':'native_read_not_acknowledged'};return result?.ok===true;}
 catch{i.astralQueryStatus={at:now,requested:false,reason:'native_read_unavailable'};return false;}
 finally{i.astralQueryFlight=false;}
}
function journalBlocks(i,action){const j=i.v2?.journal;if(!j?.pending?.())return false;if(!['aspt','native-ui-mode'].includes(action)||!Number.isFinite(i.bagSessionStartedAt)||!Array.isArray(j.rows))return true;const oldItemDomains=new Set(['purchase','craft','refine','bag-upgrade','storage-upgrade','equip','enchant','stage','card','card-grade','socket']);return j.rows.filter(r=>['WAITING_CONFIRMATION','UNCERTAIN','STARTED','OBSERVED'].includes(r.status)).some(r=>!oldItemDomains.has(r.kind)||!Number.isFinite(r.at)||r.at>=i.bagSessionStartedAt);}
function observe(i,now=Date.now()){
 const owner=i.actorOwner,store=i.registryV32?.store,a=i.socialInbox?.astral.view(now),pending=store&&i.actorIdentity?store.pending(i.actorIdentity.actorId).filter(r=>r.kind.startsWith('astral:')):[];
 for(const r of pending){
  const rebased=require('./astral-receipt').closedPointState(r,i,a,now);if(rebased){store.transition(r.id,'RECONCILED',{previousStatus:r.status,reconciliation:rebased,reason:'Closed zero-cost allocation; plan only a new remaining-point delta from current native state'});continue;}
  if(!r.sentAt||!a?.fresh||a.receivedAt<r.sentAt||r.generation!==a.generation||r.session!==owner?.session)continue;
  const proof=require('./astral-receipt').confirmedEvent(r,a,i.catalog().world.ASTRAL);
  if(proof){store.receipt(r.id,{receiptId:'astral:'+r.id+':'+proof.eventAt,actorId:r.actorId,session:r.session,generation:r.generation,kind:r.kind,authority:'server_socket',at:proof.eventAt,applied:true,proof});require('./capability-evidence').astralConfirmed(i,r.id);}
  else if((i.socialInbox.last?.('asno')?._receivedAt||a.rejection?.at)>=r.sentAt&&r.status==='SENT')store.transition(r.id,'UNCERTAIN',{reason:'Native rejection '+(i.socialInbox.last?.('asno')?.why||a.rejection?.reason||'unknown')+'; reconcile the sole attempt before any retry'});
 }
 i.astralObjective=plan(i,now);return i.astralObjective;
}
function budget(i,goal){
 const rules=i.catalog().world.ASTRAL,receipt=require('./astral-receipt'),bill=receipt.reserveBill(goal.action,goal,i.lastSave,rules),available=receipt.resources(i.lastSave),held=require('./paid-actions').heldResources(i);
 // Native asbt chooses the consumed core; do not spend a stack reserved for a ready wing or missing Legendary.
 const wing=require('../planning/campaign-equipment').reserve(i)||{},gear=require('../equipment-goal').policy(i.catalog()).dynamicProgression&&i.developmentProgress?.craftPortfolio?.selected?.ready!==true?{}:require('../planning/combat-priority').legendaryBill({craft:i.developmentProgress?.craftPortfolio?.selected},i.catalog().build)||{};
 for(const [k,n]of Object.entries(held))available[k]=Math.max(0,(available[k]||0)-n);
 for(const k of new Set([...Object.keys(wing),...Object.keys(gear)]))available[k]=Math.max(0,(available[k]||0)-Math.max(wing[k]||0,gear[k]||0));
 available.Copper=Math.max(0,(available.Copper||0)-require('../upgrade-reserve').reserve(i.lastSave,i.catalog().world));
 return {bill,available,ok:Object.entries(bill).every(([k,n])=>Number.isSafeInteger(n)&&n>=0&&Number.isFinite(available[k])&&available[k]>=n)};
}
async function tick(i){
 const goal=observe(i);
 if(goal.state==='waiting_evidence')await poll(i);
 const block=reason=>{i.astralObjective={...i.astralObjective,executionBlock:reason};return null;};
 if(!goal.action)return null;
 const disabled=require('../planning/astral-path').enabled(i,goal.action);if(disabled)return block(disabled);
 if(!['READY','VERIFIED'].includes(require('./capability-evidence').projection(i).astral.contracts[goal.action]?.state))return block('astral_source_review_required');
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.assistanceReservation?.expiresAt>Date.now()||i.pendingTravel||i.recycling||i.choresBusy||i.survivalRecovery||require('./team-trade').blocksNavigation(i))return block('astral_current_work_owner');
 if(journalBlocks(i,goal.action))return block('astral_payment_reconciliation_required');
 const store=i.registryV32.store;if(!store.validateOwner(i.actorOwner)||store.pending(i.actorIdentity.actorId).length)return block('astral_owner_or_pending_intent');
 if(!require('./freshness').decisionGate(i).allowed)return block('astral_fresh_native_state_required');
 if(goal.action==='asbt'&&require('../equipment-goal').policy(i.catalog()).dynamicProgression&&['craft','refine'].includes(require('../planning/combat-roi').townChoice(i)))return block('higher_ready_combat_ROI');
 if(!budget(i,goal).ok)return block('astral_resources_reserved_or_missing');
 if(goal.action==='asbt'&&i.livePos?.room!=='town'){
  if(require('./room-policy').roomPolicy(i.livePos?.room).dungeon||i.endgameCampaign?.ready&&i.endgameCampaign.phase!=='complete')return block('astral_protected_activity');
  if(!i.canDo('astralReturnTown',60000))return null;
  await i.expeditionAuto(false);await i.returnToTown();return 'กลับเมืองเพื่อทะลุขีดดาว · ยังไม่ส่งธุรกรรม';
 }
 return i.v2.scheduler.run('astral-'+goal.action,async()=>{
  i.v2.scheduler.checkpoint();let current=plan(i);if(current.action!==goal.action||current.revision!==goal.revision)return null;
  // Flush before reserving an intent so a failed preparation cannot strand STARTED forever.
  if(current.action==='asbt'){
   await i.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.isConnected()||n.pause||n.fixed||n.kicked)throw Error('Native connection unavailable');n.handlers.resave();await n.flush();return true;})()`);i.v2.scheduler.checkpoint();
   current=plan(i);if(current.action!=='asbt'||current.revision!==goal.revision||i.livePos?.room!=='town'||!require('./freshness').decisionGate(i).allowed)return null;
  }
  const b=budget(i,current);if(!b.ok)return block('astral_resources_reserved_or_missing');
  const view=i.socialInbox.astral.view(),r=store.begin({id:crypto.randomUUID(),actorId:i.actorIdentity.actorId,session:i.actorOwner.session,generation:view.generation,kind:'astral:'+current.action,bill:b.bill,available:b.available,target:current.action==='aspt'?{points:current.draft,beforePoints:current.points,increments:current.increments}:{beforeBt:view.state.bt,gateBill:current.bill},contractRevision:current.revision});
  store.sent(r.id);
  try{const result=await i.socialSend(current.action,current.action==='aspt'?{l:current.increments}:{});if(!result?.ok)store.transition(r.id,'UNCERTAIN',{reason:'Native dispatch outcome unknown; no replay'});}
  catch{store.transition(r.id,'UNCERTAIN',{reason:'Native dispatch exception; reconcile without replay'});}
  return 'ส่งการพัฒนาดาวหนึ่งครั้ง · รอแต้ม/ทรัพยากรจากเซิร์ฟเวอร์ยืนยัน';
 },{contract:require('./action-contract').contract(i,'astral-'+goal.action)});
}

async function reset(i,{requestId,authorizedActorId}={}){
 const p=i.registryV32?.policy,v=i.socialInbox?.astral.view(),rules=i.catalog().world.ASTRAL;
 if(!/^[a-zA-Z0-9_-]{10,80}$/.test(requestId||'')||authorizedActorId!==i.actorIdentity?.actorId||p?.astralReset!==true||p.astralBuild!==i.catalog().build||p.astralRevision!==require('../knowledge/capability-registry').registry(i.catalog()).astral.revision||!p.astralCanaryActors?.includes(authorizedActorId)||!v?.fresh||v.completeness!=='full'||i.livePos?.room!=='town'||!Object.values(v.state.p||{}).some(n=>n>0)||i.registryV32.store.pending(authorizedActorId).length)throw Error('Explicit current-actor reset authorization and fresh native state required');
 return i.v2.scheduler.run('astral-reset',async()=>{i.v2.scheduler.checkpoint();const bill={Copper:rules.resetCopper},available=require('./astral-receipt').resources(i.lastSave);available.Copper-=require('../upgrade-reserve').reserve(i.lastSave,i.catalog().world);const r=i.registryV32.store.begin({id:'astral-reset:'+requestId,actorId:authorizedActorId,session:i.actorOwner.session,generation:v.generation,kind:'astral:asrst',bill,available,contractRevision:p.astralRevision});await i.eval(`(async()=>{const n=window.AsteriaNet;n.handlers.resave();await n.flush();return true;})()`);i.v2.scheduler.checkpoint();i.registryV32.store.sent(r.id);return i.socialSend('asrst',{});},{contract:require('./action-contract').contract(i,'astral-reset')});
}
module.exports={observe,tick,reset,journalBlocks,poll,budget};
