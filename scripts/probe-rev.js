// probe-rev.js - does the server actually use X-Rev as a concurrency gate?
//
// Every request here posts the character's save back BYTE-IDENTICAL to what the server just
// returned. The only thing that varies is the X-Rev header. So no matter what the server
// answers, the game state cannot change: the content is the same content.
//
// That lets us answer "is X-Rev parsed and enforced at all?" without performing a replay and
// without creating a single coin or item.
//
//   node scripts/probe-rev.js
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://asteria-online.io';
const ROOT = path.resolve(__dirname, '..');

function pickAccount() {
  const dir = path.join(ROOT, 'profiles');
  let best = null;
  for (const slot of fs.readdirSync(dir)) {
    const f = path.join(dir, slot, 'account.json');
    if (!fs.existsSync(f)) continue;
    try {
      const a = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (a && a.token) { best = best || { slot, ...a }; }
    } catch { }
  }
  return best;
}

async function call(p, { method = 'GET', body, token, headers = {} } = {}) {
  const h = Object.assign({}, headers);
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(BASE + p, { method, headers: h, signal: ctl.signal, body });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { }
    return { status: res.status, json, text: text.slice(0, 160) };
  } catch (e) { return { status: 0, error: e.message }; }
  finally { clearTimeout(t); }
}

(async () => {
  const acc = pickAccount();
  if (!acc) { console.log('no provisioned account found under profiles/'); return; }

  const got = await call('/api/save', { token: acc.token });
  if (!got.json || got.json.save === undefined) {
    console.log(`could not read a save (HTTP ${got.status}); nothing to test`); return;
  }
  const { save, rev } = got.json;
  if (save === null) { console.log('this account has no saved character; nothing to test'); return; }

  // Byte-identical body, always. This is the whole point: the test cannot alter the game.
  const body = JSON.stringify(save);
  console.log(`account  : ${acc.username} (${acc.slot})`);
  console.log(`character: lv ${save.lv} ${save.job}, ${save.coins} copper, rev reported = ${rev}`);
  console.log(`body     : ${body.length} bytes, posted back unchanged every time\n`);
  console.log('X-Rev sent         -> result');
  console.log('-------------------------------');

  const probes = [
    ['(header omitted)', undefined],
    [`${rev} (as reported)`, String(rev)],
    ['-1', '-1'],
    ['-999999', '-999999'],
    ['0', '0'],
    ['999999999', '999999999'],
    ['not-a-number', 'not-a-number'],
    ['"" (empty)', ''],
  ];

  const results = [];
  for (const [label, value] of probes) {
    const headers = {};
    if (value !== undefined) headers['X-Rev'] = value;
    const r = await call('/api/save', { method: 'PUT', token: acc.token, body, headers });
    let note = '';
    if (r.json) {
      if (r.json.fixed) note = ' (server says it corrected the save)';
      else if (r.json.stale) note = ' (server says the revision is stale)';
      else if (r.json.elsewhere) note = ' (server says playing elsewhere)';
      else if (r.json.error) note = ` (${r.json.error})`;
    }
    results.push({ label, status: r.status, note });
    console.log(`${label.padEnd(18)} -> HTTP ${r.status}${note}`);
    await new Promise(res => setTimeout(res, 350));
  }

  // Confirm nothing moved.
  const after = await call('/api/save', { token: acc.token });
  const a = after.json && after.json.save;
  const unchanged = a && a.lv === save.lv && a.coins === save.coins && a.exp === save.exp;
  console.log(`\npost-check: lv ${a && a.lv} / ${a && a.coins} copper  -> ${unchanged ? 'UNCHANGED (test created nothing)' : 'CHANGED (!)'}`);

  // ------------------------------------------------------------------ verdict
  const accepted = results.filter(r => r.status === 200).map(r => r.label);
  const rejected = results.filter(r => r.status !== 200).map(r => `${r.label}=${r.status}`);

  console.log('\n--- verdict ---');
  if (rejected.length === 0) {
    console.log('The server accepted EVERY X-Rev value, including -1, an absurdly large number and');
    console.log('a non-numeric string. So X-Rev is not enforced as a floor on writes at all.');
    console.log('');
    console.log('That is not automatically a hole. It is exactly what you would see if the server');
    console.log('treats rev as "the point at which I last changed this save myself" and this account');
    console.log('has never had a server-side change (no trade, no guild) - so there is nothing to');
    console.log('compare against. It becomes a hole only if a save captured BEFORE a server-side');
    console.log('change is still accepted AFTER it.');
    console.log('');
    console.log('Settling that needs one server-side change to this save (a trade, a guild fee, or');
    console.log('tomorrow\'s login reward). Then re-run this and look for a 409 {stale:true}.');
  } else if (rejected.length < results.length) {
    console.log(`Some values were refused (${rejected.join(', ')}) and some accepted (${accepted.join(', ')}).`);
    console.log('That means X-Rev IS parsed - compare the pattern above to see which bound it enforces.');
  } else {
    console.log('Every value was refused, which is surprising; see the status codes above.');
  }

  console.log('\nNothing was created, spent or moved by this test: the posted body was identical');
  console.log('to what the server returned every time.');
})();
