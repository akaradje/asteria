'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const clone=o=>JSON.parse(JSON.stringify(o));
function snapshot(s={}){return clone(Object.fromEntries(['coins','tokens','runeDust','leaves','materials','keyItems','consumables','bag','equip','refine','weaponOpts','stage','holes','sockets','cards','drill'].map(k=>[k,s[k]??(['coins','tokens','runeDust','leaves'].includes(k)?0:{})])));}
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const typed=require('./runtime/typed-upgrade-cost');
class ResultLedger{
 constructor(root,slot,now=Date.now()){this.file=path.join(root,'logs',`development-${slot}.json`);try{this.rows=(require('./runtime/canonical-document').existing(root,this.file)||JSON.parse(fs.readFileSync(this.file))).rows;if(!Array.isArray(this.rows))throw Error('invalid ledger rows');}catch(e){if(e.code!=='ENOENT')throw Error('development ledger unreadable; preserve original and stop paid work');this.rows=[];}this.document=require('./runtime/canonical-document').open(root,this.file,{rows:this.rows});if(this.document)this.rows=this.document.data.rows;let dirty=false;for(const r of this.rows)if(r.status==='pending'&&now-r.at>600000){r.status='unresolved';r.evidence='historical_outcome_unknown_preserved_no_replay';dirty=true;}if(dirty)this.save();}
 save(){const data={rows:this.rows};if(!this.document)this.document=require('./runtime/canonical-document').open(path.dirname(path.dirname(this.file)),this.file,data);require('./runtime/canonical-document').save(this.document,data);fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(data));fs.renameSync(this.file+'.tmp',this.file);}
 pending(kind){return this.rows.find(r=>['pending','unresolved','change_observed','spent_without_change'].includes(r.status)&&(!kind||r.kind===kind));}
 blocking(kind,scope){return this.rows.find(r=>r.status==='pending'||['unresolved','change_observed','spent_without_change','reconciled_craft_unknown'].includes(r.status)&&r.kind===kind&&!(kind==='craft'&&require('./runtime/craft-scope').independent(r,scope)));}
 begin(kind,target,state,at=Date.now(),defer=false,trackDispatch=false){
  const scope=kind==='craft'?{targetId:target?.id,actorId:this.context?.actorId,build:this.context?.build,catalog:this.costCatalog}:null;
  if(this.blocking(kind,scope))return null;
  const r={id:crypto.randomUUID(),kind,target,at,status:'pending',evidence:'awaiting_client_save',before:snapshot(state),context:this.context?{...this.context}:null,expectedCost:this.expectedCost?{...this.expectedCost}:null,costTypes:typed.resolve(this.expectedCost,state,this.costCatalog)};
  if(['refine','craft'].includes(kind)&&trackDispatch)r.dispatchTracking={version:1,state:'preparing'};
  const held=x=>['pending','unresolved','change_observed','spent_without_change','reconciled_craft_unknown'].includes(x.status);
  this.deferred=defer?r.id:null;this.rows=[r,...this.rows.filter(held),...this.rows.filter(x=>!held(x)).slice(0,119)];this.save();return r;
 }
 seal(id){this.deferred=null;const r=this.rows.find(r=>r.id===id);if(r?.status==='pending'&&r.observedStatus){r.status=r.observedStatus;delete r.observedStatus;this.save();}}
 markRefineDispatch(id,step,at=Date.now()){
  const r=this.rows.find(r=>r.id===id);
  if(r?.kind!=='refine'||r.status!=='pending'||r.dispatchTracking?.version!==1||r.dispatchTracking.state!=='preparing'||r.target?.id!==step?.id||!Number.isInteger(step.from)||step.to!==step.from+1||!Number.isFinite(at)||at<r.at)return false;
  r.dispatchTracking={version:1,state:'possible',at,targetId:step.id,from:step.from,to:step.to};this.save();return true;
 }
 cancelBeforeRefineDispatch(id,reason){
  const r=this.rows.find(r=>r.id===id);
  if(r?.kind!=='refine'||r.status!=='pending'||r.dispatchTracking?.version!==1||r.dispatchTracking.state!=='preparing')return false;
  r.status='not_sent';r.evidence='failed_before_native_payment_dispatch';r.reason=reason;delete r.observedStatus;this.save();return true;
 }
 markCraftDispatch(id,targetId,at=Date.now()){
  const r=this.rows.find(r=>r.id===id);
  if(r?.kind!=='craft'||r.status!=='pending'||r.dispatchTracking?.version!==1||r.dispatchTracking.state!=='preparing'||!targetId||r.target?.id!==targetId||!Number.isFinite(at)||at<r.at)return false;
  r.dispatchTracking={version:1,state:'possible',at,targetId};this.save();return true;
 }
 cancelBeforeCraftDispatch(id,reason){
  const r=this.rows.find(r=>r.id===id);
  if(r?.kind!=='craft'||r.status!=='pending'||r.dispatchTracking?.version!==1||r.dispatchTracking.state!=='preparing')return false;
  r.status='not_sent';r.evidence='failed_before_native_payment_dispatch';r.reason=reason;delete r.observedStatus;this.save();return true;
 }
 cancel(id,reason){const r=this.rows.find(r=>r.id===id&&r.status==='pending');if(r){r.status='not_sent';r.reason=reason;this.save();}}
 acknowledgeAcceptedSave(state,proof){
  if(proof?.authority!=='server_accepted_save'||!Number.isInteger(proof.rev)||proof.rev<0||!Number.isFinite(proof.requestAt))return false;
  let dirty=false;for(const r of this.rows){const c=r.context;if(!c||!['pending','change_observed','spent_without_change','unresolved'].includes(r.status)||!r.after||!r.cost||proof.requestAt<=r.at||proof.at<proof.requestAt||c.actorId!==proof.actorId||c.sessionStartedAt!==proof.sessionStartedAt||c.generation!==proof.generation||c.build!==proof.build||!Number.isInteger(c.baselineRev)||proof.rev<=c.baselineRev)continue;
   const after=snapshot(state),field={craft:'bag',equip:'equip',refine:'refine',enchant:'weaponOpts',stage:'stage',drill:'holes'}[r.kind];
   if(!field)continue;
   if(r.kind==='craft'){if(!r.target?.id||typed.gear(after,r.target.id)!==typed.gear(r.after,r.target.id)||typed.gear(after,r.target.id)<=typed.gear(r.before,r.target.id))continue;}
   else if(!equal(after[field],r.after[field]))continue;
   const types=r.costTypes||typed.resolve(r.expectedCost,r.before,null);
   if(r.kind!=='equip'&&(!typed.matches(r.before,r.after,r.expectedCost,types)||!typed.matches(r.before,after,r.expectedCost,types)))continue;
   r.status=(r.observedStatus||r.status)==='spent_without_change'?'server_no_increase':'server_confirmed';r.evidence='server_accepted_exact_save_revision';r.serverReceipt={at:proof.at,rev:proof.rev,requestAt:proof.requestAt,actorId:c.actorId,sessionStartedAt:c.sessionStartedAt,generation:c.generation,build:c.build};r.finishedAt=proof.at;delete r.observedStatus;dirty=true;
  }if(dirty)this.save();return dirty;
 }
 reconcileCraftState(state,proof,catalog){
  // A closed page cannot spend again. Rebase its resource hold against the
  // native current inventory, without claiming an exact historical payment.
  if(!['server_readback','server_accepted_save'].includes(proof?.authority)||!Number.isSafeInteger(proof.rev)||proof.rev<0||!Number.isInteger(proof.generation)||!proof.actorId||!proof.build||proof.build!==catalog?.build||!Number.isFinite(proof.sessionStartedAt)||!Number.isFinite(proof.at)||!Number.isFinite(proof.requestAt)||proof.requestAt<proof.sessionStartedAt||proof.at<proof.requestAt)return false;
  let dirty=false;
  for(const r of this.rows){const c=r.context;
   if(r.kind!=='craft'||r.legacyIdentityUnknown||!['change_observed','unresolved'].includes(r.status)||!c||c.actorId!==proof.actorId||c.build!==proof.build||!Number.isSafeInteger(c.baselineRev)||proof.rev<=c.baselineRev||!Number.isFinite(r.at)||!Number.isFinite(c.sessionStartedAt)||c.sessionStartedAt>=r.at||proof.sessionStartedAt-r.at<60000||!r.after||!r.target?.id)continue;
   const types=r.costTypes||typed.resolve(r.expectedCost,r.before,catalog),before=typed.gear(r.before,r.target.id),after=typed.gear(r.after,r.target.id),current=typed.gear(state,r.target.id);
   if(before===null||after!==before+1||current===null||current<after||!typed.matches(r.before,r.after,r.expectedCost,types))continue;
   if(Object.values(types).some(t=>typed.amount(state,t)===null))continue;
   // A persisted same-actor observed result and current ownership resolve the
   // goal, not causality. Retain the original unknown cost and no-replay fence.
   r.previousOutcome={status:r.status,evidence:r.evidence,finishedAt:r.finishedAt};
   r.status='reconciled_craft_state';r.evidence='native_current_inventory_after_closed_session';r.finishedAt=proof.at;
   r.reconciliation={...proof,targetId:r.target.id,currentOwned:current,observedOwned:after,costKnown:false,historicalSuccessKnown:false,replayBlocked:true,budgetRebased:true};dirty=true;
  }if(dirty)this.save();return dirty;
 }
 rebaseUncertainCraft(state,proof,catalog,now=Date.now()){
  // Current authoritative wallets after closing the old executor define new
  // budgets. They cannot reconstruct a missing historical craft receipt.
  if(proof?.authority!=='server_readback'||proof.build!==catalog?.build||!proof.actorId||!Number.isSafeInteger(proof.rev)||!Number.isInteger(proof.generation)||!Number.isFinite(proof.sessionStartedAt)||!Number.isFinite(proof.requestAt)||!Number.isFinite(proof.at)||proof.requestAt<proof.sessionStartedAt||proof.at<proof.requestAt||proof.at-proof.requestAt>30000||now-proof.at<0||now-proof.at>30000)return false;
  let dirty=false;for(const r of this.rows){const c=r.context;
   if(r.status==='reconciled_craft_unknown'&&r.reconciliation?.build!==proof.build&&r.currentBudgetRevalidation?.build!==proof.build&&require('./runtime/native-reservation-result').result(r,proof.actorId)==='RECONCILED'&&catalog.items?.[r.target?.id]&&proof.rev>c.baselineRev&&proof.sessionStartedAt-r.at>=60000){
    const types=r.costTypes||typed.resolve(r.expectedCost,r.before,catalog),owned=typed.gear(state,r.target.id);
    if(types&&owned!==null&&Number.isSafeInteger(state.coins)&&state.coins>=0&&Object.values(types).every(t=>typed.amount(state,t)!==null)){
     r.currentBudgetRevalidation={...proof,targetId:r.target.id,currentOwned:owned,costKnown:false,historicalSuccessKnown:false,replayBlocked:true,budgetRebased:true};dirty=true;
    }
   }
   if(r.kind!=='craft'||r.legacyIdentityUnknown||!['unresolved','change_observed','spent_without_change'].includes(r.status)||!c||c.actorId!==proof.actorId||!Number.isSafeInteger(c.baselineRev)||proof.rev<=c.baselineRev||!Number.isFinite(r.at)||!Number.isFinite(c.sessionStartedAt)||c.sessionStartedAt>=r.at||proof.sessionStartedAt-r.at<60000||!catalog.items?.[r.target?.id])continue;
   const types=r.costTypes||typed.resolve(r.expectedCost,r.before,catalog),owned=typed.gear(state,r.target.id);
   if(!types||owned===null||!Number.isSafeInteger(state.coins)||state.coins<0||Object.values(types).some(t=>typed.amount(state,t)===null))continue;
   r.previousOutcome={status:r.status,evidence:r.evidence,finishedAt:r.finishedAt};r.status='reconciled_craft_unknown';r.evidence='native_current_budget_after_closed_craft_session';
   r.reconciliation={...proof,targetId:r.target.id,currentOwned:owned,costKnown:false,historicalSuccessKnown:false,replayBlocked:true,budgetRebased:true};dirty=true;
  }if(dirty)this.save();return dirty;
 }
 reconcileRefineState(state,proof,catalog){
  // Current server state after the old page closed can rebase a budget without
  // claiming the historical roll or its cost succeeded. Never replay that roll.
  if(proof?.authority!=='server_readback'||proof.build!==catalog?.build||!proof.actorId||!Number.isSafeInteger(proof.rev)||proof.rev<0||!Number.isInteger(proof.generation)||!Number.isFinite(proof.sessionStartedAt)||!Number.isFinite(proof.requestAt)||!Number.isFinite(proof.at)||proof.requestAt<proof.sessionStartedAt||proof.at<proof.requestAt||proof.at-proof.requestAt>30000)return false;
  if(!state?.refine||Array.isArray(state.refine)||!Number.isSafeInteger(state.coins)||state.coins<0)return false;
  let dirty=false;
  for(const r of this.rows){
   const c=r.context,id=r.target?.id,item=catalog.items?.[id];
   if(r.kind!=='refine'||r.legacyIdentityUnknown||!['unresolved','change_observed','spent_without_change'].includes(r.status)||!c||c.actorId!==proof.actorId||!Number.isSafeInteger(c.baselineRev)||proof.rev<=c.baselineRev||!Number.isFinite(c.sessionStartedAt)||!Number.isFinite(r.at)||c.sessionStartedAt>=r.at||proof.sessionStartedAt-r.at<60000||!item||!(typed.gear(state,id)>=1))continue;
   const before=r.before?.refine?.[id]??(Object.values(r.before?.equip||{}).includes(id)?0:null),current=state.refine[id]??(Object.values(state.equip||{}).includes(id)?0:null),types=r.costTypes||typed.resolve(r.expectedCost,r.before,catalog);
   if(!Number.isInteger(before)||before<0||!Number.isInteger(current)||current<before||current>catalog.world?.REFINE?.max||!types||!r.expectedCost||Object.keys(types).length!==Object.keys(r.expectedCost).length||Object.values(types).some(t=>typed.amount(state,t)===null))continue;
   r.previousOutcome={status:r.status,evidence:r.evidence,finishedAt:r.finishedAt};r.status='reconciled_refine_state';r.evidence='native_current_refine_after_closed_session';r.finishedAt=proof.at;
   r.reconciliation={...proof,targetId:id,beforeRefine:before,currentRefine:current,costKnown:false,historicalSuccessKnown:false,replayBlocked:true,budgetRebased:true};dirty=true;
  }
  if(dirty)this.save();return dirty;
 }
 reconcileRefineLoad(state,{at,sessionStartedAt,rev}={}){
  if(!state?.refine||typeof state.refine!=='object'||Array.isArray(state.refine)||!Number.isFinite(at)||!Number.isFinite(sessionStartedAt)||at<=sessionStartedAt||at-sessionStartedAt>120000)return false;
  let dirty=false;
  for(const r of this.rows){
   if(r.kind!=='refine'||!['pending','unresolved'].includes(r.status)||!Number.isFinite(r.at)||sessionStartedAt<=r.at||sessionStartedAt-r.at<60000||!r.before?.refine)continue;
   const ids=r.target?.id?[r.target.id]:Object.entries(r.before.equip||{}).filter(([slot,id])=>id&&slot!=='wing').map(([,id])=>id);
   if(!ids.length)continue;
   const rows=ids.map(id=>{const prior=r.before.refine[id],current=state.refine[id];
    // A missing key means zero only when the same item is explicitly equipped.
    const before=prior===undefined&&Object.values(r.before.equip||{}).includes(id)?0:prior;
    const after=current===undefined&&Object.values(state.equip||{}).includes(id)?0:current;
    return {id,before,after};});
   if(rows.some(x=>!Number.isInteger(x.before)||!Number.isInteger(x.after)||x.before<0||x.after<x.before))continue;
   r.status=rows.some(x=>x.after>x.before)?'reconciled_increase':'reconciled_no_increase';
   r.evidence='authoritative_server_load_after_session_restart';r.finishedAt=at;
   r.reconciliation={sessionStartedAt,rev,refine:rows,costKnown:false};
   r.reason='Fresh server load establishes current refinement; old request is never replayed and historical cost is unknown';dirty=true;
  }
  if(dirty)this.save();return dirty;
 }
 reconcileEquipLoad(state,{at,sessionStartedAt,rev}={}){
  if(!state?.equip||typeof state.equip!=='object'||Array.isArray(state.equip)||!Number.isFinite(at)||!Number.isFinite(sessionStartedAt)||at<=sessionStartedAt||at-sessionStartedAt>120000)return false;
  let dirty=false;for(const r of this.rows){
   if(r.kind!=='equip'||!['pending','unresolved'].includes(r.status)||!Number.isFinite(r.at)||sessionStartedAt-r.at<60000||!r.before?.equip)continue;
   // Free swaps only: record the authoritative current state, not a historical
   // success or payment. The next command must replan against this load.
   const slots=new Set([...Object.keys(r.before.equip),...Object.keys(r.target?.equip||{})]);
   if([...slots].some(k=>!(k in state.equip)||state.equip[k]!==null&&typeof state.equip[k]!=='string'))continue;
   r.status='reconciled_equip_state';r.evidence='authoritative_server_load_after_session_restart';r.finishedAt=at;r.reconciliation={sessionStartedAt,rev,equip:Object.fromEntries([...slots].map(k=>[k,state.equip[k]])),historicalSuccessKnown:false};dirty=true;
  }if(dirty)this.save();return dirty;
 }
 observe(state,at=Date.now()){
  const r=this.rows.find(r=>r.status==='pending');if(!r||at<=r.at)return;
  const after=snapshot(state),cost={};for(const k of ['coins','tokens','runeDust','leaves'])cost[k]=r.before[k]-after[k];
  for(const group of ['materials','keyItems','consumables'])for(const key of new Set([...Object.keys(r.before[group]||{}),...Object.keys(after[group])])){const delta=(r.before[group]?.[key]||0)-(after[group][key]||0);if(delta)cost[group+':'+key]=delta;}
  const field={craft:'bag',equip:'equip',refine:'refine',enchant:'weaponOpts'}[r.kind];
  let changed=field&&!equal(r.before[field],after[field]);
  if(r.kind==='equip'&&Object.keys(r.target?.equip||{}).length)changed=Object.entries(r.target.equip).every(([slot,id])=>after.equip[slot]===id)&&!equal(r.before.equip,after.equip);
  if(r.kind==='equip'&&!changed)return; // Unrelated spending or temporary detach is never equip proof.
  if(r.kind==='craft'&&r.target?.id){const count=s=>[...(Array.isArray(s.bag)?s.bag:[]).map(x=>typeof x==='string'?x:x.id),...Object.values(s.equip)].filter(id=>id===r.target.id).length;changed=count(after)>count(r.before);}
  if(r.kind==='enchant'&&r.target?.id)changed=!equal(r.before.weaponOpts[r.target.id],after.weaponOpts[r.target.id]);
  if(r.kind==='refine')changed=r.target?.id?(after.refine[r.target.id]||0)>(r.before.refine[r.target.id]||0):Object.keys(after.refine).some(id=>(after.refine[id]||0)>(r.before.refine[id]||0));
  if(r.kind==='stage')changed=(after.stage[r.target.id]||0)>(r.before.stage?.[r.target.id]||0);
  if(r.kind==='drill')changed=(after.holes[r.target.id]||0)>(r.before.holes?.[r.target.id]||0);
  if(r.kind==='drill-quest')changed=after.drill?.id===r.target.id&&!equal(r.before.drill,after.drill);
  if(['forge-fragment','forge-essence'].includes(r.kind))changed=(after.materials[r.target.name]||0)>(r.before.materials[r.target.name]||0)&&cost.coins>0;
  if(!changed&&!Object.values(cost).some(v=>v>0))return;
  r.after=after;r.cost=cost;r.finishedAt=at;const status=changed?'change_observed':'spent_without_change';if(this.deferred===r.id)r.observedStatus=status;else r.status=status;r.evidence='outgoing_client_save';this.save();
 }
 view(){return this.rows.slice(0,20);}
}
module.exports={ResultLedger,snapshot};
