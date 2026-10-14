'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {screenMetrics}=require('../src/runtime/metric-freshness');
const {GameInstance}=require('../src/instance');
const {installRuntimeV2}=require('../src/runtime/v2-instance');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-observer-'));
 try{
  const progress={history:[],stuckCount:3};
  GameInstance.prototype.noteProgress.call(progress,120,100,{coins:1,jobLv:50});
  progress.progressAt=1;
  GameInstance.prototype.noteProgress.call(progress,120,100,{coins:2,jobLv:50});
  assert(progress.progressAt>1,'coin gains are progress at capped level');assert.equal(progress.stuckCount,0);
  progress.progressAt=1;
  GameInstance.prototype.noteProgress.call(progress,120,100,{coins:2,jobLv:50});assert.equal(progress.progressAt,1,'unchanged saves do not fake progress');
  GameInstance.prototype.noteProgress.call(progress,120,100,{coins:2,jobLv:51});assert(progress.progressAt>1);
  class Instance{async screen(){return {fps:20}}async tick(){}async stop(){}snapshot(){return {fps:1}}}
  installRuntimeV2(Instance);let release,calls=0;
  const i=new Instance();Object.assign(i,{root,slot:0,status:'playing',credentials:{username:'fixture'},pendingTravel:{mapId:'r4'},lastSaveAt:123,eval:async()=>{calls++;if(calls>1)return {hasConnectionId:true,startVisible:false,nativeResaveAvailable:true,saveWarning:false,serverSaveWarning:false};await new Promise(r=>release=r);return {fps:24,fpsMeasuredAt:Date.now(),heapMB:35,connected:true}}});
  const first=i.observeContinuity();await i.observeContinuity();assert.equal(calls,1,'single in-flight observation during travel');release();await first;
  assert.equal(i.lastSaveAt,123,'read-only observation never fabricates a fresh save');
  assert.equal(i.v2.observation.saveDiagnostics.hasConnectionId,true);assert.equal(calls,2,'only stale-save observation adds a read-only native diagnostic');
  const snap=i.snapshot();assert.equal(screenMetrics(snap).fps,24);assert.equal(screenMetrics(snap, snap.fpsAt+30001).fps,null);
  const prior=i.v2.observation;i.lastSaveAt=Date.now();i.v2.observationAttemptAt=0;i.page={generation:1};let finishOld;i.eval=()=>new Promise(resolve=>finishOld=resolve);const oldRead=i.observeContinuity();i.page={generation:2};finishOld({fps:1,connected:false,hp:'1 / 100'});await oldRead;assert.equal(i.v2.observation,prior,'late old-page observation cannot overwrite current health');assert.equal(i.lastFps,24);
  assert.equal(screenMetrics({fps:0,fpsAt:1000},1001).fps,0,'zero FPS is a measured sample');
  assert.equal(screenMetrics({fps:30,fpsAt:1001},1000).fps,null,'future metrics rejected');
  assert.equal(screenMetrics({fps:1,fpsAt:1000},40000,{fps:25,at:39900}).fps,25,'fresh telemetry replaces old status snapshot');
  assert.equal(screenMetrics({fps:25,fpsAt:39900},40000,{fps:1,at:1000}).fps,25,'older telemetry cannot overwrite newer snapshot');
  const vm=require('vm'),saver=require('../src/runtime/native-save-probe');let saves=0,flushes=0;const native={online:true,isConnected:()=>true,handlers:{resave:()=>saves++},flush:async()=>flushes++},requester={ctx:{newCDPSession(){throw Error('lightweight request must not attach a debugger');}},eval:async code=>vm.runInNewContext(code,{window:{AsteriaNet:native}})};assert((await saver.requestNativeResave(requester)).requested);assert.equal(saves,1);assert.equal(flushes,1);native.pause=true;assert.equal((await saver.requestNativeResave(requester)).requested,false);assert.equal(saves,1,'trade-paused native saver is not forced');
  const observer=new Instance();let requests=0;Object.assign(observer,{root,slot:2,status:'playing',credentials:{username:'native-save-fixture'},lastSaveAt:Date.now()-25000,livePos:{room:'w1',at:Date.now()},eval:async code=>{if(code.includes('n.handlers.resave()')){requests++;return {requested:true};}return {connected:true,paused:false,hp:'100 / 100',mp:'100 / 100'};}});await observer.screen();observer.v2.sourceCoherence={matches:true};const originalSave=observer.lastSaveAt;await observer.observeContinuity();assert.equal(requests,1,observer.v2.observationError);assert.equal(observer.lastSaveAt,originalSave,'asking native saver is not a save receipt');observer.v2.observationAttemptAt=0;await observer.observeContinuity();assert.equal(requests,1,'native keep-fresh request is bounded');observer.v2.observationAttemptAt=0;observer.v2.keepFreshAskedAt=0;observer.eval=async()=>({connected:true,paused:true,hp:'100 / 100'});await observer.observeContinuity();assert.equal(requests,1);
  console.log('PASS capped-level progress, unchanged-save rejection, read-only travel observation, single-flight and per-metric freshness');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
