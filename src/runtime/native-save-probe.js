'use strict';
// Invoke only the game's existing saver. Capture the exception type/location,
// never character contents, request bodies, tokens or arbitrary error messages.
const RESAVE=`(() => {const n=window.AsteriaNet;if(!n?.online||!n.isConnected?.()||n.fixed||n.kicked||n.pause||n.block||typeof n.handlers?.resave!=='function')return {requested:false};n.handlers.resave();return {requested:true};})()`;
function bounded(promise,timeoutMs){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('native save diagnostic timeout')),timeoutMs);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});}
async function probeNativeResave(instance,{timeoutMs=5000}={}){
 let client,enabled=false;const errors=[];
 let abandoned=false;
 try{
  try{const connecting=instance.ctx.newCDPSession(instance.page);Promise.resolve(connecting).then(late=>{if(abandoned)late.detach().catch(()=>{});},()=>{});client=await bounded(connecting,timeoutMs);await bounded(client.send('Debugger.enable'),timeoutMs);
   client.on('Debugger.paused',event=>{
    const frames=event.callFrames||[];
    if(frames.some(f=>f.functionName==='saveGame')){const d=String(event.data?.description||'');errors.push({type:/^([A-Za-z]*Error)\b/.exec(d)?.[1]||'Exception',frames:frames.slice(0,4).map(f=>({function:String(f.functionName||'anonymous').replace(/[^\w.$]/g,'').slice(0,80),line:(f.location?.lineNumber??-1)+1,column:(f.location?.columnNumber??-1)+1}))});}
    bounded(client.send('Debugger.resume'),timeoutMs).catch(()=>{});
   });
   await bounded(client.send('Debugger.setPauseOnExceptions',{state:'all'}),timeoutMs);enabled=true;
  }catch{}
  const result=await instance.eval(RESAVE);
  return {...result,revision:2,exceptionCaptureAvailable:enabled,errors:errors.slice(0,3),at:Date.now()};
 }finally{abandoned=true;if(client){try{await bounded(client.send('Debugger.setPauseOnExceptions',{state:'none'}),timeoutMs);}catch{}try{await bounded(client.detach(),timeoutMs);}catch{}}}
}
async function requestNativeResave(instance,{timeoutMs=5000}={}){
 // The native saver may lazily defer its PUT. Flush its existing single queue;
 // never send another save body or mark evidence fresh from this request.
 if(instance.nativeFreshSaveFlight)return {at:Date.now(),requested:false,reason:'native_saver_already_in_flight'};
 const pending=instance.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.online||!n.isConnected?.()||n.fixed||n.kicked||n.pause||n.block||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return {requested:false};n.handlers.resave();await n.flush();return {requested:true,flushed:true};})()`);
 instance.nativeFreshSaveFlight=pending;
 Promise.resolve(pending).finally(()=>{if(instance.nativeFreshSaveFlight===pending)instance.nativeFreshSaveFlight=null;}).catch(()=>{});
 const result=await bounded(pending,timeoutMs);return {at:Date.now(),requested:result?.requested===true,flushed:result?.flushed===true,evidence:'native_saver_requested_not_save_observed'};
}
module.exports={probeNativeResave,requestNativeResave};

// Read via the authenticated native API; do not resave a possibly stale body.
async function authoritativeReadback(instance,{timeoutMs=5000}={}){
 if(instance.nativeReadbackFlight||instance.nativeFreshSaveFlight)return null;
 const page=instance.page,actor=instance.actorIdentity?.actorId,session=instance.bagSessionStartedAt,generation=instance.socialInbox?.generation,at=Date.now();
 const pending=(async()=>{
  const requested=await instance.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.online||!n.isConnected?.()||n.fixed||n.kicked||n.pause||n.block||!n.account?.charId||typeof n.api!=='function'||typeof n.flush!=='function')return false;await n.flush();await n.api('/api/save');return true;})()`);
  if(!requested)return null;
  const until=Date.now()+2000;while(Date.now()<until){
   if(instance.page!==page||instance.actorIdentity?.actorId!==actor||instance.bagSessionStartedAt!==session||instance.socialInbox?.generation!==generation)return null;
   const r=instance.serverSaveReceipt,p=r?.proof;
   if(p?.authority==='server_readback'&&p.actorId===actor&&p.sessionStartedAt===session&&p.generation===generation&&p.requestAt>=at&&p.at>=p.requestAt)return r;
   await new Promise(resolve=>setTimeout(resolve,40));
  }return null;
 })();
 instance.nativeReadbackFlight=pending;Promise.resolve(pending).finally(()=>{if(instance.nativeReadbackFlight===pending)instance.nativeReadbackFlight=null;}).catch(()=>{});
 return bounded(pending,timeoutMs);
}
module.exports.authoritativeReadback=authoritativeReadback;
