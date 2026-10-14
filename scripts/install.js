// install.js - one command to make the desktop app: icon + desktop shortcut.
//
//   node scripts/install.js
//
// Safe to re-run: it regenerates the icon and overwrites the shortcut.
// Uses async spawn (not spawnSync) so it behaves the same in restricted environments.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CMD = path.join(ROOT, 'Asteria Farm.cmd');
const ICON = path.join(ROOT, 'assets', 'asteria-farm.ico');
const NAME = 'Asteria Farm';

const ok = m => console.log('  [ok]   ' + m);
const warn = m => console.log('  [warn] ' + m);
const bad = m => console.log('  [fail] ' + m);

function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    let out = '', err = '', settled = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd: ROOT, windowsHide: true, ...opts });
    } catch (e) {
      return resolve({ status: null, error: e, stdout: '', stderr: '' });
    }
    child.stdout?.on('data', d => { out += d; });
    child.stderr?.on('data', d => { err += d; });
    child.on('error', e => { if (!settled) { settled = true; resolve({ status: null, error: e, stdout: out, stderr: err }); } });
    child.on('close', code => { if (!settled) { settled = true; resolve({ status: code, error: null, stdout: out, stderr: err }); } });
  });
}

function why(r) {
  if (r.error) return r.error.message;
  if (r.status !== 0) return `exit ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' | ') || 'no output'}`;
  return 'ran, but the expected file is missing';
}

async function step1_icon() {
  console.log('\n1) Icon');
  const r = await run(process.execPath, [path.join(__dirname, 'make-icon.js')]);
  if (r.status === 0 && fs.existsSync(ICON)) { ok('assets/asteria-farm.ico'); return true; }
  if (fs.existsSync(ICON)) { warn('could not regenerate, but an icon is already present'); return true; }
  bad(why(r));
  return false;
}

function findPython() {
  const candidates = [
    path.join(os.homedir(), '.workbuddy-ai', 'binaries', 'python', 'envs', 'default', 'Scripts', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

async function step2_shortcut() {
  console.log('\n2) Desktop shortcut');
  if (!fs.existsSync(CMD)) { bad('launcher missing: ' + CMD); return false; }

  // Preferred route: pywin32 resolves the real Desktop folder (including a OneDrive-redirected
  // desktop) and writes a proper .lnk with a custom icon.
  const py = findPython();
  if (py) {
    const r = await run(py, [path.join(__dirname, 'make_shortcut.py')]);
    if (r.status === 0 && /OK\s*$/.test((r.stdout || '').trim())) {
      const line = (r.stdout.match(/shortcut:\s*(.+)/) || [])[1];
      ok(line ? line.trim() : 'created');
      return true;
    }
    warn('pywin32 route failed: ' + why(r));
  } else {
    warn('no Python found for the pywin32 route');
  }

  // Fallback: PowerShell + WScript.Shell.
  const desktop = path.join(os.homedir(), 'Desktop');
  const oneDrive = path.join(os.homedir(), 'OneDrive', 'Desktop');
  const target = fs.existsSync(oneDrive) ? oneDrive : desktop;
  const lnk = path.join(target, NAME + '.lnk');
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + JSON.stringify(lnk) + ');',
    '$s.TargetPath = ' + JSON.stringify(CMD) + ';',
    '$s.WorkingDirectory = ' + JSON.stringify(ROOT) + ';',
    '$s.IconLocation = ' + JSON.stringify(ICON + ',0') + ';',
    '$s.Description = "Asteria Farm control panel";',
    '$s.Save();',
  ].join(' ');
  const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (fs.existsSync(lnk)) { ok(lnk); return true; }
  bad(why(r));

  console.log('\n     Create it by hand instead:');
  console.log('       - right-click "Asteria Farm.cmd" in ' + ROOT);
  console.log('       - Send to -> Desktop (create shortcut)');
  console.log('       - then right-click the shortcut -> Properties -> Change Icon');
  console.log('         and pick ' + ICON);
  return false;
}

function step3_check() {
  console.log('\n3) Check');
  const problems = [];
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'playwright'))) problems.push('playwright is not installed - run: npm install');
  if (!fs.existsSync(CMD)) problems.push('launcher missing');
  if (!fs.existsSync(ICON)) problems.push('icon missing');
  if (problems.length) { problems.forEach(bad); return false; }
  ok('everything in place');
  return true;
}

(async () => {
  console.log('Asteria Farm - desktop install');
  console.log('project: ' + ROOT);
  await step1_icon();
  await step2_shortcut();
  const good = step3_check();

  console.log('\nDone.' + (good ? '' : ' (see the problems above)'));
  console.log('\nDouble-click "' + NAME + '" on your desktop to open the control panel.');
  console.log('You can also run it directly:  node src/panel.js\n');
})();
