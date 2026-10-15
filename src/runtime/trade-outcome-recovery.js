'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fresh=require('./freshness').fresh;
function recorded(r,name){
 const o=r?.offer,p=r?.nativeInventoryProof,c=r?.context;
 return [o?.donor,o?.receiver].includes(name)&&r?.phase==='CONFIRMED'&&r.sent?.confirm===true&&r.receipt?.id!=null&&Number.isSafeInteger(r.receipt.rev)&&p?.actorId===c?.actorId&&['server_accepted_save','server_readback'].includes(p.authority)&&Number.isSafeInteger(p.rev)&&p.rev>=r.receipt.rev&&Number.isFinite(p.at)&&p.at===r.afterAt&&r.afterAt>r.doneAt&&r.doneAt===r.receipt.at&&r.doneAt>=r.confirmAt&&r.confirmAt>=r.at&&Number.isSafeInteger(r.before)&&Number.isSafeInteger(o?.quantity)&&o.quantity>0&&r.after===r.before+(name===o.donor?-o.quantity:o.quantity)&&p.after===r.after&&r.before>=0&&r.after>=0&&(p.reconciledOriginalContext?JSON.stringify(p.reconciledOriginalContext)===JSON.stringify(c):p.generation===c.generation&&p.sessionStartedAt===c.sessionStartedAt&&p.build===c.build);

}
function eligible(i,r,now){
 const o=r?.offer,c=r?.context,actor=i.actorIdentity?.actorId;
 return !!o&&['material','currency','gear'].includes(o.kind)&&[o.donor,o.receiver].includes(i.character?.name)&&o.donor!==o.receiver&&Number.isSafeInteger(o.quantity)&&o.quantity>0&&/^actor-[a-f0-9]{32}$/.test(actor||'')&&c?.actorId===actor&&typeof c.build==='string'&&r.build===c.build&&i.registryV32?.store?.validateOwner(i.actorOwner)===true&&i.status==='playing'&&!i.recycling&&!i.survivalRecovery&&!i.activeResourceClaim&&!i.activeDevelopmentAttempt&&i.v2?.sourceCoherence?.matches===true&&require('./freshness').decisionGate(i,now).allowed&&i.tradeAvailability?.clear===true&&fresh(i.tradeAvailability.at,15000,now)&&fresh(i.lastSaveAt,30000,now)&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.v2?.trial?.active();
}
function proof(i,r,a,now=Date.now()){
 const p=a?.proof,o=r.offer;
 if(!p||p.authority!=='server_readback'||p.actorId!==r.context.actorId||p.actorId!==i.actorIdentity.actorId||p.build!==i.catalog().build||p.generation!==i.socialInbox?.generation||p.sessionStartedAt!==i.bagSessionStartedAt||!Number.isSafeInteger(p.rev)||p.rev<r.receipt.rev||p.requestAt<r.doneAt||p.requestAt<p.sessionStartedAt||p.at<p.requestAt||p.at-p.requestAt>30000||!fresh(p.at,30000,now))return null;
 if(!Number.isSafeInteger(r.before)||r.before<0||!Number.isSafeInteger(o.quantity)||o.quantity<1)return null;
 const expected=r.before+(i.character.name===o.donor?-o.quantity:o.quantity),after=require('./team-trade').quantity(a.state,o);
 if(!Number.isSafeInteger(expected)||expected<0||!Number.isSafeInteger(after)||after<0||after!==expected)return null;
 return {after,at:p.at,rev:p.rev,actorId:p.actorId,authority:p.authority,sessionStartedAt:p.sessionStartedAt,generation:p.generation,build:p.build,requestAt:p.requestAt,reconciledOriginalContext:{...r.context}};
}
function archive(i,r){
 if(r.readbackRecovery?.originalHash)return;
 const bytes=fs.readFileSync(i.tradeJournalFile),hash=crypto.createHash('sha256').update(bytes).digest('hex'),f=path.join(i.root,'logs/migration-originals/trades',hash+'.json');fs.mkdirSync(path.dirname(f),{recursive:true});
 if(!fs.existsSync(f))fs.writeFileSync(f,bytes);if(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==hash)throw Error('Original trade recovery archive changed');
 r.readbackRecovery={originalHash:hash,originalPhase:r.phase,originalContext:{...r.context},replayed:false};
}
async function reconcile(i,{persist,ownsSession},now=Date.now()){
 const r=i.tradeJournal;if(!r||!['VERIFYING','UNCERTAIN','CONFIRMED','CONFIRM_SENT','CANCELLED'].includes(r.phase)||!eligible(i,r,now))return false;
 if(recorded(r,i.character.name)){persist(i);return false;}
 if(i.tradeReadbackFlight||!i.canDo?.('recordedTradeReadback',30000)||await ownsSession(i))return false;
 const receipt=r.receipt,captured=receipt?.id!=null&&Number.isSafeInteger(receipt.rev)&&Number.isFinite(r.doneAt)&&r.doneAt===receipt.at&&Number.isFinite(r.confirmAt)&&r.confirmAt>=r.at&&r.doneAt>=r.confirmAt&&r.sent?.confirm===true;
 if(!captured&&!(Number.isFinite(r.deadline)&&now>r.deadline))return false;
 i.tradeReadbackFlight=true;
 try{
  const a=await require('./isolated-storage').readback(i);if(!eligible(i,r,Date.now())||await ownsSession(i))return false;
  const p=captured?proof(i,r,a):null;archive(i,r);
  r.readbackRecovery={...r.readbackRecovery,at:Date.now(),currentProof:a?.proof||null,replayed:false,historicalSuccessKnown:!!p};
  if(p){r.after=p.after;r.afterAt=p.at;r.nativeInventoryProof=p;r.phase='CONFIRMED';r.reason='Original native receipt and exact current server inventory delta; no command resent';persist(i);return true;}
  const q=a?.proof;
  if(q?.authority!=='server_readback'||q.actorId!==r.context.actorId||q.sessionStartedAt!==i.bagSessionStartedAt||q.generation!==i.socialInbox?.generation||q.build!==i.catalog().build||!fresh(q.at,30000)||q.requestAt<Math.max(r.doneAt||0,r.deadline||0))return false;
  r.phase='UNCERTAIN';r.idleNavigationEvidence={at:q.at,saveAt:i.lastSaveAt,kind:'fresh_native_idle_after_closed_outcome_readback',outcome:'unknown',replayBlocked:true,serverReadback:q,originalConfirmationSent:!!r.sent?.confirm};persist(i);return false;
 }catch{i.tradeReadbackRecovery={at:Date.now(),state:'unknown_preserved',replayed:false};return false;}finally{i.tradeReadbackFlight=false;}
}
async function history(i,helpers,now=Date.now()){
 const rows=(i.teamTradeIntent?.quarantined||[]).filter(q=>q.resolution==='unresolved_no_replay'&&[q.offer?.donor,q.offer?.receiver].includes(i.character?.name)&&/^[a-zA-Z0-9-]{1,80}$/.test(q.id)).slice(0,16);
 if(!rows.length||i.tradeHistoryFlight||i.teamTradeIntent?.phase==='SESSION')return false;
 i.tradeHistoryFlight=true;
 try{for(const q of rows){
  const name=crypto.createHash('sha256').update(i.character.name).digest('hex').slice(0,24),file=path.join(i.root,'logs/trades',name,q.id+'.json');let r;try{r=JSON.parse(fs.readFileSync(file));}catch{continue;}
  if(!r.offer||r.offer.donor!==q.offer.donor||r.offer.receiver!==q.offer.receiver||r.offer.kind!==q.offer.kind||r.offer.name!==q.offer.name||r.offer.quantity!==q.offer.quantity)continue;
  const actor=Object.assign(Object.create(i),{tradeJournal:r,tradeJournalFile:file,tradeJournalLatest:null,canDo:i.canDo?.bind(i)});
  await require('./team-trade').observeNativeOutcome(actor,helpers.persist);
  await reconcile(actor,helpers,now);
  if(actor.teamTradeStatus)updateRecoveredStatus(i,actor.teamTradeStatus);
 }
 }finally{i.tradeHistoryFlight=false;}return true;
}
function updateRecoveredStatus(i,status){
 // Keep presentation snapshots flat. Original journals retain full evidence;
 // copying previous recovered snapshots here would grow a recursive tree.
 const leaf=({recoveredOutcomes,...row})=>row;
 i.tradeRecoveredOutcomes=[leaf(status),...(i.tradeRecoveredOutcomes||[]).filter(r=>r.id!==status.id).map(leaf)].slice(0,16);
 i.teamTradeStatus={...i.teamTradeStatus,recoveredOutcomes:i.tradeRecoveredOutcomes};
}
function discoverMixed(root,host,members,known,now=Date.now()){
 const names=require('../planning/host-team-scope').team(root,host)?.members.map(m=>m.charName)||[],pairs=new Map();
 for(const m of members.filter(m=>m.machine===host&&names.includes(m.charName))){
  const dir=path.join(root,'logs/trades',crypto.createHash('sha256').update(m.charName).digest('hex').slice(0,24));let files;try{files=fs.readdirSync(dir);}catch{continue;}
  for(const f of files){if(!/^[a-f0-9-]{36}\.json$/.test(f))continue;let r;try{r=JSON.parse(fs.readFileSync(path.join(dir,f)));}catch{continue;}
   if(known.has(r.id)||!r.offer||r.context?.actorId!==m.identity?.actorId||r.offer.donor===r.offer.receiver||![r.offer.donor,r.offer.receiver].every(n=>names.includes(n))||!Number.isFinite(r.deadline)||now<r.deadline)continue;
   const pair=pairs.get(r.id)||[];pair.push({name:m.charName,row:r});pairs.set(r.id,pair);
  }
 }
 const found=[];
 for(const [id,pair]of pairs){if(pair.length!==2||pair[0].name===pair[1].name)continue;const a=pair[0].row,b=pair[1].row;
  if(JSON.stringify(a.offer)!==JSON.stringify(b.offer)||!pair.some(x=>x.row.sent?.confirm)&&!pair.some(x=>x.row.phase==='UNCERTAIN')||!pair.some(x=>x.row.phase==='CANCELLED')||pair.every(x=>x.row.phase==='CANCELLED'&&x.row.nativeCloseEvidence))continue;
  const hash=require('./material-budget-recovery').preserve(root,{version:1,kind:'mixed_trade_history',original:pair,replayBlocked:true});
  found.push({id,offer:a.offer,build:a.build,phase:'UNCERTAIN',at:now,startedAt:Math.min(a.at,b.at),deadline:Math.max(a.deadline,b.deadline),finishedAt:now,quarantinedAt:now,resolution:'unresolved_no_replay',reason:'Original mixed terminal actor journals require both-side reconciliation',originalSha256:hash,replayBlocked:true});
 }
 return found;
}
module.exports={discoverMixed,archive,recorded,eligible,proof,reconcile,history,updateRecoveredStatus};
