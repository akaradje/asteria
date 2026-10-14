'use strict';
const crypto=require('node:crypto'),fresh=require('./freshness');
const equal=require('./isolated-storage').equal;
const ordered=rows=>[...rows].sort();
const values=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length<=64&&Object.values(v).every(n=>Number.isFinite(n)&&Math.abs(n)<=1000000);
function stateValid(s,w){
 if(!s||!Array.isArray(s.owned)||!Array.isArray(s.book)||!s.worn||!w?.PREMIUM_BY_ID||!w.COSTUME_BOOK?.piece||typeof w.costumeBookStats!=='function')return false;
 if(new Set(s.owned).size!==s.owned.length||new Set(s.book).size!==s.book.length)return false;
 return s.book.every(id=>s.owned.includes(id)&&w.COSTUME_BOOK.piece[w.PREMIUM_BY_ID[id]?.slot]&&!Object.values(s.worn).includes(id))&&Object.entries(s.worn).every(([slot,id])=>!id||s.owned.includes(id)&&w.PREMIUM_BY_ID[id]?.slot===slot);
}
function evaluate(s,w,job){
 const p=require('../knowledge/modifier-effects').premium({...s,boost:null},w);
 if(!p.complete||!values(p.stats))return null;
 return {stats:p.stats,score:require('../power-plan').premiumScore({stats:p.stats},job,w)};
}
function plan(s,w,job,{withdraw=false}={}){
 if(!stateValid(s,w))return {action:null,reason:'book-native-ownership-or-rules-incomplete'};
 const current=evaluate(s,w,job);if(!current)return {action:null,reason:'book-native-modifiers-incomplete'};
 const premium=require('../power-plan'),reserved=new Set(premium.ownedPremiumPlan(Object.values(w.PREMIUM_BY_ID),s,job,w).items.map(x=>x.id)),candidates=[];
 for(const id of s.owned){
  const it=w.PREMIUM_BY_ID[id];if(!w.COSTUME_BOOK.piece[it?.slot]||Object.values(s.worn).includes(id))continue;
  const booked=s.book.includes(id);
  if(!booked&&!reserved.has(id)){
   const next={...s,book:[...s.book,id]},after=evaluate(next,w,job);
   if(after&&Object.keys({...current.stats,...after.stats}).every(k=>(after.stats[k]||0)>=(current.stats[k]||0))&&after.score>current.score)candidates.push({id,on:1,action:'bookDeposit',scoreGain:after.score-current.score,beforeStats:current.stats,projectedStats:after.stats});
  }else if(booked&&withdraw){
   // Withdrawal loses the book bonus first. Compare the complete native set
   // and book rules with the subsequent owned wear; never treat loss as a gain.
   const next={...s,book:s.book.filter(x=>x!==id),worn:{...s.worn,[it.slot]:id}},after=evaluate(next,w,job);
   if(after&&after.score>current.score)candidates.push({id,on:0,action:'bookWithdraw',wear:{id,slot:it.slot},scoreGain:after.score-current.score,beforeStats:current.stats,projectedStats:after.stats,requiresSeparateWearReceipt:true});
  }
 }
 candidates.sort((a,b)=>b.scoreGain-a.scoreGain||a.id.localeCompare(b.id));
 return candidates[0]||{action:null,reason:'book-no-beneficial-unused-owned-costume'};
}
function gate(i,now=Date.now(),id=''){
 const deny=reason=>({allowed:false,reason});
 if(!i.actorIdentity?.actorId||!i.actorOwner||!i.registryV32?.store.validateOwner(i.actorOwner)||!require('../registry/worker').valid(i))return deny('book-current-native-owner-required');
 if(i.socialInbox?.criticalGap||!fresh.decisionGate(i,now).allowed||i.v2?.sourceCoherence?.matches!==true||!fresh.fresh(i.vitals?.at,15000,now)||i.vitals.hp<.85||i.livePos?.dead||i.livePos?.room!=='town')return deny('book-fresh-owned-idle-town-required');
 // A proven closed-session gear/Copper intent does not touch an owned costume
 // or premium wallet. Retain that intent and all claims; only project its
 // independent footprint out of this optional action's admission check.
 const independent=require('./isolated-storage').unrelated(i,id,now);
 const admission=independent?{...i,v2:{...i.v2,journal:{rows:[]}}}:i;
 if(!require('./v3-instance').optionalWork(admission,now)||i.freeRewardsBusy||['uncertain_no_replay','legacy_reward_outcome_needs_identity_reconciliation'].includes(i.freeRewards?.status)||!independent&&i.registryV32.store.pending(i.actorIdentity.actorId).length)return deny('book-other-owner-or-uncertain-action');
 const next=i.v2?.objective?.next,personal=i.v3?.controller?.view?.();
 if(next?.ready===true&&['promotion','class','craft'].includes(next.kind)||personal?.task?.ready||i.endgameCampaign?.ready&&['class','wing'].includes(i.endgameCampaign.phase)||i.goal?.bossReturnAt&&i.goal.bossReturnAt-now<30000)return deny('book-ready-foreground-or-boss-deadline');
 return {allowed:true};
}
async function query(i){
 const at=Date.now(),generation=i.socialInbox.generation,sequence=i.socialInbox.power.premiumSequence;
 const sent=await i.socialSend('prq',{});if(!sent?.ok)return null;
 for(let n=0;n<20;n++){
  const r=i.socialInbox.power.bookView(i);
  if(i.socialInbox.generation!==generation)return null;
  if(r&&r.sequence>sequence&&r.at>=at)return r;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 return null;
}
function result(row,after,i){
 const t=row.target,w=i.catalog().world,b=t.before,s=after?.state;
 if(after?.authority!=='server_socket'||after.actorId!==row.actorId||after.generation!==row.generation||after.sequence<=t.beforeSequence||after.at<row.sentAt||!fresh.fresh(after.at,15000)||i.actorOwner.session!==row.session||!i.registryV32.store.validateOwner(i.actorOwner)||i.socialInbox.generation!==row.generation||i.catalog().build!==t.build||require('./capability-evidence').projection(i).collection?.revision!==row.contractRevision||!stateValid(s,w))return null;
 if(after.coins!==t.beforeCoins||!equal(ordered(s.owned),ordered(b.owned))||!equal(s.worn,b.worn)||!equal(ordered(s.book),ordered(t.on?[...b.book,t.id]:b.book.filter(id=>id!==t.id))))return null;
 const beforeStats=w.costumeBookStats(b.book),afterStats=w.costumeBookStats(s.book);if(!values(beforeStats)||!values(afterStats))return null;
 return {id:t.id,on:t.on,ownedUnchanged:true,wornUnchanged:true,premiumCurrencyCost:0,bookBefore:b.book,bookAfter:s.book,bookStatsBefore:beforeStats,bookStatsAfter:afterStats,PvEOnly:true,requiresSeparateWearReceipt:!t.on,measuredCombatBenefit:false,scope:'fresh_native_premium_state_delta_after_sole_book_callback'};
}
async function nativeButton(i,pick){
 if(!await i.openGamePanel('premium'))return false;
 return i.eval(`(()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.block||n.pause||n.fixed||n.kicked)return false;let body=document.getElementById('pBody');if(body?.dataset.panel!=='premium')return false;const tab=body.querySelector('[data-pt="costume"]');if(!tab||tab.disabled)return false;tab.click();body=document.getElementById('pBody');return Array.from(body.querySelectorAll('[data-pbk]')).some(b=>b.dataset.pbk===${JSON.stringify(pick.id)}&&b.dataset.on===${JSON.stringify(String(pick.on))}&&!b.disabled);})()`);
}
async function dispatch(i,pick){
 // First tap redraws the native panel. Re-select the new exact button before
 // the second tap; never retain a stale node or call prbook directly.
 return i.eval(`(()=>{const n=window.AsteriaNet,find=()=>{const p=document.getElementById('pBody');return p?.dataset.panel==='premium'?Array.from(p.querySelectorAll('[data-pbk]')).find(b=>b.dataset.pbk===${JSON.stringify(pick.id)}&&b.dataset.on===${JSON.stringify(String(pick.on))}&&!b.disabled):null;};if(!n?.isConnected?.()||n.block||n.pause||n.fixed||n.kicked)return false;const a=find();if(!a)return false;a.click();if(n.block||n.pause||n.fixed||n.kicked||!n.isConnected())return false;const b=find();if(!b||b===a)return false;b.click();return true;})()`);
}
async function execute(i){
 const actor=i.actorIdentity?.actorId,p=i.registryV32?.policy;
 if(!p?.costumeBookCanaryActors?.includes(actor))return {sent:false,reason:'book-canary-not-selected'};
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.costumeBookCanaryRunId||''))return {sent:false,reason:'book-measured-run-required'};
 const store=i.registryV32.store,id='book-canary:'+crypto.createHash('sha256').update(actor+'|'+p.costumeBookCanaryRunId).digest('hex');
 if(store.get(id))return {sent:false,reason:'book-one-attempt-per-run',id};
 const access=gate(i);if(!access.allowed)return {sent:false,reason:access.reason};
 const contract=require('./action-contract').contract(i,'costume-book');
 i.v2.scheduler.validate(contract);await i.expeditionAuto(false);
 let before=await query(i);if(!before)return {sent:false,reason:'book-fresh-native-baseline-required'};
 const pick=plan(before.state,i.catalog().world,i.lastSave.job,{withdraw:p.costumeBookCanaryWithdraw===true});
 if(!pick.action)return {sent:false,reason:pick.reason};
 const cap=require('./capability-evidence').projection(i).collection;
 if(!['READY','VERIFIED'].includes(cap?.contracts[pick.action]?.state))return {sent:false,reason:'book-current-action-review-required'};
 try{
  if(!await nativeButton(i,pick))return {sent:false,reason:'book-exact-native-button-required'};
  // Opening the native premium panel itself sends prq. Establish the final
  // baseline after opening, then revalidate the selected action against it.
  before=await query(i);if(!before)return {sent:false,reason:'book-fresh-native-baseline-required'};
  const updated=plan(before.state,i.catalog().world,i.lastSave.job,{withdraw:p.costumeBookCanaryWithdraw===true});
  if(updated.id!==pick.id||updated.action!==pick.action)return {sent:false,reason:'book-plan-changed-before-dispatch'};
  i.v2.scheduler.checkpoint();i.v2.scheduler.validate(contract);
  const latest=i.socialInbox.power.bookView(i);
  if(!gate(i,Date.now(),pick.id).allowed||!latest||latest.sequence!==before.sequence||latest.coins!==before.coins||!equal(latest.state,before.state))return {sent:false,reason:'book-baseline-or-owner-changed'};
  const claim='book-entry:'+pick.id;
  const row=store.begin({id,actorId:actor,session:i.actorOwner.session,generation:before.generation,kind:'collection:'+pick.action,bill:{[claim]:1},available:{[claim]:1},contractRevision:cap.revision,target:{id:pick.id,on:pick.on,wear:pick.wear||null,runId:p.costumeBookCanaryRunId,build:i.catalog().build,before:before.state,beforeCoins:before.coins,beforeSequence:before.sequence}});
  store.sent(id);
  try{
   if(!await dispatch(i,pick))throw Error('native_book_callback_unconfirmed');
   const after=await query(i),proof=result(store.get(id),after,i);
   if(!proof)throw Error('native_book_outcome_unconfirmed');
   const r=store.get(id);store.receipt(id,{receiptId:'book:'+id+':'+after.sequence,actorId:actor,session:r.session,generation:r.generation,kind:r.kind,authority:'server_socket',at:after.at,applied:true,proof});
   try{require('./capability-evidence').confirmed(i,id,'collection',pick.action);}catch{i.v2.bookEvidenceError='Confirmed native receipt preserved; capability projection needs refresh';}
   return {sent:true,confirmed:true,id,action:pick.action,item:pick.id,requiresSeparateWearReceipt:!!pick.wear,evidence:'native_server_premium_state',measuredCombatBenefit:false};
  }catch{
   store.transition(row.id,'UNCERTAIN',{reason:'Sole native costume book attempt has no matching server state; no replay'});
   return {sent:true,confirmed:false,id,reason:'book-native-result-uncertain-no-replay'};
  }
 }finally{await i.closeGamePanel().catch(()=>{});}
}
async function tick(i){
 if(!i.registryV32?.policy.costumeBookCanaryActors?.includes(i.actorIdentity?.actorId))return null;
 if(Date.now()-(i.v2.bookAttemptAt||0)<60000)return null;
 i.v2.bookAttemptAt=Date.now();i.v2.costumeBook={...await execute(i),at:Date.now()};
 return i.v2.costumeBook.sent?'costume book: '+(i.v2.costumeBook.confirmed?'native result confirmed':i.v2.costumeBook.reason):null;
}
module.exports={plan,evaluate,stateValid,gate,query,result,nativeButton,dispatch,execute,tick};
