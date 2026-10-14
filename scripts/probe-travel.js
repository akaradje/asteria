// probe-travel.js - focused trace of the town-exit path.
//
// Question it answers: when the controller clicks the world map's travel button, does the
// character actually move? We sample the character's own reported position (from the save
// payload) and the HUD location before and after, so the answer is evidence, not inference.
//
//   node scripts/probe-travel.js [--map=w1] [--secs=45] [--slot=0]
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
const MAP = String(argv.map || 'w1');
const SECS = +(argv.secs || 45);
const SLOT = +(argv.slot || 0);

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await api.health().catch(() => null);
  const cache = new AssetCache(ROOT, (h && h.build) || 'unversioned');
  const inst = new GameInstance({
    slot: SLOT, root: ROOT, headless: true, noDraw: !!argv.nodraw,
    cache, log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} ${m}`),
  });

  try {
    await inst.start();
    const s0 = await inst.screen();
    console.log(`\nstart: loc=${s0.loc} autoOn=${s0.autoOn} questOn=${s0.questOn} pos=${JSON.stringify(inst.lastSave?.pos)}`);

    // Make sure the character is not fighting: stop the client's own automation first, so
    // a monster target cannot be what holds it in place.
    await inst.eval(`(() => {
      const ab = document.getElementById('autoBtn'); if (ab && ab.getAttribute('aria-pressed') === 'true') ab.click();
      const q = document.getElementById('qGo'); if (q && q.getAttribute('aria-pressed') === 'true' && document.getElementById('panel').hidden) q.click();
    })()`);
    await sleep(1500);
    console.log('automation paused; travelling now\n');

    const t0 = Date.now();
    const ok = await inst.travelTo(MAP);
    console.log(`travelTo(${MAP}) -> ${ok}\n`);

    let last = null;
    while (Date.now() - t0 < SECS * 1000) {
      const s = await inst.screen();
      const chat = await inst.eval(`(() => { ${'const c=document.getElementById("chat"); return c ? c.innerText.split("\\n").slice(-8) : [];' }})()`);
      const p = inst.lastSave?.pos;
      const key = `${s.loc}|${p ? p.join(',') : '-'}|${s.autoOn}${s.questOn}|${chat.join('~')}`;
      if (key !== last) {
        last = key;
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`t+${String(el).padStart(3)}s  loc=${s.loc}  pos=${p ? `[${p[0].toFixed(1)}, ${p[1].toFixed(1)}]` : '?'}  auto=${s.autoOn} quest=${s.questOn}`);
        chat.forEach(l => console.log('        | ' + l));
      }
      await sleep(1500);
    }
    console.log(`\nfinal: loc=${(await inst.screen()).loc} pos=${JSON.stringify(inst.lastSave?.pos)}`);
  } catch (e) {
    console.log('FAILED:', e.message);
  } finally {
    await inst.stop();
  }
})();
