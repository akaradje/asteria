'use strict';
const fs=require('node:fs'),path=require('node:path');
const uuid=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
function file(i,id){if(!uuid(id)||!/^actor-[a-f0-9]{32}$/.test(i.actorIdentity?.actorId||''))throw Error('Invalid reserve identity');return path.join(i.root,'logs/material-reserve-rebases',i.actorIdentity.actorId,id+'.json');}
function blocked(i,id){if(!id||!i.root||!uuid(id)||!/^actor-[a-f0-9]{32}$/.test(i.actorIdentity?.actorId||''))return false;try{return fs.existsSync(file(i,id));}catch{return true;}}
function verified(i){
 const recovery=require('./material-budget-recovery');
 for(const r of i.v2?.reservations?.data?.claims||[])if(r.status==='RECONCILED'&&r.reconciliation?.blockedIds){
  const hash=r.reconciliation.originalSha256,o=recovery.original(i.root,hash);if(!o||o.actorId!==i.actorIdentity?.actorId||o.original?.id!==r.id)return false;
  for(const id of r.reconciliation.blockedIds)try{const fence=JSON.parse(fs.readFileSync(file(i,id)));if(fence.id!==id||fence.originalSha256!==hash||fence.replayBlocked!==true)return false;}catch{return false;}
 }
 return true;
}
function mark(i,id,hash){
 const f=file(i,id),value={id,actorId:i.actorIdentity.actorId,originalSha256:hash,replayBlocked:true,historicalSuccessKnown:false,historicalCostKnown:false};
 fs.mkdirSync(path.dirname(f),{recursive:true});let fd;
 try{fd=fs.openSync(f,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
 const saved=JSON.parse(fs.readFileSync(f));if(saved.id!==id||saved.actorId!==value.actorId||saved.originalSha256!==hash||saved.replayBlocked!==true)throw Error('Reserve replay fence differs');
}
function recover(i,now=Date.now()){
 const recovery=require('./material-budget-recovery');if(!['tum','vps'].includes(i.machine)||!recovery.gate(i,now))return 0;
 const v=i.v2.reservations,p=i.serverSaveReceipt.proof,cat=i.catalog();if(!v||!i.credentials?.username)return 0;
 const sha=require('node:crypto').createHash('sha256').update(String(i.credentials.username)).digest('hex').slice(0,24);
 if(path.resolve(v.file)!==path.resolve(i.root,'logs/reservations',sha+'.json'))return 0;
 let count=0;
 for(const r of v.data.claims){
  if(r.status!=='UNCERTAIN'||!uuid(r.id)||!recovery.closed(r.at,r.deadline,p,now)||!r.cost||!Number.isSafeInteger(r.cost.Copper)||r.cost.Copper<=0)continue;
  const ores=Object.keys(r.cost).filter(k=>k!=='Copper');
  if(!ores.length||ores.some(k=>!cat.world?.REFINE?.ORES?.includes(k))||Object.values(r.cost).some(n=>!Number.isSafeInteger(n)||n<=0))continue;
  const ids=[r.id,...(r.transactionId?[r.transactionId]:[])];if(ids.some(id=>!uuid(id)))continue;
  const evidence=[...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[]),...(i.v2.journal?.rows||[])].filter(x=>ids.includes(x.id)||ids.some(id=>x.id==='development:'+id));
  // No guessing targets from a bill or nearby timestamps. Linked records must
  // identify this actor and a closed refinement, even when ledger was truncated.
  const journalOwned=!!i.v2.journal?.file&&path.resolve(i.v2.journal.file)===path.resolve(i.root,'logs/actions',sha.slice(0,16)+'.json');
  const identified=x=>x.context?.actorId===i.actorIdentity.actorId||!x.context&&journalOwned&&i.v2.journal.rows.includes(x)&&x.externalOwner==='development-ledger'&&x.id==='development:'+r.transactionId;
  if(r.transactionId&&!evidence.length||evidence.some(x=>x.kind!=='refine'||x.legacyIdentityUnknown||!identified(x)||!Number.isFinite(x.at)||x.at>=p.sessionStartedAt||now-x.at<600000))continue;
  if(!r.transactionId&&r.dispatchTracking)continue;
  let hash;const existing=ids.map(id=>{try{return JSON.parse(fs.readFileSync(file(i,id)))}catch(e){if(e.code==='ENOENT')return null;throw e}}).filter(Boolean);
  if(existing.length){hash=existing[0].originalSha256;const saved=recovery.original(i.root,hash);if(!saved||existing.some(x=>x.originalSha256!==hash)||JSON.stringify(saved.original)!==JSON.stringify(r))throw Error('Reserve archive missing or changed');}
  else hash=recovery.preserve(i.root,{version:1,kind:'closed_legacy_ore_budget',actorId:i.actorIdentity.actorId,host:i.machine,original:JSON.parse(JSON.stringify(r)),linkedEvidence:evidence,replayBlocked:true});
  for(const id of ids)mark(i,id,hash); // permanent fences precede releasing budget
  r.reconciliation={...recovery.certificate(i,r.at,r.deadline,hash,now),blockedIds:ids,currentStateOnly:true};r.replayBlocked=true;r.status='RECONCILED';v.save();count++;
 }
 return count;
}
module.exports={recover,blocked,verified};
