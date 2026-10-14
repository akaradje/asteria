// measure-ram.js - how much memory does one game window actually cost?
//
// Launches windows one at a time and records the machine's available memory after each one is
// fully in the world. That gives the per-window cost directly, instead of guessing from a
// total. It stops early if memory gets tight, so it is safe to run on a machine you are using.
//
//   node scripts/measure-ram.js [--max=6] [--nodraw]
'use strict';

const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { GameInstance } = require('../src/instance');
const { AssetCache } = require('../src/assetcache');
const { Team } = require('../src/team');
const api = require('../src/api');

/**
 * Sum the working set of the Chromium processes this project started.
 *
 * `os.freemem()` is a poor proxy on Windows: it excludes the standby cache, so allocating memory
 * moves pages out of standby and makes the figure fall by more than the process actually took.
 * Summing the real process memory is the honest number.
 */
function ourChromiumMb() {
  return new Promise(resolve => {
    // Count and sum ALL chrome.exe processes. We cannot filter by command line reliably here
    // (the profile path filter came back empty), so the script records a baseline before the
    // first window and reports the delta - which is ours, since only our windows are added.
    const ps = 'Get-Process chrome -ErrorAction SilentlyContinue | ' +
      'Measure-Object -Property WS -Sum | ForEach-Object { "$($_.Count) $($_.Sum)" }';
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 20000 }, (err, stdout) => {
        const parts = String(stdout || '').trim().split(/\s+/);
        const count = Number(parts[0]);
        const sum = Number(parts[1]);
        resolve(Number.isFinite(sum) ? { count, mb: Math.round(sum / 1048576) } : null);
      });
  });
}

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
const MAX = +(argv.max || 6);
const FLOOR_MB = +(argv.floor || 900);          // stop before the machine gets uncomfortable
const sleep = ms => new Promise(r => setTimeout(r, ms));
const availMb = () => Math.round(os.freemem() / 1048576);

(async () => {
  const health = await api.health().catch(() => null);
  const cache = new AssetCache(ROOT, (health && health.build) || 'unversioned');
  const team = new Team(ROOT);
  const creds = team.credentials();

  const total = Math.round(os.totalmem() / 1048576);
  console.log(`total RAM      : ${(total / 1024).toFixed(1)} GB`);
  console.log(`available now  : ${availMb()} MB   (before any window)`);
  console.log(`stopping below : ${FLOOR_MB} MB available\n`);
  console.log('windows | avail after | chrome procs | chrome MB | ours MB | per window');
  console.log('--------|-------------|--------------|-----------|---------|-----------');

  const instances = [];
  const before = availMb();
  const base = await ourChromiumMb();            // the machine's own Chrome, before we add any
  console.log(`baseline chrome: ${base ? base.count + ' procs, ' + base.mb + ' MB' : '?'}\n`);

  for (let i = 0; i < MAX; i++) {
    if (availMb() < FLOOR_MB) {
      console.log(`\nstopping at ${i} windows: available memory fell to ${availMb()} MB (floor ${FLOOR_MB} MB)`);
      break;
    }
    const inst = new GameInstance({
      slot: i, root: ROOT, headless: true, noDraw: !!argv.nodraw,
      cache, credentials: creds[i] || null, log: () => { },
    });
    instances.push(inst);
    try {
      await inst.start();
    } catch (e) {
      console.log(`window ${i + 1}: failed to start (${e.message})`);
      break;
    }
    await sleep(6000);                       // let it settle before reading
    const now = availMb();
    const c = await ourChromiumMb();
    const ours = (c && base) ? c.mb - base.mb : null;
    const perWin = ours !== null ? Math.round(ours / (i + 1)) : null;
    console.log(`${String(i + 1).padStart(7)} | ${String(now).padStart(11)} | ` +
      `${String(c ? c.count : '?').padStart(12)} | ${String(c ? c.mb : '?').padStart(9)} | ` +
      `${String(ours === null ? '?' : ours).padStart(7)} | ${String(perWin === null ? '?' : perWin).padStart(10)}`);
  }

  const n = instances.length;
  if (!n) { console.log('\nno window started'); return; }

  const cEnd = await ourChromiumMb();
  const ours = (cEnd && base) ? cEnd.mb - base.mb : null;
  const perWindow = ours !== null && n ? Math.round(ours / n) : null;
  console.log(`\n${n} window(s) running.`);
  if (perWindow !== null) {
    console.log(`Our Chromium processes add ${ours} MB -> ${perWindow} MB per window (real process memory).`);
  }
  console.log(`Available memory moved by ${before - availMb()} MB over the run (noisier: Windows shuffles its cache).`);

  // What fits in the RAM that was free when we started, and in the whole machine.
  const headroom = before - FLOOR_MB;
  console.log(`\nwith ${before} MB available and a ${FLOOR_MB} MB floor, roughly ` +
    `${Math.floor(headroom / perWindow)} window(s) fit right now.`);
  console.log(`on a machine with nothing else running, roughly ` +
    `${Math.floor((total - FLOOR_MB) / perWindow)} window(s) would fit in ${(total / 1024).toFixed(1)} GB.`);
  console.log('\nnote: this is measured while your own applications are running. Closing browsers');
  console.log('      (each one is several hundred MB) is the cheapest way to make room.');

  console.log('\nstopping the test windows...');
  await Promise.all(instances.map(i => i.stop().catch(() => { })));
  await sleep(4000);
  console.log(`available after stopping: ${availMb()} MB`);
})();
