'use strict';
const assert=require('assert/strict'),vm=require('node:vm'),{EventEmitter}=require('events'),{probeNativeResave,requestNativeResave}=require('../src/runtime/native-save-probe');
(async()=>{
 const client=new EventEmitter(),commands=[];let detached=false;
 client.send=async(method,params)=>{commands.push({method,params});};client.detach=async()=>{detached=true;};
 const i={lastSaveAt:123,page:{},ctx:{newCDPSession:async()=>client},eval:async()=>{client.emit('Debugger.paused',{data:{description:'TypeError: sensitive fixture value'},callFrames:[{functionName:'saveGame',location:{lineNumber:8,columnNumber:3}}]});return {requested:true};}};
 const r=await probeNativeResave(i);assert(r.exceptionCaptureAvailable);assert.equal(r.errors[0].type,'TypeError');assert.equal(r.errors[0].frames[0].line,9);assert(!JSON.stringify(r).includes('sensitive'));assert.equal(i.lastSaveAt,123);assert(detached);assert(commands.some(c=>c.method==='Debugger.resume'));assert.deepEqual(commands.at(-1),{method:'Debugger.setPauseOnExceptions',params:{state:'none'}});
 i.eval=async()=>{throw Error('evaluate timeout');};await assert.rejects(probeNativeResave(i),/timeout/);assert(detached);
 i.ctx.newCDPSession=async()=>{throw Error('not supported');};i.eval=async()=>({requested:false});const unavailable=await probeNativeResave(i);assert.equal(unavailable.exceptionCaptureAvailable,false);assert.equal(unavailable.requested,false);
 i.ctx.newCDPSession=async()=>client;client.send=async method=>{if(method==='Debugger.enable')return new Promise(()=>{});};const stalled=await probeNativeResave(i,{timeoutMs:5});assert.equal(stalled.exceptionCaptureAvailable,false,'diagnostic CDP stall is bounded and falls back');assert.equal(stalled.revision,2);
 let resolveFlush,saves=0;const n={online:true,isConnected:()=>true,handlers:{resave(){saves++;}},flush:()=>new Promise(r=>resolveFlush=r)};
 i.eval=code=>vm.runInNewContext(code,{window:{AsteriaNet:n}});i.lastSaveAt=123;
 const first=requestNativeResave(i,{timeoutMs:5});await assert.rejects(first,/timeout/);
 assert.equal((await requestNativeResave(i)).reason,'native_saver_already_in_flight');assert.equal(saves,1,'timeout cannot produce overlapping native saves');assert.equal(i.lastSaveAt,123);
 resolveFlush();await new Promise(r=>setImmediate(r));n.flush=async()=>{};
 assert((await requestNativeResave(i)).flushed);assert.equal(saves,2);assert.equal(i.lastSaveAt,123,'flush return is never fabricated observation');n.pause=true;assert.equal((await requestNativeResave(i)).requested,false);assert.equal(saves,2);
 console.log('PASS native saver only, exception metadata without values, debugger cleanup, single-flight flush through timeout, paused guard and no fabricated save');
})().catch(e=>{console.error(e);process.exitCode=1;});
