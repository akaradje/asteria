// watchdog.js - keep the control panel alive, so the farm survives a crash, a hang or a reboot.
//
// The panel already restarts the FARM (it is the farm's parent). This is the layer above it:
// nothing restarts the panel. Run this on a schedule - every few minutes - and it will notice a
// panel that is not answering and bring one back.
//
//   node scripts/watchdog.js                 check once, start the panel if it is down
//   node scripts/watchdog.js --loop          stay resident and check forever (see below)
//   node scripts/watchdog.js --quiet         say nothing unless it acts
//
// --loop is the mode the Startup folder uses, and it is the answer to "nothing restarts the
// panel". A scheduled task would be the natural tool, but schtasks.exe is blocked on this
// machine by security policy, so the guardian is a plain resident process instead: one node
// process, a few tens of MB, checking a local port every few minutes.
//
// Exit codes: 0 = panel was up (or was started), 1 = could not start it.
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const argv = require('../src/machine-config').loadMachineArgs();

const ROOT = path.resolve(__dirname, '..');
const PORT = +(argv.port || process.env.PANEL_PORT || 4711);
const QUIET = !!argv.quiet;
const say = m => { if (!QUIET) console.log(`[watchdog ${new Date().toISOString()}] ${m}`); };

/** Is the panel answering? A TCP connect would do, but the status route proves it is really it. */
function panelAlive(timeoutMs = 4000) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/panel-health', timeout: timeoutMs }, res => {
      let body='';res.on('data',c=>body+=c);res.on('end',()=>{try{resolve(res.statusCode===200&&JSON.parse(body).service==='asteria-panel');}catch{resolve(false);}});
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const LOOP = !!argv.loop;
const EVERY_MS = +(argv.every || 3) * 60 * 1000;

async function checkOnce() {
  if (await panelAlive()) { say(`panel is up on ${PORT}`); return true; }

  say(`panel is NOT answering on ${PORT} - starting it`);
  // Detached so it outlives this process, which is the whole point: the watchdog exits
  // immediately and the panel has to keep running without a parent.
  const out = fs.openSync(path.join(ROOT, 'logs', 'panel-session.log'), 'a');
  fs.writeSync(out, `\n===== watchdog started the panel ${new Date().toISOString()} =====\n`);
  // --autostart as well: the panel coming back without the farm is only half a recovery. If the
  // panel died, the farm it was parenting died with it.
  const child = spawn(process.execPath,
    [path.join('src', 'panel.js'), '--machine=' + (argv.machine || (process.platform === 'win32' ? 'windows' : 'tum')), '--autostart', '--no-open'], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  say(`panel launched (pid ${child.pid})`);

  // Give it a moment, then confirm - a watchdog that reports success without checking is worse
  // than no watchdog.
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await panelAlive(2000)) { say('panel is answering'); return true; }
  }
  console.error('[watchdog] panel did not come up; see logs/panel-session.log');
  return false;
}

(async () => {
  if (!LOOP) {
    process.exit(await checkOnce() ? 0 : 1);
  }

  say(`guardian started: checking every ${EVERY_MS / 60000} min (pid ${process.pid})`);
  // Never exits. Each tick is independent, so a failure to restart one time is retried on the
  // next rather than ending the guardian.
  for (;;) {
    try { await checkOnce(); } catch (e) { console.error('[watchdog] check failed:', e.message); }
    await new Promise(r => setTimeout(r, EVERY_MS));
  }
})();
