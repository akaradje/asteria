'use strict';
// Native network.js: HTTP success advances X-Rev; `ok` is not required.
// A corrected save is not proof of the submitted state or its paid effects.
// HTTP startup load precedes the first socket. Generation zero identifies that
// page's pre-socket phase; binding/reconnecting still invalidates old requests.
const generation=i=>i.socialInbox?.generation??0;
function context(i,headers,at=Date.now()){
 const nativeId=String(i.character?.id??'');
 if(!nativeId||String(headers['x-char']??'')!==nativeId||!i.actorIdentity?.actorId)return null;
 return {at,nativeId,actorId:i.actorIdentity.actorId,sessionStartedAt:i.bagSessionStartedAt,generation:generation(i),build:i.cache?.dir?require('node:path').basename(i.cache.dir):i.buildHash};
}
function current(i,request,at){return !!request&&at>=request.at&&request.nativeId===String(i.character?.id??'')&&request.actorId===i.actorIdentity?.actorId&&request.sessionStartedAt===i.bagSessionStartedAt&&request.generation===generation(i)&&request.build===(i.cache?.dir?require('node:path').basename(i.cache.dir):i.buildHash);}
function readback(i,request,body,at=Date.now()){
 if(!current(i,request,at)||!body||body.ok===false||body.error||!Number.isSafeInteger(body.rev)||body.rev<0||!body.save||typeof body.save!=='object'||Array.isArray(body.save)||!Number.isSafeInteger(body.save.lv)||body.save.lv<1||typeof body.save.job!=='string')return null;
 return {authority:'server_readback',at,rev:body.rev,requestAt:request.at,actorId:request.actorId,nativeId:request.nativeId,sessionStartedAt:request.sessionStartedAt,generation:request.generation,build:request.build,serverAt:Number.isFinite(body.now)?body.now:null};
}
function capture(i,state,headers,at=Date.now()){
 const rev=Number(headers['x-rev']),nativeId=String(i.character?.id??'');
 if(!nativeId||String(headers['x-char']??'')!==nativeId||headers['x-save']!=='2'||!Number.isSafeInteger(rev)||rev<0||!i.actorIdentity?.actorId)return null;
 return {state,sentRev:rev,...context(i,headers,at)};
}
function accepted(i,request,body,at=Date.now()){
 if(!request||!body||body.ok===false||body.fixed||body.stale||body.error||!Number.isSafeInteger(body.rev)||body.rev<=request.sentRev||at<request.at)return null;
 if(!current(i,request,at))return null;
 return {authority:'server_accepted_save',at,rev:body.rev,requestAt:request.at,actorId:request.actorId,sessionStartedAt:request.sessionStartedAt,generation:request.generation,build:request.build};
}
module.exports={capture,accepted,context,readback};
