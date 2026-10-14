'use strict';
const assert = require('assert/strict');
const { installWindowsRuntime } = require('../machines/windows/runtime');
(async () => {
  let runs = 0, recycles = 0;
  class Fake {
    async launch() { this.ctx = {addInitScript: async fn => { this.init = fn; }}; }
    async screen() { return {startVisible:true}; }
    async eval() { return 'online'; }
    async run() { if (++runs === 1) throw Error('evaluate timed out after 45s'); this.status = 'stopping'; }
    async recycle() { recycles++; this.status = 'playing'; return true; }
    async walkTo(x, z, o) {
      assert.equal(o.tolerance, 1);
      this.livePos = { room: 'other', at: Date.now() };
      assert.equal(await o.abort(), true);
    }
    log() {}
    async enableAuto() { this.auto = true; }
    async expeditionAuto(on) { this.auto = on; }
  }
  const original = Fake.prototype.run;
  assert.equal(Fake.prototype.run, original);
  installWindowsRuntime(Fake);
  const installed = Fake.prototype.run;
  installWindowsRuntime(Fake);
  assert.equal(Fake.prototype.run, installed);
  const i = new Fake(); i.status = 'playing'; i.pendingTravel = {};
  await i.launch(); assert.equal(typeof i.init, 'function');
  const vm = require('vm');
  const calls = [], timers = [];
  const originalSignal = new AbortController().signal;
  const window = {fetch: async (url, options) => {calls.push(options); return {ok:true};}};
  vm.runInNewContext(`(${i.init.toString()})()`, {window, URL, AbortController,
    location:{href:'https://asteria-online.io/',origin:'https://asteria-online.io'},
    setTimeout:(fn,ms)=>{timers.push(ms);return 1;},clearTimeout:()=>{}});
  await window.fetch('/api/health',{signal:originalSignal});
  assert.notEqual(calls[0].signal,originalSignal); assert.deepEqual(timers,[15000]);
  await window.fetch('/api/other',{signal:originalSignal}); assert.equal(calls[1].signal,originalSignal);
  await i.screen(); assert.ok(i.windowsStartClickAt > 0);
  const pending=i.pendingTravel;i.progressAt=123;
  await i.run(); assert.equal(recycles, 0); assert.equal(runs, 2); assert.equal(i.pendingTravel, pending);assert.equal(i.progressAt,123,'timeout cannot fabricate progress');
  const frozen=new Fake(),at=Date.now();Object.assign(frozen,{status:'playing',pendingTravel:{},progressAt:123,startedAt:at-600000,lastSaveAt:at-200000,v2:{lastScreenAt:at-200000},rendererHealth:{lastSuccessAt:at-200000,consecutiveTimeouts:3,firstTimeoutAt:at-150000,lastTimeoutAt:at-1000}});runs=0;await frozen.run();assert.equal(recycles,1,'proven frozen renderer still recovers');assert.equal(frozen.pendingTravel,null);assert.equal(frozen.progressAt,123);
  const deferred=new Fake();Object.assign(deferred,{...frozen,status:'playing',pendingTravel:{mapId:'d3'},rendererHealth:{...frozen.rendererHealth}});deferred.recycle=async()=>false;runs=0;await deferred.run();assert.equal(deferred.pendingTravel.mapId,'d3','deferred recovery cannot erase the route');
  i.livePos = { room: 'town', at: Date.now() };
  await i.walkTo(1, 2, { tolerance: 1.8 });
  i.brain = { travelFailure: () => false }; i.pendingTravel = {};
  assert.equal((await i.travelTo('r1')).ok, false);
  assert.equal(i.pendingTravel, null); assert.equal(i.auto, true);
  i.livePos={room:'town',at:Date.now()};
  await i.travelTo('r1');assert.equal(i.auto,false);
  const fs=require('fs'),os=require('os'),path=require('path'),fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-route-identity-'));
  try{const dir=path.join(fixtureRoot,'logs/game-knowledge/old-collected');fs.mkdirSync(dir,{recursive:true});const sourceHashes={client:'a'.repeat(64),world:'b'.repeat(64),network:'c'.repeat(64)},identity={build:'old',sourceHashes};fs.writeFileSync(path.join(dir,'facts.json'),JSON.stringify({build:'old',at:100,sourceHashes,routes:{townGates:{w1:{x:115.5,z:0}}}}));fs.writeFileSync(path.join(fixtureRoot,'logs/game-knowledge/state.json'),JSON.stringify({current:{build:'new'}}));const loaded=require('../src/runtime/observed-routes').loadedRoutes(fixtureRoot,'old',identity);assert.ok(loaded?.townGates,'exact loaded-client routes survive a newer live build');assert.equal(require('../src/runtime/observed-routes').loadedRoutes(fixtureRoot,'old',{build:'old',sourceHashes:{...sourceHashes,client:'d'.repeat(64)}}),undefined,'same build with different bytes cannot borrow old routes');}finally{assert.equal(path.dirname(fixtureRoot),os.tmpdir());fs.rmSync(fixtureRoot,{recursive:true,force:true});}
  const {route}=require('../src/runtime/observed-routes');
  assert.equal(route('town','w1'),null);
  const observed={townGates:{w1:{x:115.5,z:0}},fieldGates:{home:{x:0,z:40},previous:{x:-38,z:-2},next:{x:16,z:-42}},links:{w1:{prev:null,next:'w2'},w2:{prev:'w1',next:null}}};
  assert.deepEqual(route('town','w2',observed).map(g=>g.target),['w1','w2']);
  observed.fieldGates.next.x=NaN;assert.equal(route('town','w2',observed),null);
  // Exercise the real boot ladder against a stalled DOM-ready event. A committed
  // reload must hand control back to native screen evidence, with one retry only.
  const boot=require('../src/instance').GameInstance.prototype.bootToGame;
  for(const resume of [true,false]){
    let clock=100000,reads=0,reloads=0;
    const actor={log(){},ensureFrameTap:async()=>{},screen:async()=>{reads++;if(reads>1)clock+=61001;return resume&&reloads?{inGame:true}:{startVisible:true};},page:{reload:async options=>{reloads++;assert.equal(options.waitUntil,'commit','unrelated DOM-ready work cannot block the owned native boot ladder');}}};
    const run=vm.runInNewContext('('+boot.toString().replace(/^async bootToGame/, 'async function bootToGame')+')',{Date:{now:()=>clock},sleep:async()=>{},describeScreen:()=> 'landing screen'});
    if(resume){assert.equal(await run.call(actor,240000),true);assert.equal(actor.status,'playing');}
    else await assert.rejects(run.call(actor,240000),/boot timed out/);
    assert.equal(reloads,1,'persistent landing page must not cause an unbounded reload loop');
  }
  console.log('windows runtime: online handshake, timeout recovery, room-change abort and evidence-only routes passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
