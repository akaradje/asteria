'use strict';
const assert = require('assert/strict');
const { installTumRuntime } = require('../machines/tum/runtime');
(async () => {
  let runs = 0, recycles = 0;
  class Fake {
    async launch() { this.ctx = {addInitScript: async fn => { this.init = fn; }}; }
    async screen() { return {startVisible:true}; }
    async eval() { return 'online'; }
    async run() { if (++runs === 1) throw Error('evaluate timed out after 45s'); this.status = 'stopping'; }
    async recycle() { recycles++; this.status = 'playing'; }
    async walkTo(x, z, o) {
      assert.equal(o.tolerance, 1);
      this.livePos = { room: 'other', at: Date.now() };
      assert.equal(await o.abort(), true);
    }
    log() {}
    async enableAuto() { this.auto = true; }
  }
  const original = Fake.prototype.run;
  assert.equal(Fake.prototype.run, original);
  installTumRuntime(Fake);
  const installed = Fake.prototype.run;
  installTumRuntime(Fake);
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
  await i.screen(); assert.ok(i.tumStartClickAt > 0);
  await i.run(); assert.equal(recycles, 1); assert.equal(runs, 2); assert.equal(i.pendingTravel, null);
  i.livePos = { room: 'town', at: Date.now() };
  await i.walkTo(1, 2, { tolerance: 1.8 });
  i.brain = { travelFailure: () => false }; i.pendingTravel = {};
  assert.equal((await i.travelTo('r1')).ok, false);
  assert.equal(i.pendingTravel, null); assert.equal(i.auto, true);
  const { route } = require('../machines/tum/routes');
  assert.deepEqual(route('town', 'c3').map(g => g.target), ['c1', 'c2', 'c3']);
  assert.deepEqual(route('town', 'r4').map(g => g.target), ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(route('d4', 'r1').map(g => g.target), ['town', 'r1']);
  assert.equal(route('town', 'unknown'), null);
  const traveller = new Fake(); traveller.livePos = {room:'town',at:Date.now()};
  traveller.expeditionAuto = async fight => { traveller.fight = fight; };
  traveller.brain = { arrived: map => { traveller.arrived = map; } };
  traveller.walkTo = async () => { traveller.livePos = {room:'c1',at:Date.now()}; };
  assert.equal(await traveller.chainWalkTo('c1'), true);
  assert.equal(traveller.arrived, 'c1'); assert.equal(traveller.fight, true);
  class Broken extends Fake { async run() { throw Error('logic failure'); } }
  installTumRuntime(Broken);
  const b = new Broken(); b.status = 'playing';
  await assert.rejects(b.run(), /logic failure/);
  console.log('tum runtime: passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
