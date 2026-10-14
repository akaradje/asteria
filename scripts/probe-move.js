// probe-move.js - live movement trace straight off the game's own state socket.
//
// The client broadcasts {t:'state', x, z, mv, sit, dead, ...} over the websocket at up to
// 10 Hz. That is a much better position source than the save payload (which is only sent
// every few seconds), so this is how we tell "the character is moving" from "it is stuck".
//
//   node scripts/probe-move.js [--map=w1] [--secs=40] [--slot=0] [--keys]
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
const SECS = +(argv.secs || 40);
const SLOT = +(argv.slot || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await api.health().catch(() => null);
  const cache = new AssetCache(ROOT, (h && h.build) || 'unversioned');
  const inst = new GameInstance({
    slot: SLOT, root: ROOT, headless: true, cache,
    log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} ${m}`),
  });

  const moves = [];       // our own state frames
  try {
    // The socket is created during boot, so the hook must exist before start().
    inst.onWebSocket = ws => {
      if (!/\/ws/.test(ws.url())) return;
      ws.on('framesent', ev => {
        try {
          const m = JSON.parse(ev.payload);
          if (m.t === 'state') moves.push({ at: Date.now(), x: m.x, z: m.z, mv: m.mv, sit: m.sit, dead: m.dead });
        } catch { }
      });
    };

    await inst.start();
    const page = inst.page;
    await sleep(1000);

    const before = await inst.screen();
    console.log(`\nstart: loc=${before.loc} auto=${before.autoOn} quest=${before.questOn}`);
    console.log(`       save pos=${JSON.stringify(inst.lastSave?.pos)}`);

    // Stop the client's automation so nothing else can move or hold the character.
    await inst.eval(`(() => {
      const ab=document.getElementById('autoBtn'); if (ab && ab.getAttribute('aria-pressed')==='true') ab.click();
      const q=document.getElementById('qGo'); if (q && q.getAttribute('aria-pressed')==='true' && document.getElementById('panel').hidden) q.click();
    })()`);
    await sleep(1500);

    const t0 = Date.now();
    console.log(`\n--- travelTo(${MAP}) ---`);
    await inst.travelTo(MAP);

    // Phase 1: let the game's own travel walker run.
    await sleep(8000);
    report(moves, t0, 'after travel');

    // Phase 2: drive the character with the game's own keyboard movement.
    if (argv.keys) {
      console.log('\n--- holding W (north / -z) for 5s ---');
      const mark = moves.length;
      await page.keyboard.down('w');
      await sleep(5000);
      await page.keyboard.up('w');
      report(moves.slice(mark), Date.now() - 5000, 'during W');
    }

    // Phase 3: keep watching.
    await sleep(Math.max(0, SECS * 1000 - (Date.now() - t0)));
    report(moves, t0, 'total');
    const after = await inst.screen();
    console.log(`\nfinal: loc=${after.loc} save pos=${JSON.stringify(inst.lastSave?.pos)}`);
  } catch (e) {
    console.log('FAILED:', e.message);
  } finally {
    await inst.stop();
  }
})();

function report(frames, t0, label) {
  if (!frames.length) { console.log(`  [${label}] no state frames captured`); return; }
  const uniq = [];
  for (const f of frames) {
    const p = uniq[uniq.length - 1];
    if (!p || p.x !== f.x || p.z !== f.z) uniq.push(f);
  }
  const a = uniq[0], b = uniq[uniq.length - 1];
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  console.log(`  [${label}] frames=${frames.length} distinct-positions=${uniq.length} ` +
    `from [${a.x}, ${a.z}] to [${b.x}, ${b.z}] => moved ${dist.toFixed(2)} units, mv=${b.mv}`);
  if (uniq.length > 1) {
    console.log('    path: ' + uniq.slice(0, 12).map(f => `[${f.x},${f.z}]`).join(' -> '));
  }
}
