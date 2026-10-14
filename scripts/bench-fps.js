// bench-fps.js - how expensive is actually *showing* the game?
//
// The client advances its simulation by frame delta, capped at 0.05 s (20 FPS). Below that
// the whole game runs in slow motion, so frame rate is throughput, not cosmetics. `--nodraw`
// buys frame rate by skipping WebGL draw calls - but then there is nothing to look at.
// This measures the middle ground: rendering ON at various viewport sizes and window counts.
//
//   node scripts/bench-fps.js --n=3 --w=320 --h=180 [--secs=30] [--nodraw]
'use strict';

const path = require('path');
const { GameInstance } = require('../src/instance');
const { AssetCache } = require('../src/assetcache');
const api = require('../src/api');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
const N = +(argv.n || 1);
const W = +(argv.w || 480), H = +(argv.h || 270);
const SECS = +(argv.secs || 30);
const NODRAW = !!argv.nodraw;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const health = await api.health().catch(() => null);
  const cache = new AssetCache(ROOT, (health && health.build) || 'unversioned');

  console.log(`bench: ${N} window(s) at ${W}x${H}, nodraw=${NODRAW}, sampling ${SECS}s after warm-up`);
  const instances = [];

  const mk = slot => new GameInstance({
    slot, root: ROOT, width: W, height: H, headless: !argv.headed, noDraw: NODRAW,
    cache, log: () => { },
  });

  try {
    // Boot them one at a time; the first fills the shared asset cache.
    for (let i = 0; i < N; i++) {
      const inst = mk(i);
      instances.push(inst);
      process.stdout.write(`  booting slot ${i} ... `);
      await inst.start();
      console.log('in world');
    }

    console.log('  warming up 20s ...');
    await sleep(20000);

    // Sample frame rates.
    const samples = instances.map(() => []);
    for (let t = 0; t < SECS; t += 2) {
      const fps = await Promise.all(instances.map(i => i.screen().then(s => s.fps).catch(() => 0)));
      fps.forEach((f, i) => samples[i].push(f));
      await sleep(2000);
    }

    console.log('\nslot   min  avg  max   (FPS)   simulated-time ratio');
    let worst = Infinity, sum = 0, count = 0;
    samples.forEach((s, i) => {
      const good = s.filter(x => x > 0);
      if (!good.length) { console.log(`  ${i}      no samples`); return; }
      const min = Math.min(...good), max = Math.max(...good);
      const avg = good.reduce((a, b) => a + b, 0) / good.length;
      worst = Math.min(worst, min); sum += avg; count++;
      // ratio of game time to real time: min(1, fps / 20)
      console.log(`  ${i}    ${String(min).padStart(4)} ${avg.toFixed(1).padStart(5)} ${String(max).padStart(4)}   ` +
        `         ${Math.min(1, min / 20).toFixed(2)}x`);
    });

    const freeMb = Math.round(require('os').freemem() / 1048576);
    console.log(`\nfree RAM: ${freeMb} MB`);
    if (count) console.log(`worst window: ${worst} FPS -> game runs at ${Math.min(1, worst / 20).toFixed(2)}x real time`);
    console.log(worst >= 20 ? 'VERDICT: every window is at full speed.'
      : worst > 0 ? `VERDICT: at least one window is in slow motion (need >= 20 FPS).`
        : 'VERDICT: no data.');
  } catch (e) {
    console.log('FAILED:', e.message);
  } finally {
    await Promise.all(instances.map(i => i.stop().catch(() => { })));
  }
})();
