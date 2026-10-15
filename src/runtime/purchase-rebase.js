'use strict';
// Reconcile CURRENT budgets, never the historical outcome of a missing purchase.
// The original row and claims are archived before any state transition.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fresh}=require('./freshness'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pending=new Set(['INTENT','SENT','OBSERVED','UNCERTAIN','STARTED','WAITING_CONFIRMATION','pending','unresolved','change_observed','spent_without_change']);
function descriptor(row){
 const c=row?.context||row?.target?.context,actor=row?.actorId||c?.actorId;
 if(!row||row.legacyIdentityUnknown||!pending.has(row.status)||!c||c.actorId!==actor||!/^actor-[a-f0-9]{32}$/.test(actor||''))return null;
 let item,price;
 if(row.kind==='refine:supply'){const s=row.target?.supply;if(!['guardian','star'].includes(s?.kind)||!['materials','consumables'].includes(s.group))return null;item=s.name;price=s.price;if(row.bill?.Copper!==price||Object.keys(row.bill).some(k=>k!=='Copper'))return null;}
 else if(['purchase','shop-purchase','market-purchase','market-buy','market-class'].includes(row.kind)){
  if(row.externalOwner&&!['class-market'].includes(row.externalOwner))return null;
  item=row.target?.item;price=row.expectedCoins??row.target?.price??row.bill?.Copper;
  if(row.bill&&Object.keys(row.bill).some(k=>k!=='Copper'))return null;
 }else return null;
 const baselineRev=c.baselineRev??c.rev,before=row.before||row.target?.before;
 if(typeof row.id!=='string'||!row.id||typeof item!=='string'||!item||item.length>160||!Number.isSafeInteger(price)||price<1||!Number.isSafeInteger(before?.coins)||before.coins<0||!Number.isSafeInteger(baselineRev)||baselineRev<0||!Number.isFinite(c.sessionStartedAt)||!Number.isSafeInteger(c.generation)||!c.build||!Number.isFinite(row.at)||row.at<c.sessionStartedAt)return null;
 return {actorId:actor,build:c.build,sessionStartedAt:c.sessionStartedAt,generation:c.generation,baselineRev,item,price};
}
function rows(i){
 const out=[],actor=i.actorIdentity?.actorId;
 if(actor)for(const row of i.registryV32?.store?.pending(actor)||[])if(descriptor(row))out.push({source:'durable',row});
 for(const [source,ledger]of [['journal',i.v2?.journal],['development',i.developmentLedger],['equipment',i.equipmentLedger]])for(const row of ledger?.rows||[])if(descriptor(row))out.push({source,row,ledger});
 return out;
}
function idle(i,now=Date.now(),owned=false){
 const a=i.v2?.scheduler?.active,context=i.v2?.scheduler?.context?.getStore?.(),job=context?.job||context;
 if(!['tum','vps'].includes(i.machine)||i.actorOwner?.host!==i.machine||i.actorIdentity?.assignment?.host!==i.machine||i.autoChores!==true||i.status!=='playing'||i.recycling||i.stopped||i.stopRequested||i.v2?.scheduler?.closed||i.registryV32?.store?.validateOwner(i.actorOwner)!==true)return false;
 if(!fresh(i.lastSaveAt,30000,now)||!fresh(i.livePos?.at,10000,now)||!fresh(i.vitals?.at,15000,now)||i.vitals.hp<.85||i.livePos.dead||i.v2?.sourceCoherence?.matches!==true)return false;
 if(i.tickBusy||i.choresBusy||i.fleetActivityBusy||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||i.healthRecovery||i.survivalRecovery||i.activeResourceClaim||i.activeDevelopmentAttempt||i.v2?.trial?.active()||i.pvpMission||/^(tw|dx|gd|pv)/.test(i.livePos.room)||require('./team-trade').blocksNavigation(i))return false;
 if(!i.v2?.scheduler||a&&!(owned&&a.kind==='purchase-outcome-recovery'&&job===a)||i.v2.scheduler.queue?.length||i.nativeFreshSaveFlight||i.paidReadbackFlight||i.promotionMarketQuery)return false;
 if(Object.values(i.activityState||{}).some(s=>s?.run&&!s.run.done)||Object.values(require('../planning/fleet-activity').publicActivity(i)).some(s=>s?.run&&!s.run.done))return false;
 return true;
}
function inspect(i,now=Date.now(),owned=false){
 const candidates=rows(i).filter(r=>now-r.row.at>=600000);
 if(!candidates.length)return {state:'idle'};
 if(!idle(i,now,owned))return {state:'waiting',reason:'fresh idle owned actor with no in-flight dispatcher required'};
 // A recent paid operation may still await a dispatcher/reply. Historical
 // closed entries keep their own holds and UUID fences, without owning a probe.
 const all=[...(i.registryV32?.store?.pending(i.actorIdentity.actorId)||[]),...(i.v2?.journal?.rows||[])];
 if(all.some(r=>pending.has(r.status)&&(!Number.isFinite(r.at)||now-r.at<600000)&&!candidates.some(c=>c.row===r||c.source==='durable'&&c.row.id===r.id)&&!require('./closed-gear-scope').history(i,r,now)))return {state:'waiting',reason:'another native payment remains active or unclassified'};
 return {state:'recoverable',count:candidates.length,transactionIds:candidates.map(c=>c.row.id)};
}
function archive(i,entry,claims){
 const row=entry.row,dir=path.join(i.root,'logs/purchase-quarantine',i.actorIdentity.actorId),file=path.join(dir,sha(Buffer.from(entry.source+'|'+row.id))+'.json');
 fs.mkdirSync(dir,{recursive:true});const original=JSON.stringify(row),payload={version:1,source:entry.source,actorId:i.actorIdentity.actorId,transactionId:row.id,originalSha256:sha(Buffer.from(original)),original:row,claims,replayBlocked:true,historicalOutcome:'UNKNOWN'};
 const bytes=Buffer.from(JSON.stringify(payload));
 try{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const fdDir=process.platform==='win32'?null:fs.openSync(dir,'r');if(fdDir!==null){try{fs.fsyncSync(fdDir);}finally{fs.closeSync(fdDir);}}}catch(e){if(e.code!=='EEXIST')throw e;}
 const frozen=fs.readFileSync(file),saved=JSON.parse(frozen);if(saved.originalSha256!==payload.originalSha256||JSON.stringify(saved.claims)!==JSON.stringify(claims)||saved.transactionId!==row.id||saved.replayBlocked!==true)throw Error('Immutable purchase original differs; preserve fence');
 return {file:path.relative(i.root,file).replace(/\\/g,'/'),sha256:sha(frozen),originalSha256:payload.originalSha256};
}
function currentMatches(i,receipt){return require('./isolated-storage').equal(require('../result-ledger').snapshot(receipt.state),require('../result-ledger').snapshot(i.lastSave));}
function closedSession(row,receipt){return Number.isFinite(row?.at)&&Number.isFinite(receipt?.proof?.sessionStartedAt)&&receipt.proof.sessionStartedAt-row.at>=60000;}
function rebase(i,entry,receipt,closure,now=Date.now()){
 if(!idle(i,now,true)||!currentMatches(i,receipt)&&!closedSession(entry.row,receipt))return false;
 const row=entry.row,d=descriptor(row);if(!d||d.actorId!==i.actorIdentity.actorId)return false;
 const currentClosure={...closure,currentActorId:i.actorIdentity.actorId,currentBuild:i.catalog().build,currentSessionStartedAt:i.bagSessionStartedAt,currentGeneration:i.socialInbox?.generation};
 const patch=d.build===receipt.proof?.build?require('../result-ledger').ResultLedger.rebasePurchase(row,receipt.state,receipt.proof,currentClosure,now):require('./closed-purchase-budget').validate(row,receipt.state,receipt.proof,currentClosure,now);
 if(!patch)return false;
 patch.reconciliation.currentClientProjectionMatched=currentMatches(i,receipt);
 patch.reconciliation.closedNativeSession=closedSession(row,receipt);
 if(entry.source==='durable'){
  const store=i.registryV32.store;
  return store.transaction(()=>{
   const original=store.get(row.id);if(!original||JSON.stringify(original)!==JSON.stringify(row)||!pending.has(original.status)||!store.validateOwner(i.actorOwner))return false;
   const owner=store.db.prepare('SELECT session FROM owners WHERE actor=?').get(d.actorId);if(owner?.session!==i.actorOwner.session)return false;
   const claims=store.db.prepare('SELECT * FROM claims WHERE intent=? ORDER BY id').all(row.id);if(claims.some(c=>c.actor!==d.actorId||!['HELD','UNCERTAIN'].includes(c.status)))return false;
   const frozen=archive(i,entry,claims);store.write({...original,...patch,quarantine:frozen});
   // RECONCILED means current budgets rebased, never a receipt or success.
   store.db.prepare("UPDATE claims SET status='RECONCILED' WHERE intent=? AND actor=? AND status IN ('HELD','UNCERTAIN')").run(row.id,d.actorId);return true;
  });
 }
 const claims=(i.v2?.reservations?.data.claims||[]).filter(c=>c.transactionId===row.id||c.id===row.claimId||c.id===row.id);
 if(claims.some(c=>!['UNCERTAIN','STARTED'].includes(c.status)))return false;
 const frozen=archive(i,entry,claims),documents=[entry.ledger.document,...(claims.length?[i.v2.reservations.document]:[])];
 // Canonical purchase/claim documents commit together. File mirrors are not
 // authority if a process closes before the SQLite transaction commits.
 if(documents.some(d=>!d||d.store!==i.registryV32.store))return false;
 return i.registryV32.store.transaction(()=>{Object.assign(row,patch,{quarantine:frozen});entry.ledger.save();for(const claim of claims)i.v2.reservations.finish(claim.id,'RECONCILED');return true;});
}
async function tick(i){
 const now=Date.now(),view=inspect(i,now);i.purchaseOutcomeRecovery=view;
 if(view.state!=='recoverable'||i.purchaseRecoveryFlight||now-(i.purchaseRecoveryAt||0)<10000)return null;
 i.purchaseRecoveryAt=now;i.purchaseRecoveryFlight=true;
 const actionContract=require('./action-contract').contract(i,'recycle',{recovery:true});
 try{return await i.v2.scheduler.run('purchase-outcome-recovery',async()=>{
  if(inspect(i,Date.now(),true).state!=='recoverable')return null;
  const closure={kind:'fresh_idle_executor_before_native_probe',at:Date.now(),schedulerIdle:true,noInFlightPayment:true,ownerSession:i.actorOwner.session,ownerGeneration:i.actorOwner.generation};
  let receipt=await require('./native-save-probe').authoritativeReadback(i);
  if(!receipt||!idle(i,Date.now(),true)){i.purchaseOutcomeRecovery={state:'waiting',reason:'fresh authoritative native probe incomplete',replayBlocked:true};return null;}
  if(!currentMatches(i,receipt)&&!rows(i).filter(e=>Date.now()-e.row.at>=600000).every(e=>closedSession(e.row,receipt))){
   // A probe never overwrites a divergent client. Close only this actor once.
   const entries=rows(i).filter(e=>Date.now()-e.row.at>=600000),dir=path.join(i.root,'logs/purchase-quarantine',i.actorIdentity.actorId),attempts=entries.map(e=>path.join(dir,sha(Buffer.from('recycle|'+e.source+'|'+e.row.id))+'.json'));
   if(typeof i.recycle!=='function'||attempts.some(f=>fs.existsSync(f)))return null;
   fs.mkdirSync(dir,{recursive:true});for(let n=0;n<attempts.length;n++){const fd=fs.openSync(attempts[n],'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({version:1,id:entries[n].row.id,actorId:i.actorIdentity.actorId,at:Date.now(),sessionStartedAt:i.bagSessionStartedAt,generation:i.socialInbox.generation,replayBlocked:true,recycleDispatchedOnce:true,closure}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
   i.purchaseRecycleAttempted=true;i.purchaseOutcomeRecovery={state:'awaiting_native_reconciliation',replayed:false,reason:'current native/client state differs; single actor recycle'};
   actionContract.beginRecovery();
   await i.recycle('rebase stale purchase from native server; never resend UUID');return 'purchase executor closed; native rebase pending';
  }
  let count=0;for(const entry of rows(i).filter(c=>Date.now()-c.row.at>=600000))if(rebase(i,entry,receipt,closure))count++;
  i.purchaseOutcomeRecovery={state:count?'RECONCILED':'waiting',at:Date.now(),count,replayBlocked:true,historicalSuccessKnown:false,historicalCostKnown:false,rev:receipt.proof.rev};
  return count?'stale purchase budget rebased; original UUID quarantined without replay':null;
 },{priority:0,leaseMs:30000,contract:actionContract});}catch(e){i.purchaseOutcomeRecovery={state:'waiting',reason:'native purchase reconciliation incomplete; no replay',errorCode:e.code||e.name,replayBlocked:true};return null;}finally{i.purchaseRecoveryFlight=false;}
}
module.exports={descriptor,rows,idle,inspect,archive,rebase,tick,closedSession};
