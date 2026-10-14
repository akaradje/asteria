// audit-api.js - a repeatable, non-destructive security check of the Asteria API.
//
// Scope: only the checks that can be made from the client side, using accounts you already
// own. It never touches another player's data and never writes anything that changes game
// state (the one write it performs posts a byte-identical save back, to test the revision
// control). Nothing here attempts to exploit anything - it verifies whether the defences
// that should be there actually are.
//
//   node scripts/audit-api.js
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://asteria-online.io';
const ROOT = path.resolve(__dirname, '..');

let pass = 0, warn = 0, fail = 0, info = 0;
const ok = m => { pass++; console.log('  PASS  ' + m); };
const no = m => { fail++; console.log('  FAIL  ' + m); };
const wr = m => { warn++; console.log('  WARN  ' + m); };
const note = m => { info++; console.log('  ----  ' + m); };

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const h = Object.assign({}, headers);
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(BASE + path, {
      method, headers: h, signal: ctl.signal,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: res.status, json, text, headers: Object.fromEntries(res.headers) };
  } catch (e) {
    return { status: 0, error: e.message };
  } finally { clearTimeout(t); }
}

/** Load the accounts this machine has already provisioned. */
function loadAccounts() {
  const dir = path.join(ROOT, 'profiles');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const slot of fs.readdirSync(dir)) {
    const f = path.join(dir, slot, 'account.json');
    if (!fs.existsSync(f)) continue;
    try {
      const a = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (a && a.token) out.push({ slot, token: a.token, username: a.username });
    } catch { }
  }
  return out;
}

