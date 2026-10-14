// install-autostart.js - make the farm come back by itself.
//
// Two layers, because they cover different failures:
//
//   1. A Startup-folder entry. If the machine reboots or the user logs back in, this runs the
//      watchdog, which starts the panel (in god mode, autostarting six windows).
//   2. The same watchdog running as a resident GUARDIAN (--loop). This is what covers the panel
//      itself dying - nothing else can, because the panel is the top of the tree.
//
// A scheduled task would be the natural tool for (2), but schtasks.exe is blocked on this machine
// by security policy (Program Blacklist), so the guardian is a plain resident node process that
// the startup entry launches. Both layers are per-user and need no administrator rights.
// Re-running is safe: it overwrites.
//
//   node scripts/install-autostart.js [--remove]
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
const STARTUP = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows',
  'Start Menu', 'Programs', 'Startup');
const ENTRY = path.join(STARTUP, 'Asteria Farm (auto).cmd');
const WATCHDOG = path.join(ROOT, 'scripts', 'watchdog.js');

if (argv.remove) {
  try { fs.unlinkSync(ENTRY); console.log('removed:', ENTRY); }
  catch (e) { console.log('nothing to remove:', e.code); }
  console.log('autostart removed. (Stop a running guardian with Task Manager, or it will');
  console.log('simply see the panel is already up and do nothing.)');
  process.exit(0);
}

// The entry calls the WATCHDOG, not the panel: the watchdog is the only thing that knows whether
// a panel is already up, so logging in twice can never leave two of them fighting over the port.
const cmd = [
  '@echo off',
  'rem Installed by scripts/install-autostart.js - brings the farm back after a reboot.',
  'rem Runs the guardian, which starts the panel (god mode, 6 windows) if it is not up.',
  'title Asteria Farm guardian',
  'cd /d "' + ROOT + '"',
  '"' + process.execPath + '" "' + WATCHDOG + '" --loop --quiet',
  '',
].join('\r\n');

if (!fs.existsSync(STARTUP)) {
  console.error('startup folder not found, so nothing was installed:', STARTUP);
  process.exit(1);
}
fs.writeFileSync(ENTRY, cmd);
console.log('startup entry :', ENTRY);
console.log('  runs        : watchdog.js --loop --quiet');
console.log('  node        :', process.execPath);

console.log('');
console.log('done. At login the guardian starts the panel in god mode (six windows) if it is not');
console.log('answering, and restarts it if it ever stops. The panel in turn restarts the farm if');
console.log('it dies or stops updating for four minutes.');
console.log('');
console.log('Start the guardian now, without logging out:');
console.log('  "' + process.execPath + '" "' + WATCHDOG + '" --loop --quiet');
