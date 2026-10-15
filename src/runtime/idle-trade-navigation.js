'use strict';
// Renew observation of a closed, never-confirmed history BEFORE the controller
// tests ownership. No trade command, cost/outcome rebase or UUID replay occurs.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function refresh(i,now=Date.now()){
 const t=i.teamTradeStatus,f=require('./freshness');
 if(t?.phase!=='UNCERTAIN'||!t.navigationReleased||t.confirmationSent||t.receiptId!=null||i.status!=='playing'||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.choresBusy||i.recycling||i.healthRecovery||i.activeResourceClaim||i.activeDevelopmentAttempt||(i.developmentLedger?.rows||[]).some(r=>r.status==='pending')||i.v2?.trial?.active()||i.v2?.sourceCoherence?.matches!==true||!f.decisionGate(i,now).allowed||!f.fresh(i.tradeAvailability?.at,15000,now)||!i.tradeAvailability.clear||!i.registryV32?.store?.validateOwner(i.actorOwner)||require('./room-policy').roomPolicy(i.livePos?.room).dungeon)return false;
 if(!/^[a-f0-9-]{36}$/.test(t.id||''))return false;
 try{
  const base=path.join(i.root,'logs/trades',sha(Buffer.from(i.character.name)).slice(0,24)),file=path.join(base,t.id+'.json'),r=i.tradeJournal?.id===t.id?i.tradeJournal:JSON.parse(fs.readFileSync(file)),h=r.readbackRecovery?.originalHash;
  if(r.id!==t.id||r.phase!=='UNCERTAIN'||r.sent?.confirm||r.receipt||r.context?.actorId!==i.actorIdentity?.actorId||!Number.isFinite(r.deadline)||now-r.deadline<60000||now-r.at<600000||!r.offer||![r.offer.donor,r.offer.receiver].includes(i.character.name)||!/^[a-f0-9]{64}$/.test(h||'')||r.readbackRecovery.replayed!==false)return false;
  const archive=path.join(i.root,'logs/migration-originals/trades',h+'.json');if(fs.lstatSync(archive).isSymbolicLink()||fs.lstatSync(file).isSymbolicLink())return false;
  const b=fs.readFileSync(archive),o=JSON.parse(b);if(sha(b)!==h||o.id!==r.id||o.receipt||o.sent?.confirm||JSON.stringify(o.context)!==JSON.stringify(r.context)||JSON.stringify(o.sent)!==JSON.stringify(r.sent)||JSON.stringify(o.offer)!==JSON.stringify(r.offer))return false;
  if(!i.tradeJournal){i.tradeJournal=r;i.tradeJournalFile=file;i.tradeJournalLatest=base+'.json';}
  return await require('./team-trade').releaseIdleNavigation(i,{id:r.id,deadline:r.deadline},now);
 }catch{return false;}
}
module.exports={refresh};
