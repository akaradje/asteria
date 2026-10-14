// trim-test.js - does the server's save validation actually hold?
//
// This is the test that answers the duplication question properly. It belongs on a server you
// control (a staging build), NOT on a live world: every case deliberately writes a save that
// claims more than the character earned, which is the exploit itself. Run against a server with
// real players in it and you are cheating, not testing.
//
// It defaults to localhost and will not point anywhere else without an explicit flag, because
// the whole point is that this runs somewhere disposable.
//
//   node scripts/trim-test.js --base=http://localhost:3000 --token=<token> --i-own-this-server
//
// Each case: read the save, perturb exactly one field, write it, read it back, report whether
// the server trimmed it, then restore the original. It restores even on failure.
'use strict';

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const BASE = String(argv.base || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = argv.token || process.env.ASTERIA_TOKEN || '';
const OWNS = !!argv['i-own-this-server'];
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE);

if (!isLocal && !OWNS) {
  console.log('Refusing to run against a remote server.\n');
  console.log('This script deliberately submits saves that claim more than was earned. On a server');
  console.log('with real players that is not a test, it is cheating with extra steps.\n');
  console.log('Point it at a staging build you control, or pass --i-own-this-server if the remote');
  console.log(`host at ${BASE} is genuinely yours and disposable.`);
  process.exit(2);
}
if (!TOKEN) {
  console.log('Need a token for an account on that server: --token=<token>');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  HELD    ' + m); };
const no = m => { fail++; console.log('  LEAKED  ' + m); };

async function api(p, { method = 'GET', body, rev } = {}) {
  const h = { Authorization: 'Bearer ' + TOKEN };
  if (rev !== undefined) h['X-Rev'] = String(rev);
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers: h, body });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { }
  return { status: res.status, json, text: text.slice(0, 200) };
}

const read = async () => {
  const r = await api('/api/save');
  return r.json ? { save: r.json.save, rev: Number(r.json.rev) || 0 } : null;
};

/** Write a candidate save, read back, and say whether the server kept the claim. */
async function probe(label, mutate, detect) {
  const base = await read();
  if (!base || !base.save) { console.log(`  skip    ${label} (no save)`); return; }

  const candidate = JSON.parse(JSON.stringify(base.save));
  mutate(candidate);

  const w = await api('/api/save', { method: 'PUT', body: JSON.stringify(candidate), rev: base.rev });
  const after = await read();
  const kept = after && after.save ? detect(after.save, base.save) : false;

  if (w.status !== 200 && w.status !== 409) {
    console.log(`  ----    ${label}: write rejected with ${w.status} ${w.text}`);
  } else if (kept) {
    no(`${label} - the server kept the inflated claim`);
  } else {
    ok(`${label} - trimmed back to the real value`);
  }

  // Always put the character back, whatever happened.
  const restore = await read();
  if (restore && restore.save && restore.save.lv !== base.save.lv) {
    console.log(`          (restoring: level drifted ${base.save.lv} -> ${restore.save.lv})`);
  }
  await api('/api/save', { method: 'PUT', body: JSON.stringify(base.save), rev: (restore ? restore.rev : base.rev) });
  return { writeStatus: w.status, kept };
}

(async () => {
  console.log(`Asteria save-validation test against ${BASE}`);
  console.log(isLocal ? '(local server)' : '(REMOTE - you asserted you own it)\n');

  const first = await read();
  if (!first || !first.save) {
    console.log('could not read a save for this token; nothing to test');
    console.log(first ? `(HTTP response: ${JSON.stringify(first).slice(0, 200)})` : '');
    process.exit(1);
  }
  console.log(`character: lv ${first.save.lv} ${first.save.job}, ${first.save.coins} copper, ` +
    `${(first.save.bag || []).length} bag items, rev ${first.rev}\n`);
  console.log('case                                   result');

  // ---- the ones that matter for a duplication bug -------------------------
  await probe('coins inflated by 100000',
    s => { s.coins = (s.coins || 0) + 100000; },
    (a, b) => (a.coins || 0) > (b.coins || 0) + 1000);

  await probe('level raised to 99 with no EXP',
    s => { s.lv = 99; s.exp = 0; },
    (a, b) => a.lv > b.lv + 5);

  await probe('status points minted (pts + 5000)',
    s => { s.pts = (s.pts || 0) + 5000; },
    (a, b) => (a.pts || 0) > (b.pts || 0) + 100);

  await probe('skill points minted (skPts + 500)',
    s => { s.skPts = (s.skPts || 0) + 500; },
    (a, b) => (a.skPts || 0) > (b.skPts || 0) + 50);

  await probe('rare materials injected',
    s => { s.materials = Object.assign({}, s.materials, { 'Sunsteel Ore': 9999 }); },
    (a, b) => ((a.materials || {})['Sunsteel Ore'] || 0) > ((b.materials || {})['Sunsteel Ore'] || 0) + 100);

  await probe('weapon refinement forced to +10',
    s => { s.refine = Object.assign({}, s.refine, { [s.equip && s.equip.weapon]: 10 }); },
    (a, b) => {
      const w = a.equip && a.equip.weapon;
      return !!w && ((a.refine || {})[w] || 0) > ((b.refine || {})[w] || 0);
    });

  await probe('maxed skills without the points',
    s => { s.skills = { double_strafe: 10, piercing_shot: 10 }; s.skPts = 0; },
    (a, b) => Object.keys(a.skills || {}).length > Object.keys(b.skills || {}).length + 1);

  // ---- the replay case, which needs a server-side change ------------------
  console.log('\nReplay after a server-side change (the case the revision control cannot stop):');
  console.log('  This one cannot be automated here - it needs a trade or a reward claim between');
  console.log('  the two writes. Do it by hand on staging:');
  console.log('    1. note the character state and revision');
  console.log('    2. perform the trade / claim the reward');
  console.log('    3. PUT the save from step 1 back, carrying the CURRENT revision');
  console.log('    4. if the traded-away item is still there, the trade is not treated as');
  console.log('       irreversible and duplication is possible');

  console.log(`\nresult: ${pass} held, ${fail} leaked`);
  console.log(fail
    ? '\nAt least one claim was kept: the save validation is incomplete, and the cases above are\n' +
      'the list to fix.'
    : '\nEvery inflated claim was trimmed. The save validation is doing its job on these fields.');
})();
