// register-slots.js - register ONLY the named empty slots, never touching live members.
//   node scripts/register-slots.js --slots=4,5 --jobs=knight,priest --names=Stoneguard,Lightmend
// Unlike make-team.js (which signs in every member and would kick running sessions), this
// only registers missing slots, then creates their characters via ensureCharacters.
'use strict';
const path = require('path');
const { Team, generateUsername, generatePassword } = require('../src/team');
const api = require('../src/api');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slots = String(argv.slots || '').split(',').map(Number).filter(Number.isFinite);
const jobs = String(argv.jobs || '').split(',');
const names = String(argv.names || '').split(',');
const isTaken = e => /มีผู้ใช้งูนี้อยู่แล้ว|taken|already/i.test(String(e));
const isRate = e => /บ่อยเกิน|rate|ลองใหม่ภายหลัง/i.test(String(e));

(async () => {
  const h = await api.health().catch(() => null);
  if (!h) { console.error('server unreachable'); process.exit(1); }
  const team = new Team(ROOT);

  for (const slot of slots) {
    if (team.bySlot(slot)) { console.log(`slot ${slot} already has ${team.bySlot(slot).username}`); continue; }
    let username = generateUsername('hoody', slot + 1);
    for (let b = 0; b < 20 && team.byUsername(username); b++) username = generateUsername('hoody', slot + 1 + (b + 1) * 100);
    const password = generatePassword();
    let r = null, attempt = 0, backoff = 30000;
    while (attempt < 6) {
      attempt++;
      r = await api.register(username, password);
      if (r.ok) break;
      if (isTaken(r.error)) { username = generateUsername('hoody', slot + 1 + attempt * 1000); console.log(`slot ${slot}: name taken -> ${username}`); await sleep(1500); continue; }
      console.log(`slot ${slot}: attempt ${attempt} failed (${r.error}); waiting ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      backoff = Math.min(180000, Math.round(backoff * 1.5));
    }
    if (!r || !r.ok) { console.log(`slot ${slot}: STILL RATE-LIMITED, giving up this run`); continue; }
    const i = slots.indexOf(slot);
    team.members.push({ slot, username, password, kind: 'password', token: r.token, job: jobs[i] || null, charName: names[i] || null, createdAt: new Date().toISOString() });
    team.save();
    console.log(`slot ${slot}: REGISTERED ${username} (job ${jobs[i]}, char ${names[i]})`);
    await sleep(2500);
  }
  const fresh = slots.filter(s => team.bySlot(s));
  if (fresh.length) {
    console.log(`creating characters for slots ${fresh.join(',')}`);
    await team.ensureCharacters({ slots: fresh, onProgress: r => console.log(`  [${r.ok ? 'ok' : 'FAIL'}] slot ${r.slot} ${r.charName || '-'} ${r.action}`) });
  }
  console.log(`done. members: ${team.members.length}`);
})().catch(e => { console.error('fatal:', e.message); process.exit(1); });
