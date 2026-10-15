'use strict';
// Append-only evidence for a NEW refinement intent. Never settle or rewrite an
// old journal row, and never infer a missing historical before-level or cost.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function preserve(i,rows){
 const dir=path.join(i.root,'logs/refine-history-originals');fs.mkdirSync(dir,{recursive:true});
 return rows.map(row=>{
  const original=(i.developmentLedger?.rows||[]).find(r=>'development:'+r.id===row.id&&r.at===row.at&&r.kind===row.kind&&r.target?.id===row.target?.id)||null;
  const bytes=Buffer.from(JSON.stringify({version:1,actorId:i.actorIdentity.actorId,journal:row,ledger:original,replayBlocked:true,historicalSuccessKnown:false,historicalCostKnown:false})),hash=sha(bytes),file=path.join(dir,hash+'.json');
  let fd;try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
  if(!fs.readFileSync(file).equals(bytes))throw Error('Immutable refinement history archive differs');
  return {sha256:hash,transactionId:row.id,originalTransactionId:row.id.replace(/^development:/,''),replayBlocked:true,ledgerOriginalAvailable:!!original};
 });
}
function verified(i,e){
 try{
  if(!Array.isArray(e.historyArchives)||e.historyArchives.length!==e.historyTransactionIds?.length)return false;
  return e.historyArchives.every((a,n)=>{
   if(!/^[a-f0-9]{64}$/.test(a.sha256)||a.transactionId!==e.historyTransactionIds[n]||a.replayBlocked!==true)return false;
   const bytes=fs.readFileSync(path.join(i.root,'logs/refine-history-originals',a.sha256+'.json')),r=JSON.parse(bytes);
   return sha(bytes)===a.sha256&&r.actorId===i.actorIdentity.actorId&&r.replayBlocked===true&&r.journal.id===a.transactionId&&r.journal.target?.id===e.targetId&&e.originalTransactionIds.includes(a.transactionId)&&e.originalTransactionIds.includes(a.originalTransactionId);
  });
 }catch{return false;}
}
module.exports={preserve,verified};