(async () => {
  console.log('Asteria API security audit - ' + new Date().toISOString());
  console.log('target: ' + BASE + '\n');

  // ---------------------------------------------------------------- 1. auth required
  console.log('1. Authentication is required on character endpoints');
  for (const p of ['/api/me', '/api/chars', '/api/save']) {
    const r = await call(p);
    if (r.status === 401 || r.status === 403) ok(`${p} without a token -> ${r.status}`);
    else if (r.status === 200) no(`${p} answered ${r.status} WITHOUT a token`);
    else note(`${p} without a token -> ${r.status} (expected 401)`);
  }

  // ---------------------------------------------------------------- 2. bogus token
  console.log('\n2. A forged token is rejected');
  {
    const r = await call('/api/me', { token: 'f'.repeat(64) });
    if (r.status === 401 || r.status === 403) ok(`forged token -> ${r.status}`);
    else no(`forged token -> ${r.status} (expected 401/403)`);
  }

  // ---------------------------------------------------------------- 3. cross-account isolation
  console.log('\n3. One account cannot read another account\'s character (X-Char scoping)');
  const accounts = loadAccounts();
  if (accounts.length < 2) {
    note(`only ${accounts.length} account(s) found under profiles/ - need two to test isolation`);
  } else {
    const [A, B] = accounts;
    const ca = await call('/api/chars', { token: A.token });
    const cb = await call('/api/chars', { token: B.token });
    const charA = ca.json && ca.json.chars && ca.json.chars[0];
    const charB = cb.json && cb.json.chars && cb.json.chars[0];
    if (!charA || !charB) {
      note('could not resolve a character for each account; skipping');
    } else {
      note(`A = ${A.username} char ${charA.id} (${charA.name}) | B = ${B.username} char ${charB.id} (${charB.name})`);
      // Ask for A's save while claiming B's character id.
      const cross = await call('/api/save', { token: A.token, headers: { 'X-Char': String(charB.id) } });
      const own = await call('/api/save', { token: A.token, headers: { 'X-Char': String(charA.id) } });
      const crossLv = cross.json && cross.json.save ? cross.json.save.lv : null;
      const ownLv = own.json && own.json.save ? own.json.save.lv : null;
      if (cross.status !== 200) ok(`A + X-Char(B) -> ${cross.status} (refused)`);
      else if (crossLv === ownLv) ok(`A + X-Char(B) returned A's own character (lv ${crossLv}), not B's (lv ${charB.lv}) - header is not trusted for ownership`);
      else no(`A + X-Char(B) returned lv ${crossLv} while A's own is lv ${ownLv} - possible cross-account read`);
    }
  }

  // ---------------------------------------------------------------- 4. revision control
  console.log('\n4. Save revision control (is X-Rev actually enforced?)');
  {
    // Post the save back BYTE-IDENTICAL and vary only the header, so no answer can change the
    // game. Anything below the server's revision should be refused with 409 {stale:true}.
    const revs = [];
    for (const acc of accounts) {
      const r = await call('/api/save', { token: acc.token });
      if (r.json && r.json.save) revs.push({ acc, rev: Number(r.json.rev) || 0, lv: r.json.save.lv, save: r.json.save });
    }
    if (!revs.length) {
      note('no account has a saved character; skipping');
    } else {
      note(`reported revisions: ${revs.map(x => `${x.acc.username}(lv ${x.lv}) rev ${x.rev}`).join(', ')}`);
      const target = revs.find(x => x.lv > 5) || revs[0];
      const body = JSON.stringify(target.save);
      note(`testing with ${target.acc.username}; the posted body is identical to what the server returned`);

      const probes = [
        ['omitted', undefined],
        [String(target.rev), String(target.rev)],
        ['-1', '-1'],
        ['-999999', '-999999'],
        ['not-a-number', 'not-a-number'],
        ['999999999', '999999999'],
      ];
      const seen = [];
      for (const [label, value] of probes) {
        const headers = {};
        if (value !== undefined) headers['X-Rev'] = value;
        const r = await call('/api/save', { method: 'PUT', token: target.acc.token, body, headers });
        seen.push({ label, status: r.status, stale: !!(r.json && r.json.stale) });
        await new Promise(res => setTimeout(res, 300));
      }
      for (const s of seen) console.log(`        X-Rev ${s.label.padEnd(14)} -> ${s.status}${s.stale ? ' {stale}' : ''}`);

      const below = seen.filter(s => s.label === '-1' || s.label === '-999999' || s.label === 'not-a-number');
      const refusedBelow = below.every(s => s.status === 409);
      const acceptsCurrent = seen.find(s => s.label === String(target.rev));
      if (refusedBelow) ok('revisions below the server\'s are refused with 409 {stale:true} - the control is real and enforced');
      else wr('a revision below the server\'s was NOT refused - the staleness check is not enforced');
      if (acceptsCurrent && acceptsCurrent.status === 200) ok('the current revision is accepted - normal saves work');

      const absurd = seen.find(s => s.label === '999999999');
      if (absurd && absurd.status === 200) {
        note('an arbitrarily high revision is accepted, so this is a floor, not an exact match.');
        note('  That is correct for its purpose (stopping an honest but stale client), but it means');
        note('  the revision is NOT what stops a deliberate replay - the save trim is. Ask the');
        note('  developer whether a traded-away item is treated as irreversible when a later save');
        note('  still contains it.');
      }

      const after = await call('/api/save', { token: target.acc.token });
      const a = after.json && after.json.save;
      if (a && a.lv === target.save.lv && a.coins === target.save.coins) {
        ok('post-check: the character is unchanged - this test created, spent and moved nothing');
      } else {
        no('post-check: the character CHANGED during a test that was supposed to be a no-op');
      }
    }
  }

  // ---------------------------------------------------------------- 5. unauthenticated endpoints
  console.log('\n5. Unauthenticated endpoints disclose only what they should');
  {
    const h = await call('/api/health');
    if (h.json && h.json.ok) {
      note(`/api/health -> ${JSON.stringify(h.json)}`);
      if ('build' in h.json || 'runs' in h.json) note('  (build hash and restart count are minor internal detail; harmless but useful to an attacker for fingerprinting)');
    }
    const c = await call('/api/config');
    note(`/api/config -> ${JSON.stringify(c.json)} (a Google client id is public by design)`);
  }

  // ---------------------------------------------------------------- 6. guest account creation
  console.log('\n6. Guest account creation');
  note('POST /api/guest is unauthenticated and returns a working account by design.');
  note('This audit does NOT create accounts to test rate limiting - check it server-side instead.');

  console.log(`\nsummary: ${pass} pass, ${warn} warn, ${fail} fail, ${info} informational`);
  console.log('\nWhat this script cannot check from the outside (audit these in the server):');
  console.log('  * whether reported damage is validated against the character\'s stats');
  console.log('  * whether reported positions are validated for speed/teleport');
  console.log('  * how the "trim" on /api/save decides what was earned');
  console.log('  * rate limits on /api/guest, /api/login and /api/save');
  console.log('  * ownership checks on the write path (only the read path was tested here)');
})();
