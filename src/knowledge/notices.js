'use strict';
const crypto=require('node:crypto');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function reconcile(previous,result,{at=Date.now(),realm='asteria-online.io',channel='public_client',build=null}={}){
 const old=previous||{notes:[],revision:null};
 if(result.status!=='parsed'||result.coverage?.complete!==true)return {...old,lastAttemptAt:at,status:'unavailable',fresh:false,coverage:result.coverage||{complete:false},errors:result.errors||[],lastGoodAt:old.lastGoodAt||null};
 const byId=new Map((old.notes||[]).map(n=>[n.id,n]));
 const notes=result.notes.map(note=>{
  const hash=digest(note),prior=byId.get(note.id),runtimeGate=note.when?.kind==='runtime_visibility_gate';
  return {id:note.id,contentHash:hash,revision:hash,content:note,realm,channel,build,
   visibility:runtimeGate?'runtime_gate_unknown':'authored_public',gate:runtimeGate?note.when:null,
   availability:'announced_not_runtime_verified',firstObservedAt:prior?.firstObservedAt||at,
   changedAt:prior?.contentHash===hash?prior.changedAt:at,observedAt:at,
   publishedDate:typeof note.date==='string'?note.date:null,effectiveAt:null,expiresAt:null};
 });
 const ids=new Set(notes.map(n=>n.id));
 const changes=notes.filter(n=>byId.get(n.id)?.contentHash!==n.contentHash).map(n=>({id:n.id,kind:byId.has(n.id)?'edited':'added',revision:n.contentHash}));
 const removed=(old.notes||[]).filter(n=>!ids.has(n.id)).map(n=>({id:n.id,kind:'removed_from_complete_source',previousRevision:n.contentHash,at}));
 return {version:1,status:'available',fresh:true,at,lastAttemptAt:at,lastGoodAt:at,realm,channel,build,
  revision:digest(notes.map(n=>[n.id,n.contentHash])),coverage:result.coverage,notes,changes:[...changes,...removed],
  retractions:[...(old.retractions||[]),...removed].slice(-1000),errors:[],runtimeVisibilityVerified:false};
}
function summary(book){if(!book)return null;return {version:1,status:book.status,revision:book.revision,lastGoodAt:book.lastGoodAt,lastAttemptAt:book.lastAttemptAt,fresh:book.fresh,coverage:book.coverage,realm:book.realm,channel:book.channel,build:book.build,noteCount:book.notes?.length||0,changeCount:book.changes?.length||0,changes:(book.changes||[]).slice(0,12),omittedChanges:Math.max(0,(book.changes?.length||0)-12),errors:book.errors,runtimeVisibilityVerified:false};}
module.exports={reconcile,summary};
