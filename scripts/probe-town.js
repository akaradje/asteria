// probe-town.js - can we open a town service panel by walking to its NPC?
//
// These panels (shop, storage, smith, quest board...) have no DOM button: the client opens
// them when a pointerdown lands near the NPC's projected screen position. This walks to the
// NPC, scans a small strip of the screen, and reports what actually opened.
//
//   node scripts/probe-town.js [--svc=potionShop] [--buy] [--slot=0]
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
const SVC = String(argv.svc || 'potionShop');
const SLOT = +(argv.slot || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await api.health().catch(() => null);
  const cache = new AssetCache(ROOT, (h && h.build) || 'unversioned');
  const inst = new GameInstance({
    slot: SLOT, root: ROOT, headless: true, noDraw: !!argv.nodraw, cache,
    log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} ${m}`),
  });

  try {
    await inst.start();
    const s0 = await inst.screen();
    console.log(`\nstart: loc=${s0.loc} potions=${inst.lastSave?.potions} coins=${inst.lastSave?.coins}`);

    if (!/town/i.test(s0.loc)) {
      console.log('not in town - the test needs the character in Asteria Town');
      console.log('(deaths and quests both bring it there; run a window for a while first)');
    }

    console.log(`\n--- openTownService(${SVC}) ---`);
    const t0 = Date.now();
    const r = await inst.openTownService(SVC);
    console.log(`result after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(r)}`);
    console.log(`panel now open: ${await inst.panelName()}`);

    if (r.ok && argv.buy) {
      console.log('\n--- buying ---');
      const before = inst.lastSave?.potions;
      const b = await inst.restockPotions();
      await sleep(1500);
      const after = inst.lastSave?.potions;
      console.log(`buy result: ${JSON.stringify(b)}`);
      console.log(`potions in last save: ${before} -> ${after} (save may lag by a few seconds)`);
    }

    await inst.screenshotIfPossible?.(path.join(ROOT, 'logs', `town-${SVC}.png`));
  } catch (e) {
    console.log('FAILED:', e.message);
  } finally {
    try { await inst.page.screenshot({ path: path.join(ROOT, 'logs', `town-${SVC}.png`) }); console.log('screenshot saved'); } catch { }
    await inst.stop();
  }
})();
