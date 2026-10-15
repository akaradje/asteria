'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),rules=require('../planning/team-trade');
const terminal=phase=>['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(phase);
const freshStatus=(s,now)=>Number.isFinite(s.at)&&now>=s.at&&now-s.at<30000;
const sameSession=(a,b)=>a!=null&&b!=null&&String(a)===String(b);
function inventoryProof(i,r,intent,now=Date.now()){
 const c=r.context,id=i.actorIdentity?.actorId;if(!c||!id||c.actorId!==id||c.sessionStartedAt!==i.bagSessionStartedAt||c.generation!==i.socialInbox?.generation||c.build!==intent.build)return null;
 for(const receipt of [i.acceptedSaveReceipt,i.serverSaveReceipt]){const p=receipt?.proof;if(!p||!['server_accepted_save','server_readback'].includes(p.authority)||p.actorId!==id||p.generation!==c.generation||p.sessionStartedAt!==c.sessionStartedAt||p.build!==c.build||p.at<r.doneAt||p.requestAt<=r.doneAt||now<p.at||now-p.at>30000||p.rev<r.receipt.rev)continue;const after=quantity(receipt.state,intent.offer),expected=r.before+(i.character.name===intent.offer.donor?-intent.offer.quantity:intent.offer.quantity);if(after===expected)return {after,at:p.at,rev:p.rev,actorId:id,authority:p.authority,sessionStartedAt:p.sessionStartedAt,generation:p.generation};}return null;
}
function receiptMatches(done,r,intent,name){if(!done||!r.sent?.confirm||!Number.isFinite(r.confirmAt)||done._receivedAt<r.confirmAt||done._receivedAt<intent.startedAt||!Number.isInteger(done.rev)||done.rev<0||done.id==null)return false;const donor=name===intent.offer.donor,partner=donor?intent.offer.receiver:intent.offer.donor;if(done.with!==partner)return false;const normalized=s=>({...s,coins:s?.coins||0,gear:s?.gear||[],stacks:s?.stacks||[]});return rules.exactOffer(normalized(done.gave),intent.offer,donor)&&rules.exactOffer(normalized(done.got),intent.offer,!donor);}
class TeamTrade{
 constructor(root,config,machine){this.root=root;this.config=config;this.machine=machine;this.file=path.join(root,'logs/fleet/team-trade.json');this.quarantineFile=path.join(root,'logs/fleet/team-trade-quarantine.json');try{this.quarantined=JSON.parse(fs.readFileSync(this.quarantineFile));}catch{this.quarantined=[];}try{this.state=JSON.parse(fs.readFileSync(this.file));}catch{this.state={phase:'IDLE'};}if(!terminal(this.state.phase)){if(this.state.phase==='GATHERING'){this.state.phase='CANCELLED';this.state.evidence='not_dispatched_gathering_phase';this.state.finishedAt=Date.now();this.state.reason='Restart before server trade session; replan from fresh inventory';}else{this.state.phase='UNCERTAIN';this.state.reason='Restart during trade; do not replay or confirm automatically';}this.save();}}
 preserveUncertain(now){if(this.state.phase!=='UNCERTAIN'||!this.state.id||this.quarantined.some(q=>q.id===this.state.id))return;this.quarantined.push({...this.state,quarantinedAt:now,resolution:'unresolved_no_replay'});fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.quarantineFile+'.tmp',JSON.stringify(this.quarantined));fs.renameSync(this.quarantineFile+'.tmp',this.quarantineFile);}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const r=this.state,key=r.id+':'+r.phase;if(terminal(r.phase)&&r.id&&r.finishedAt&&r.loggedOutcome!==key){fs.appendFileSync(path.join(this.root,'logs/fleet/team-trade-events.jsonl'),JSON.stringify({id:r.id,phase:r.phase,offer:r.offer,at:r.finishedAt,evidence:r.evidence||null,reason:r.reason||null})+'\n');r.loggedOutcome=key;}fs.writeFileSync(this.file+'.tmp',JSON.stringify(r));fs.renameSync(this.file+'.tmp',this.file);}
 reconcile(sources,cat,now=Date.now(),{activityActive=false}={}){
  if(this.machine!==(this.config.coordinatorHost||'tum'))return;const members=sources.filter(s=>s.build===cat.build&&now-s.at>=-5000&&now-s.at<15000).flatMap(s=>(s.members||[]).map(m=>({...m,machine:s.machine}))),r=this.state;
  if(!terminal(r.phase)&&r.build!==cat.build){r.phase=r.phase==='GATHERING'?'CANCELLED':'UNCERTAIN';r.reason='Game build changed; stop old intent and replan';r.finishedAt=now;if(r.phase==='CANCELLED')r.evidence='not_dispatched_gathering_phase';this.save();}
  if(!this.historyScanAt||now-this.historyScanAt>=60000){
   this.historyScanAt=now;const found=require('./trade-outcome-recovery').discoverMixed(this.root,this.machine,members,new Set(this.quarantined.map(q=>q.id)),now);
   if(found.length){this.quarantined.push(...found);fs.mkdirSync(path.dirname(this.quarantineFile),{recursive:true});fs.writeFileSync(this.quarantineFile+'.tmp',JSON.stringify(this.quarantined));fs.renameSync(this.quarantineFile+'.tmp',this.quarantineFile);}
  }
  let recovered=false;
  for(const q of this.quarantined.filter(q=>q.resolution==='unresolved_no_replay')){
   if(require('./material-budget-recovery').resolve(this.root,q,members,this.machine,cat.build,now)){recovered=true;continue;}
   const pair=[q.offer?.donor,q.offer?.receiver].map(name=>{const m=members.find(m=>m.charName===name);return m?{m,s:m.teamTradeStatus?.id===q.id?m.teamTradeStatus:m.teamTradeStatus?.recoveredOutcomes?.find(s=>s.id===q.id)}:null;});
   if(pair.every(x=>x?.s?.phase==='CONFIRMED'&&x.s.recordedNativeConfirmation===true&&x.s.nativeInventoryProof?.actorId===x.m.identity?.actorId&&x.s.id===q.id&&x.s.offer?.donor===q.offer.donor&&x.s.offer?.receiver===q.offer.receiver&&x.s.offer?.kind===q.offer.kind&&x.s.offer?.name===q.offer.name&&x.s.offer?.quantity===q.offer.quantity&&freshStatus(x.s,now))&&sameSession(pair[0].s.receiptId,pair[1].s.receiptId)){q.resolution='resolved_original_receipts_and_native_inventory';q.resolvedAt=now;q.receiptId=pair[0].s.receiptId;recovered=true;}
  }
  if(recovered){fs.writeFileSync(this.quarantineFile+'.tmp',JSON.stringify(this.quarantined));fs.renameSync(this.quarantineFile+'.tmp',this.quarantineFile);}
  if(r.phase==='UNCERTAIN'){
   this.preserveUncertain(now);
   const confirmed=[r.offer?.donor,r.offer?.receiver].map(name=>{const m=members.find(m=>m.charName===name);return m?{...m,teamTradeStatus:m.teamTradeStatus?.id===r.id?m.teamTradeStatus:m.teamTradeStatus?.recoveredOutcomes?.find(s=>s.id===r.id)}:null;});
   if(confirmed.length===2&&confirmed.every(m=>m?.teamTradeStatus?.id===r.id&&m.teamTradeStatus.phase==='CONFIRMED'&&m.teamTradeStatus.recordedNativeConfirmation===true&&m.teamTradeStatus.nativeInventoryProof?.actorId===m.identity?.actorId&&freshStatus(m.teamTradeStatus,now))&&sameSession(confirmed[0].teamTradeStatus.receiptId,confirmed[1].teamTradeStatus.receiptId)){
    const q=this.quarantined.find(q=>q.id===r.id);if(q){q.resolution='resolved_original_receipts_and_native_inventory';q.resolvedAt=now;fs.writeFileSync(this.quarantineFile+'.tmp',JSON.stringify(this.quarantined));fs.renameSync(this.quarantineFile+'.tmp',this.quarantineFile);}
    r.previousOutcome={phase:r.phase,reason:r.reason,finishedAt:r.finishedAt};r.phase='CONFIRMED';r.receiptId=confirmed[0].teamTradeStatus.receiptId;r.evidence='matching_original_native_receipts_and_both_inventory_proofs_no_replay';r.finishedAt=now;this.save();return;
   }

   const pair=[r.offer?.donor,r.offer?.receiver].map(name=>members.find(m=>m.charName===name));
   const freshCancelled=pair.every(m=>m?.teamTradeStatus?.id===r.id&&m.teamTradeStatus.phase==='CANCELLED'&&now-m.teamTradeStatus.at>=0&&now-m.teamTradeStatus.at<30000&&m.tradeAvailability?.clear===true&&now-m.tradeAvailability.at>=0&&now-m.tradeAvailability.at<30000&&now-m.lastSaveAt>=0&&now-m.lastSaveAt<30000);
   if(freshCancelled&&pair.every(m=>m.teamTradeStatus.closedWithoutConfirmation===true)&&sameSession(pair[0].teamTradeStatus.cancelledSessionId,pair[1].teamTradeStatus.cancelledSessionId)){
    const q=this.quarantined.find(q=>q.id===r.id);if(q){q.resolution='resolved_native_cancel_no_confirmation';q.resolvedAt=now;q.resolutionEvidence='both_original_native_sessions_closed_without_confirmation_and_unchanged_inventory';fs.writeFileSync(this.quarantineFile+'.tmp',JSON.stringify(this.quarantined));fs.renameSync(this.quarantineFile+'.tmp',this.quarantineFile);}
    r.phase='CANCELLED';r.finishedAt=now;r.evidence='matching_native_cancellation_and_both_unchanged_saves';r.reason='Both original actors verified native session cancellation before confirmation; replan from fresh inventory';this.save();return;
   }
   if(pair.length===2&&pair.every(m=>m?.teamTradeStatus?.id===r.id&&m.teamTradeStatus.phase==='CANCELLED'&&m.teamTradeStatus.noDispatch===true&&now-m.teamTradeStatus.at>=0&&now-m.teamTradeStatus.at<30000&&m.tradeAvailability?.clear===true&&now-m.tradeAvailability.at>=0&&now-m.tradeAvailability.at<30000&&now-m.lastSaveAt>=0&&now-m.lastSaveAt<30000)){
    const q=this.quarantined.find(q=>q.id===r.id);if(q){q.resolution='resolved_not_dispatched';q.resolvedAt=now;q.resolutionEvidence='both_durable_actor_journals_no_commands_and_fresh_clear_native_sessions';fs.writeFileSync(this.quarantineFile+'.tmp',JSON.stringify(this.quarantined));fs.renameSync(this.quarantineFile+'.tmp',this.quarantineFile);}
    r.phase='CANCELLED';r.finishedAt=now;r.evidence='both_durable_actor_journals_no_server_commands';r.reason='Both original actors proved no trade command was dispatched; replan from fresh wallets';this.save();return;
   }
  }
  if(r.phase==='CANCELLED'&&r.id){
   const pair=[r.offer?.donor,r.offer?.receiver].map(n=>members.find(m=>m.charName===n)?.teamTradeStatus);
   if(pair.some(a=>a?.id===r.id&&(a.confirmationSent||['CONFIRM_SENT','VERIFYING','CONFIRMED','UNCERTAIN'].includes(a.phase)))){
    const hash=require('./material-budget-recovery').preserve(this.root,{version:1,kind:'mixed_trade_terminal',original:JSON.parse(JSON.stringify(r)),replayBlocked:true});
    r.previousOutcome={phase:r.phase,reason:r.reason,finishedAt:r.finishedAt,originalSha256:hash};r.phase='UNCERTAIN';r.reason='Mixed confirmation and cancellation; reconcile both original actors, no replay';r.finishedAt=now;this.preserveUncertain(now);this.save();return;
   }
  }
  if(terminal(r.phase)){if(activityActive)return;const cooldown=r.phase==='CONFIRMED'&&r.receiptId!=null&&['matching_server_trade_receipts_and_both_outgoing_saves','matching_server_trade_receipts_and_both_native_inventory_proofs'].includes(r.evidence)?15000:120000;if(now-(r.finishedAt||0)<cooldown)return;const unresolved=this.quarantined.filter(q=>q.resolution==='unresolved_no_replay');const eligible=unresolved.length?members.filter(m=>{const a=m.tradeAvailability;return a?.clear===true&&now-a.at>=-5000&&now-a.at<30000&&now-m.lastSaveAt>=-5000&&now-m.lastSaveAt<30000;}):members;const offer=rules.choose(eligible,{...cat,root:this.root},now,unresolved.map(q=>q.offer));if(!offer)return;this.state={id:crypto.randomUUID(),offer,build:cat.build,phase:'GATHERING',at:now,startedAt:now,deadline:now+600000};this.save();return;}
  const pair=[r.offer.donor,r.offer.receiver].map(name=>members.find(m=>m.charName===name));if(now>=r.deadline){r.phase=r.phase==='GATHERING'?'CANCELLED':'UNCERTAIN';r.reason=r.phase==='CANCELLED'?'Gathering deadline before server session; replan':'Trade deadline; inspect server and both inventories before any retry';r.finishedAt=now;if(r.phase==='CANCELLED')r.evidence='not_dispatched_gathering_phase';this.save();return;}
  const acks=pair.map(m=>m?.teamTradeStatus).filter(a=>a?.id===r.id&&now-a.at<30000);
  if(acks.some(a=>a.phase==='CANCELLED'||a.phase==='UNCERTAIN')){r.phase=acks.some(a=>a.phase==='UNCERTAIN'||a.confirmationSent||['CONFIRM_SENT','VERIFYING','CONFIRMED'].includes(a.phase))?'UNCERTAIN':'CANCELLED';r.reason=acks.find(a=>a.reason)?.reason;r.finishedAt=now;}
  else if(acks.length===2&&acks.every((a,n)=>a.phase==='CONFIRMED'&&a.nativeInventoryProof?.actorId===pair[n]?.identity?.actorId&&a.nativeInventoryProof?.rev>=0&&a.nativeInventoryProof.at>=r.startedAt&&now>=a.nativeInventoryProof.at&&now-a.nativeInventoryProof.at<30000)&&sameSession(acks[0].receiptId,acks[1].receiptId)){r.phase='CONFIRMED';r.receiptId=acks[0].receiptId;r.evidence='matching_server_trade_receipts_and_both_native_inventory_proofs';r.finishedAt=now;}
  else if(r.phase==='GATHERING'&&acks.length===2&&acks.every(a=>a.phase==='READY')&&pair.every(m=>m.livePos?.room==='town'&&now-m.livePos.at<10000)&&Math.hypot(pair[0].livePos.x-pair[1].livePos.x,pair[0].livePos.z-pair[1].livePos.z)<8){r.phase='SESSION';r.deadline=Math.min(r.deadline,now+120000);}
  if(r.phase==='UNCERTAIN')this.preserveUncertain(now);r.at=now;this.save();
 }
 view(){return {...this.state,blockedMaterials:[...new Set(this.quarantined.filter(q=>q.offer?.kind==='material'&&q.resolution==='unresolved_no_replay').map(q=>q.offer.name))],quarantineCount:this.quarantined.length,quarantined:this.quarantined.slice(-8).map(q=>({id:q.id,offer:q.offer,reason:q.reason,resolution:q.resolution,quarantinedAt:q.quarantinedAt}))};}
}
function quantity(save,offer){return offer.kind==='currency'?save.coins:offer.kind==='material'?save.materials?.[offer.name]||0:require('../economy').ownedNames(save).filter(id=>id===offer.id).length;}
function journal(i,intent){if(i.tradeJournal?.id===intent.id)return i.tradeJournal;if(!/^[a-zA-Z0-9-]{1,80}$/.test(intent.id))throw Error('Invalid trade operation id');const base=path.join(i.root,'logs/trades',crypto.createHash('sha256').update(i.character.name).digest('hex').slice(0,24)),file=path.join(base,intent.id+'.json');let saved;try{saved=JSON.parse(fs.readFileSync(file));}catch{try{saved=JSON.parse(fs.readFileSync(base+'.json'));}catch{}}if(saved&&saved.id!==intent.id){fs.mkdirSync(base,{recursive:true});if(/^[a-zA-Z0-9-]{1,80}$/.test(saved.id)&&!fs.existsSync(path.join(base,saved.id+'.json')))fs.writeFileSync(path.join(base,saved.id+'.json'),JSON.stringify(saved));}if(saved?.id===intent.id&&!terminal(saved.phase)){saved.phase='UNCERTAIN';saved.reason='Actor restarted during transfer; reconcile receipt before retry';}const row=saved?.id===intent.id?saved:{id:intent.id,at:Date.now(),context:{actorId:i.actorIdentity?.actorId,sessionStartedAt:i.bagSessionStartedAt,generation:i.socialInbox?.generation,build:intent.build},before:quantity(i.lastSave,intent.offer),phase:'GATHERING',sent:{}};i.tradeJournal=row;i.tradeJournalFile=file;i.tradeJournalLatest=base+'.json';return row;}
function noDispatch(r){return !!(r?.sent&&typeof r.sent==='object'&&!Array.isArray(r.sent)&&r.sessionId==null&&r.receipt==null&&Object.entries(r.sent).every(([k,v])=>['request','accept','offer','lock','confirm','cancel'].includes(k)&&v===false));}
function persist(i){fs.mkdirSync(path.dirname(i.tradeJournalFile),{recursive:true});const r=i.tradeJournal;if(i.teamTradeIntent?.id===r.id){r.offer=i.teamTradeIntent.offer;r.build=i.teamTradeIntent.build;r.deadline=i.teamTradeIntent.deadline;}const data=JSON.stringify(r);fs.writeFileSync(i.tradeJournalFile+'.tmp',data);fs.renameSync(i.tradeJournalFile+'.tmp',i.tradeJournalFile);if(i.tradeJournalLatest)fs.writeFileSync(i.tradeJournalLatest,data);i.teamTradeStatus={id:r.id,phase:r.phase,at:Date.now(),receiptId:r.receipt?.id??null,nativeInventoryProof:r.nativeInventoryProof||null,reason:r.reason||null,noDispatch:noDispatch(r),closedWithoutConfirmation:!!r.closedCancellationEvidence&&!r.sent?.confirm&&!r.receipt,cancelledSessionId:r.closedCancellationEvidence?.sessionId??null,navigationReleased:!!r.idleNavigationEvidence,confirmationSent:!!r.sent?.confirm,doneAt:r.doneAt||null,recordedNativeConfirmation:require('./trade-outcome-recovery').recorded(r,i.character?.name),originalPhase:r.readbackRecovery?.originalPhase||null,recoveredOutcomes:i.tradeRecoveredOutcomes||[],idleAfter:Number.isFinite(r.at)?r.at+600000:null,idleNavigationEvidence:r.idleNavigationEvidence||null,offer:r.offer||null};}
function recordedMaterialConfirmation(r,name,now=Date.now()){
 const o=r?.offer;
 return r?.nativeInventoryProof?.actorId===r?.context?.actorId&&typeof r?.context?.actorId==='string'&&r.nativeInventoryProof.at===r.afterAt&&r.nativeInventoryProof.rev>=r.receipt?.rev&&r?.phase==='UNCERTAIN'&&r.reason==='Coordinator stale or deadline expired; no replay'&&o?.kind==='material'&&typeof o.name==='string'&&o.name!=='Copper'&&[o.donor,o.receiver].includes(name)&&o.donor!==o.receiver&&Number.isSafeInteger(o.quantity)&&o.quantity>0&&r.sent?.confirm===true&&r.receipt?.id!=null&&Number.isInteger(r.receipt.rev)&&r.receipt.rev>=0&&Number.isFinite(r.at)&&Number.isFinite(r.confirmAt)&&r.confirmAt>=r.at&&Number.isFinite(r.doneAt)&&r.doneAt>=r.confirmAt&&r.receipt.at===r.doneAt&&Number.isFinite(r.afterAt)&&r.afterAt>r.doneAt&&r.afterAt<=now&&Number.isSafeInteger(r.before)&&r.before>=0&&Number.isSafeInteger(r.after)&&r.after>=0&&r.after===r.before+(name===o.donor?-o.quantity:o.quantity);
}
async function reconcileRecordedConfirmation(i,now=Date.now()){
 let r=i.tradeJournal;if(!r)try{r=JSON.parse(fs.readFileSync(path.join(i.root,'logs/trades',crypto.createHash('sha256').update(i.character.name).digest('hex').slice(0,24)+'.json')));}catch{return false;}
 const fresh=require('./freshness');
 if(!recordedMaterialConfirmation(r,i.character.name,now)||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed||!fresh.fresh(i.tradeAvailability?.at,15000,now)||i.tradeAvailability.clear!==true||i.lastSaveAt<=r.afterAt)return false;
 const names=require('../planning/cross-party').roster(i.root).members.map(m=>m.charName);if(!names.includes(r.offer.donor)||!names.includes(r.offer.receiver))return false;
 if(!i.tradeJournal)journal(i,{id:r.id,offer:r.offer,build:r.build});
 r=i.tradeJournal;r.recordedConfirmationRecovery={at:now,previousPhase:r.phase,previousReason:r.reason,evidence:'original_validated_receipt_and_recorded_outgoing_save_delta'};
 r.phase='CONFIRMED';r.reason='Restored original recorded receipt/save confirmation; no command resent';persist(i);return true;
}
async function reconcileIdleHistory(i){
 let saved=i.tradeJournal;if(!saved){try{saved=JSON.parse(fs.readFileSync(path.join(i.root,'logs/trades',crypto.createHash('sha256').update(i.character.name).digest('hex').slice(0,24)+'.json')));}catch{return false;}}
 if(!['UNCERTAIN','READY','GATHERING'].includes(saved.phase)||saved.sent?.confirm||saved.receipt)return false;
 const q=i.teamTradeIntent?.quarantined?.find(q=>q.id===saved.id&&q.resolution==='unresolved_no_replay');
 if(!q?.offer||!Number.isFinite(q.quarantinedAt)||!Number.isFinite(saved.at)||![q.offer.donor,q.offer.receiver].includes(i.character.name))return false;
 const intent={id:saved.id,offer:q.offer,build:i.catalog().build,phase:'UNCERTAIN',startedAt:saved.at,deadline:Math.max(saved.at+600000,q.quarantinedAt+120000)};
 const names=require('../planning/cross-party').roster(i.root).members.map(m=>m.charName);if(!names.includes(q.offer.donor)||!names.includes(q.offer.receiver))return false;
 if(!i.tradeJournal){journal(i,intent);i.tradeJournal.offer=q.offer;}
 if(i.tradeJournal.phase!=='UNCERTAIN'){
  const now=Date.now(),fresh=require('./freshness');
  if(now<intent.deadline||i.v2?.sourceCoherence?.matches!==true||!fresh.fresh(i.tradeAvailability?.at,15000,now)||i.tradeAvailability.clear!==true||!fresh.decisionGate(i,now).allowed||i.lastSaveAt<=intent.deadline||await ownsSession(i))return false;
  i.tradeJournal.phase='UNCERTAIN';i.tradeJournal.reason='Original coordinator quarantined transfer; fresh idle native session releases navigation only, no replay';persist(i);
 }
 return releaseIdleNavigation(i,intent);
}
function blocksNavigation(i,now=Date.now()){
 const s=i.teamTradeStatus;if(!s?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(s.phase))return false;
 return !(s.phase==='UNCERTAIN'&&s.navigationReleased===true&&require('./freshness').fresh(s.at,30000,now)&&require('./freshness').fresh(i.tradeAvailability?.at,15000,now)&&i.tradeAvailability.clear===true&&require('./freshness').decisionGate(i,now).allowed);
}
async function releaseIdleNavigation(i,intent,now=Date.now()){
 const r=i.tradeJournal,fresh=require('./freshness');
 if(r?.id!==intent.id||r.phase!=='UNCERTAIN'||r.sent?.confirm||r.receipt||now<intent.deadline||i.v2?.sourceCoherence?.matches!==true||!fresh.fresh(i.tradeAvailability?.at,15000,now)||i.tradeAvailability.clear!==true||!fresh.decisionGate(i,now).allowed||i.lastSaveAt<=intent.deadline||await ownsSession(i))return false;
 // Native connected/unpaused client plus a post-deadline save releases ONLY
 // personal navigation. It cannot settle the money/item result, remove the
 // quarantine, confirm, request or resend the old transaction.
 r.idleNavigationEvidence={at:now,saveAt:i.lastSaveAt,kind:'fresh_native_idle_after_deadline_no_confirmation',outcome:'unknown',replayBlocked:true};persist(i);return true;
}
async function protocolLease(i,intent,now=Date.now()){
 if(intent.phase!=='SESSION'||now>=intent.deadline||i.v2?.sourceCoherence?.matches!==true||i.tradeJournal?.id!==intent.id)return false;
 const roster=require('../planning/cross-party').roster(i.root).members;
 const a=roster.find(m=>m.charName===intent.offer.donor),b=roster.find(m=>m.charName===intent.offer.receiver);
 if(!a?.machine||!b?.machine)return false;
 const open=await i.socialLast('tropen'),state=await i.socialLast('trstate'),closed=await i.socialLast('trclosed');
 const partner=i.character.name===intent.offer.donor?intent.offer.receiver:intent.offer.donor;
 if(!Number.isFinite(open?._receivedAt)||open._receivedAt<intent.startedAt||open?.with?.name!==partner||i.tradeJournal.sessionId&&!sameSession(open?.id,i.tradeJournal.sessionId)||!sameSession(state?.id,open?.id)||sameSession(closed?.id,open?.id)||!require('./freshness').fresh(state?._receivedAt,15000,now))return false;
 const r=i.tradeJournal;if(!r.protocolLeaseUntil){r.sessionId=open.id;r.protocolLeaseUntil=Math.min(intent.deadline,now+120000);persist(i);}
 return now<r.protocolLeaseUntil;
}
function reconcileUnsentCancellation(i){
 const intent=i.teamTradeIntent,r=i.tradeJournal;
 if(!['CANCELLED','UNCERTAIN'].includes(intent?.phase)||!r||r.id!==intent.id||!['GATHERING','READY','UNCERTAIN'].includes(r.phase)||r.sessionId||r.receipt||!r.sent||typeof r.sent!=='object'||Object.values(r.sent).some(Boolean))return false;
 // Coordinator uncertainty stays until BOTH actors prove no command was sent.
 // This actor can release a READY
 // acknowledgement only when its durable journal proves no command was sent.
 r.phase='CANCELLED';r.reason='Local transfer never dispatched; coordinator outcome preserved: '+(intent.reason||intent.phase);r.evidence='no_server_trade_command_dispatched';persist(i);return true;
}
async function ownsSession(i){const r=i.tradeJournal;if(!r?.sessionId)return false;const open=await i.socialLast('tropen'),done=await i.socialLast('trdone'),closed=await i.socialLast('trclosed');return sameSession(open?.id,r.sessionId)&&!receiptMatches(done,r,i.teamTradeIntent,i.character.name)&&!sameSession(closed?.id,r.sessionId);}
async function reconcileClosedCancellation(i,now=Date.now()){
 const r=i.tradeJournal,fresh=require('./freshness');
 if(!r||!['UNCERTAIN','CANCELLED'].includes(r.phase)||r.sent?.confirm||r.receipt||r.sessionId==null||!r.offer||!Number.isFinite(r.at)||r.build!==i.catalog().build||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed||!fresh.fresh(i.tradeAvailability?.at,15000,now)||i.tradeAvailability.clear!==true)return false;
 const roster=require('../planning/cross-party').roster(i.root).members;if(![r.offer.donor,r.offer.receiver].includes(i.character.name)||![r.offer.donor,r.offer.receiver].every(n=>roster.some(m=>m.charName===n)))return false;
 const closed=await i.socialLast('trclosed'),open=await i.socialLast('tropen'),done=await i.socialLast('trdone');
 const partner=i.character.name===r.offer.donor?r.offer.receiver:r.offer.donor;
 if(!sameSession(closed?.id,r.sessionId)||!Number.isFinite(closed._receivedAt)||closed._receivedAt<r.at||i.lastSaveAt<=closed._receivedAt||!sameSession(open?.id,r.sessionId)||open.with?.name!==partner||sameSession(done?.id,r.sessionId)||!Number.isSafeInteger(r.before)||quantity(i.lastSave,r.offer)!==r.before)return false;
 r.phase='CANCELLED';r.closedCancellationEvidence={sessionId:r.sessionId,closedAt:closed._receivedAt,saveAt:i.lastSaveAt,before:r.before,after:quantity(i.lastSave,r.offer)};r.reason='Native original session closed before confirmation; inventory unchanged';persist(i);return true;
}
function cancelUncommittedForSpace(i,now=Date.now()){
 const intent=i.teamTradeIntent,r=i.tradeJournal,name=i.character?.name;
 if(i.teamControl||i.dailyWorkStatus?.ownsNavigation||intent?.phase!=='GATHERING'||intent.offer?.kind!=='gear'||intent.offer.receiver!==name||r?.id!==intent.id||!['GATHERING','READY'].includes(r.phase)||!noDispatch(r)||!require('./freshness').decisionGate(i,now).allowed||i.v2?.sourceCoherence?.matches!==true)return false;
 const cap=i.catalog().world.bagCap?.(i.lastSave?.bagTier||0);if(!Number.isInteger(cap)||!Array.isArray(i.lastSave?.bag)||cap-i.lastSave.bag.length>=2)return false;
 // Publishing CANCELLED prevents coordinator advancement; the original intent
 // remains in history. No native cancellation is invented for an unsent trade.
 i.capacityGoal={kind:'trade-gear',id:intent.id,build:intent.build,actorId:i.actorIdentity?.actorId,donor:intent.offer.donor,receiver:name,minimum:2,at:now};
 r.phase='CANCELLED';r.reason='Receiver needs bag space; release uncommitted gather and replan after inventory work';r.evidence='no_server_trade_command_dispatched';r.cancelledAt=now;persist(i);return true;
}
function protocolActive(i,now=Date.now()){const r=i.teamTradeIntent;return !!(r?.offer&&r.build===i.catalog().build&&[r.offer.donor,r.offer.receiver].includes(i.character?.name)&&!terminal(r.phase)&&(r.phase==='SESSION'||i.tradeJournal?.sessionId));}
function cleanupPending(i){const r=i.teamTradeIntent,j=i.tradeJournal;return !!(r?.offer&&['UNCERTAIN','CANCELLED'].includes(r.phase)&&r.build===i.catalog().build&&[r.offer.donor,r.offer.receiver].includes(i.character?.name)&&j?.id===r.id&&j.sessionId&&!j.sent?.cancel);}
async function observeNativeOutcome(i,persistRow=persist){
 const r=i.tradeJournal;if(!r?.sessionId||!r.offer||!r.context||r.phase==='CONFIRMED'||!['CONFIRM_SENT','VERIFYING','UNCERTAIN','CANCELLED'].includes(r.phase)||r.context.actorId!==i.actorIdentity?.actorId||r.context.sessionStartedAt!==i.bagSessionStartedAt||r.context.generation!==i.socialInbox?.generation||r.build!==i.catalog().build||i.registryV32?.store?.validateOwner(i.actorOwner)!==true)return false;
 const intent={id:r.id,offer:r.offer,build:r.build,startedAt:r.at},done=await i.socialLast('trdone'),closed=await i.socialLast('trclosed');
 const exact=receiptMatches(done,r,intent,i.character.name);
 if(!exact&&(!sameSession(closed?.id,r.sessionId)||closed._receivedAt<r.at))return false;
 require('./trade-outcome-recovery').archive(i,r);
 if(exact){r.doneAt=done._receivedAt;r.receipt={id:done.id,rev:done.rev,at:done._receivedAt,validatedExactOffer:true,with:done.with,gave:done.gave,got:done.got};r.phase='VERIFYING';const p=inventoryProof(i,r,intent);if(p){r.after=p.after;r.afterAt=p.at;r.nativeInventoryProof=p;r.phase='CONFIRMED';}r.reason='Original native receipt observed after coordinator termination; no replay';}
 else {r.nativeCloseEvidence={id:closed.id,at:closed._receivedAt,reason:closed.reason,confirmationSent:!!r.sent?.confirm};r.phase=r.sent?.confirm?'UNCERTAIN':'CANCELLED';r.reason='Original native session closed; preserve confirmation uncertainty, no replay';}
 persistRow(i);return true;
}
function refineMaterialBudget(i,intent){
 const o=intent.offer;if(o?.goalKind!=='refine')return true;
 if(o.kind!=='material'||!Number.isSafeInteger(o.quantity)||o.quantity<=0||typeof o.goalId!=='string'||!i.catalog().items[o.goalId])return false;
 const frozen=require('./trade-material-budget').frozen(i,intent);
 if(!frozen&&(!i.lastSaveAt||Date.now()-i.lastSaveAt>30000))return false;
 const work=frozen?.work||require('../planning/team-workboard').project(i),m={teamWork:work,teamInventory:{materials:frozen?.materials||i.lastSave?.materials||{}}};
 if(i.character.name===o.donor)return !i.lastSave?.locks?.includes(o.name)&&(i.lastSave?.materials?.[o.name]||0)-require('../planning/team-workboard').ownKeep(m,o.name)>=o.quantity;
 const need=work.needs.find(n=>n.kind==='refine'&&n.goalId===o.goalId&&n.name===o.name);return !!need&&need.want-require('../planning/team-workboard').available(m,o.name)>=o.quantity;
}
async function tick(i,screen){
 if(i.character?.name&&i.root&&!i.tradeJournal){try{const name=crypto.createHash('sha256').update(i.character.name).digest('hex').slice(0,24),latest=path.join(i.root,'logs/trades',name+'.json'),saved=JSON.parse(fs.readFileSync(latest));if(/^[a-zA-Z0-9-]{1,80}$/.test(saved.id||'')&&['VERIFYING','UNCERTAIN','CONFIRMED','CONFIRM_SENT'].includes(saved.phase)){i.tradeJournal=saved;i.tradeJournalFile=path.join(i.root,'logs/trades',name,saved.id+'.json');i.tradeJournalLatest=latest;}}catch{}}
 if(i.tradeJournal)await observeNativeOutcome(i,persist);
 if(i.tradeJournal)await require('./trade-outcome-recovery').reconcile(i,{persist,ownsSession});
 if(i.character?.name&&i.root)await require('./trade-outcome-recovery').history(i,{persist,ownsSession});

 if(i.character?.name&&i.root)await reconcileRecordedConfirmation(i);
 if(i.character?.name&&i.root)await reconcileIdleHistory(i);
 if(i.character?.name&&i.root)await reconcileClosedCancellation(i);
 const intent=i.teamTradeIntent,name=i.character?.name;if(!intent?.offer||![intent.offer.donor,intent.offer.receiver].includes(name)||intent.build!==i.catalog().build)return null;
   // Budget rebase never makes the historical UUID dispatchable again.
   if(require('./material-budget-recovery').replayBlocked(i,intent.id))return null;
 // A verified original outcome cannot be downgraded by a stale coordinator.
 if(i.tradeJournal?.id===intent.id&&i.tradeJournal.phase==='CONFIRMED'){persist(i);return null;}
 if(terminal(intent.phase)){
  if(['UNCERTAIN','CANCELLED'].includes(intent.phase)&&i.tradeJournal?.id!==intent.id&&/^[a-zA-Z0-9-]{1,80}$/.test(intent.id)){
   const file=path.join(i.root,'logs/trades',crypto.createHash('sha256').update(name).digest('hex').slice(0,24),intent.id+'.json');let saved;try{saved=JSON.parse(fs.readFileSync(file));}catch{}
   // Never invent an empty journal as evidence about a previous process.
   if(saved?.id===intent.id&&!saved.sent?.confirm&&!saved.receipt){journal(i,intent);if(noDispatch(saved))reconcileUnsentCancellation(i);if(i.tradeJournal.phase==='CANCELLED')persist(i);}
  }
  if(i.tradeJournal?.id===intent.id&&i.tradeJournal.phase==='CANCELLED'&&noDispatch(i.tradeJournal))persist(i);
  if(cleanupPending(i)&&await ownsSession(i)){await i.socialSend('trcancel');i.tradeJournal.sent.cancel=true;i.tradeJournal.phase=intent.phase;persist(i);return 'trade: cancelled owned terminal session; awaiting server close';}
  await releaseIdleNavigation(i,intent);return null;
 }
 if((Date.now()-intent.at>20000&&!await protocolLease(i,intent))||Date.now()>intent.deadline){const stale=journal(i,intent);if(await ownsSession(i)&&!stale.sent.cancel){stale.sent.cancel=true;persist(i);await i.socialSend('trcancel');}stale.phase='UNCERTAIN';stale.reason='Coordinator stale or deadline expired; no replay';persist(i);return 'trade stopped: stale coordinator';}
 const r=journal(i,intent),donor=name===intent.offer.donor,partner=donor?intent.offer.receiver:intent.offer.donor;const config=require('../planning/cross-party').roster(i.root);if(!config.members.some(m=>m.charName===partner))return null;
 const frame=async type=>{const x=await i.socialLast(type);return x&&x._receivedAt>=intent.startedAt?x:null;};
 const finish=(phase,reason)=>{r.phase=phase;r.reason=reason;persist(i);return 'team trade: '+phase+' '+(reason||'');};
 if(['CONFIRMED','CANCELLED','UNCERTAIN'].includes(r.phase)){const active=await ownsSession(i);if(r.phase==='UNCERTAIN'&&active&&!r.sent.cancel){r.sent.cancel=true;persist(i);await i.socialSend('trcancel');}persist(i);return active?'team trade outcome: '+r.phase+'; waiting for owned session close':null;}
 if(screen.death||require('./room-policy').roomPolicy(require('./room-policy').currentRoom(i)).dungeon)return finish('CANCELLED','protected room or death');
 const existing=await i.socialLast('tropen');if(existing&&(existing.with?.name!==partner||existing._receivedAt<intent.startedAt)){const ended=await i.socialLast('trclosed'),completed=await i.socialLast('trdone'),receiptEnded=completed?.with===existing.with?.name&&completed._receivedAt>=existing._receivedAt;if(!sameSession(ended?.id,existing.id)&&!receiptEnded)return finish('CANCELLED','another trade owns the client; leave it untouched');}
 if(intent.phase==='GATHERING'){
  if(!i.lastSaveAt||Date.now()-i.lastSaveAt>30000)return 'trade gather: fresh save required';if(!refineMaterialBudget(i,intent))return finish('CANCELLED','Refinement material budget changed before gathering');await i.expeditionAuto(false);
  if(i.livePos?.room!=='town'){const home=await i.returnToTown();if(!home.ok)return 'trade gather: waiting for town';}
  if(!donor&&intent.offer.kind==='gear'&&(i.catalog().world.bagCap?.(i.lastSave.bagTier||0)||0)-(i.lastSave.bag||[]).length<2){const expanded=await require('./wing-inventory').prepare(i,{minimum:2});if(!expanded.ok)return finish('CANCELLED','receiver inventory cannot be safely expanded: '+expanded.reason);}
  if(Math.hypot((i.livePos?.x||0)-160,(i.livePos?.z||0)-7)>3)await i.walkTo(160,7,{timeoutMs:60000,tolerance:2});
  if(intent.offer.kind==='currency'){
   const b=require('../planning/team-copper').budget(i,{ownedTrade:true});
   if(!b||donor&&b.spare<intent.offer.quantity||!donor&&b.need<=0)return finish('CANCELLED','Copper need or protected donor budget changed before gathering');
   if(!r.baselineFlushAt){r.baselineFlushAt=Date.now();persist(i);await i.eval('(async()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.fixed||n.kicked)return false;n.handlers.resave();await n.flush();return true;})()');return 'trade Copper: flushing native wallet before session';}
   if(i.lastSaveAt<=r.baselineFlushAt)return 'trade Copper: waiting for fresh native wallet baseline';
  }
  r.before=quantity(i.lastSave,intent.offer);require('./trade-material-budget').capture(i,intent);return finish('READY');
 }
 const done=await frame('trdone'),closed=await frame('trclosed');if(closed&&sameSession(closed.id,r.sessionId))return finish('CANCELLED','server closed trade: '+closed.reason);
 if(done&&r.sent.confirm&&done._receivedAt>=r.confirmAt&&!receiptMatches(done,r,intent,name))return finish('UNCERTAIN','server receipt differs from registered partner and exact offers');
 if(receiptMatches(done,r,intent,name)){r.doneAt=done._receivedAt;r.receipt={id:done.id,rev:done.rev,at:done._receivedAt,validatedExactOffer:true,with:done.with,gave:done.gave,got:done.got};r.phase='VERIFYING';
  const proof=inventoryProof(i,r,intent);if(proof){r.after=proof.after;r.afterAt=proof.at;r.nativeInventoryProof=proof;persist(i);if(!donor&&intent.offer.kind==='gear'){const p=await i.planBag(i.roster);if(p.equip.length)await i.equipItems(p.equip);}return finish('CONFIRMED','server receipt and native accepted inventory delta match');}
  persist(i);return 'trade: waiting for both saves';
 }
 const open=await frame('tropen');if(open&&open.with?.name===partner&&(!r.sessionId||sameSession(r.sessionId,open.id)))r.sessionId=open.id;
 const state=await frame('trstate');
 if(intent.offer.kind==='currency'&&!r.sent.confirm){
  const pausedWallet=!!(r.sessionId&&sameSession(open?.id,r.sessionId)&&open.with?.name===partner&&sameSession(state?.id,r.sessionId)&&Date.now()-state._receivedAt>=0&&Date.now()-state._receivedAt<15000);
  const b=require('../planning/team-copper').budget(i,{ownedTrade:true,pausedWallet});
  if(!b||quantity(i.lastSave,intent.offer)!==r.before||donor&&b.spare<intent.offer.quantity||!donor&&b.need<=0){
   if(r.sessionId&&!r.sent.cancel){r.sent.cancel=true;persist(i);await i.socialSend('trcancel');}
   return finish('CANCELLED','Copper wallet or protected resources changed before confirmation');
  }
 }
 if(!r.sessionId){if(donor&&!r.sent.request){r.sent.request=true;persist(i);await i.eval(`(async()=>{await window.AsteriaNet.flush();window.AsteriaNet.social('trq',{name:${JSON.stringify(partner)}});return true;})()`);}
  if(!donor&&!r.sent.accept){const invite=await frame('trinv');if(invite?.name===partner&&Date.now()-invite._receivedAt<25000){r.sent.accept=true;persist(i);await i.eval(`(async()=>{await window.AsteriaNet.flush();window.AsteriaNet.social('trans',{from:${JSON.stringify(invite.from)},ok:true});return true;})()`);}}
  return 'trade waiting for registered partner';
 }
 if(!r.sent.confirm&&!refineMaterialBudget(i,intent)){if(r.sessionId&&!r.sent.cancel){r.sent.cancel=true;persist(i);await i.socialSend('trcancel');}return finish('CANCELLED','Refinement material demand or donor reserve changed');}
 if(!r.sent.offer){let gear=[],ids=[],stacks=[];if(donor&&intent.offer.kind==='gear'){const index=(i.lastSave.bag||[]).findIndex(x=>(typeof x==='string'?x:x.id)===intent.offer.id);if(index<0||rules.blockedGear(intent.offer.id,i.lastSave,i.catalog())){await i.socialSend('trcancel');return finish('CANCELLED','item moved or is not tradable');}gear=[index];ids=[intent.offer.id];}if(donor&&intent.offer.kind==='material')stacks=[[intent.offer.name,intent.offer.quantity]];
  r.sent.offer=true;r.offerAt=Date.now();persist(i);await i.socialSend('troffer',{sq:1,gear,ids,stacks,coins:donor&&intent.offer.kind==='currency'?intent.offer.quantity:0});return 'trade exact offer sent';}
 if(!state||!sameSession(state.id,r.sessionId)||state._receivedAt<Date.now()-15000)return 'trade waiting for fresh server offer';
 if(state.dropped?.length||!rules.exactOffer(state.me,intent.offer,donor)||!rules.exactOffer(state.them,intent.offer,!donor)){
  if(Date.now()-(r.offerAt||intent.startedAt)<20000&&!(state.dropped?.length))return 'trade waiting for counterpart offer';await i.socialSend('trcancel');return finish('CANCELLED','server offers changed or rejected items');}
 if(!state.me.locked&&!r.sent.lock){r.sent.lock=true;persist(i);await i.socialSend('trlock');return 'trade offer verified and locked';}
 if(state.me.locked&&state.them.locked&&!state.me.confirmed&&!r.sent.confirm){r.sent.confirm=true;r.confirmAt=Date.now();r.phase='CONFIRM_SENT';persist(i);await i.socialSend('trconfirm');return 'trade confirm sent; awaiting server receipt';}
 return 'trade waiting for matching receipt';
}
module.exports={observeNativeOutcome,TeamTrade,tick,refineMaterialBudget,quantity,protocolActive,cleanupPending,ownsSession,receiptMatches,inventoryProof,reconcileUnsentCancellation,noDispatch,blocksNavigation,releaseIdleNavigation,protocolLease,reconcileIdleHistory,reconcileClosedCancellation,recordedMaterialConfirmation,reconcileRecordedConfirmation,cancelUncommittedForSpace};
