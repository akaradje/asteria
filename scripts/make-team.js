// make-team.js - create (or re-verify) the named bot team.
//
//   node scripts/make-team.js --n=6 --prefix=hoody
//
// Registers real accounts on asteria-online.io and writes team.json with the credentials, so
// the team survives a reinstall and you can sign in to any of them yourself.
//
// Re-running is safe: existing members are only signed into, never re-created.
'use strict';

const path = require('path');
const fs = require('fs');
const { Team, BASE_CLASSES } = require('../src/team');
const api = require('../src/api');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
const COUNT = Math.max(1, Math.min(24, +(argv.n || 6)));
const PREFIX = String(argv.prefix || 'hoody');

(async () => {
  const h = await api.health().catch(() => null);
  console.log(h ? `server: ok, ${h.online} players online, build ${h.build}` : 'server: unreachable');
  if (!h) process.exit(1);

  const team = new Team(ROOT);

  // --claim=username:password adds an account you already have (or one made earlier by hand),
  // instead of registering a new one. Useful when signups are rate-limited.
  if (argv.claim) {
    const raw = String(argv.claim);
    const i = raw.indexOf(':');
    if (i < 1) { console.error('--claim needs username:password'); process.exit(2); }
    const username = raw.slice(0, i), password = raw.slice(i + 1);
    const r = await api.login(username, password);
    if (!r.ok) { console.error(`sign-in failed for ${username}: ${r.error}`); process.exit(1); }
    let m = team.byUsername(username);
    if (!m) {
      const slot = team.members.length ? Math.max(...team.members.map(x => x.slot)) + 1 : 0;
      m = { slot, username, password, kind: 'password', token: r.token, claimedAt: new Date().toISOString() };
      team.members.push(m);
    } else {
      m.password = password; m.token = r.token; m.verifiedAt = new Date().toISOString();
    }
    team.save();
    console.log(`claimed ${username} as slot ${m.slot} -> ${team.file}`);
    console.log(`team now has ${team.members.length} member(s)`);
    return;
  }

  const existing = team.members.length;
  console.log(existing
    ? `team.json already has ${existing} member(s); will verify them and add any missing up to ${COUNT}.`
    : `no team.json yet; creating ${COUNT} account(s) with prefix "${PREFIX}".`);
  console.log('');

  // Provisioning signs in to every member, which costs rate-limit budget. When --only targets
  // specific slots, skip it entirely so the work below gets the whole budget.
  let report = [];
  if (argv.only) {
    console.log(`--only given: skipping the team-wide verification pass.`);
  } else {
    report = await team.provision({
      count: COUNT,
      prefix: PREFIX,
      attempts: Math.max(1, +(argv.attempts || 8)),
      onProgress: r => {
        const tag = r.ok ? 'ok  ' : 'FAIL';
        console.log(`  [${tag}] slot ${String(r.slot).padEnd(2)} ${r.username.padEnd(18)} ${r.action}`);
      },
    });

    const ok = report.filter(r => r.ok).length;
    const failed = report.filter(r => !r.ok);

    console.log(`\n${ok}/${report.length} ready`);
    if (failed.length) {
      console.log('\nFailures:');
      for (const f of failed) console.log(`  slot ${f.slot} ${f.username}: ${f.action}`);
    }
  }

  // One class per member, so a full team covers every class the game offers.
  const wanted = argv.jobs ? String(argv.jobs).split(',').map(s => s.trim()).filter(Boolean) : null;
  if (wanted && wanted.length) {
    const valid = wanted.filter(j => BASE_CLASSES.includes(j));
    const bad = wanted.filter(j => !BASE_CLASSES.includes(j));
    if (bad.length) console.log(`\nignoring unknown class name(s): ${bad.join(', ')}`);
    if (valid.length) team.assignJobs(valid);
  } else {
    team.assignJobs(null);
  }

  // Character names. The game has no rename, so this only affects members that have not
  // created a character yet - set them now or they are permanent.
  const names = argv['char-names'] ? String(argv['char-names']).split(',').map(s => s.trim()) : null;
  team.assignCharNames(names);

  // --create-chars actually makes them (and selects them), which is what the farm will use.
  if (argv['create-chars']) {
    console.log('\nCreating the named characters');
    console.log('============================');
    await team.ensureCharacters({
      slots: argv.only ? String(argv.only).split(',').map(s => +s.trim()).filter(n => Number.isFinite(n)) : null,
      loginAttempts: Math.max(1, +(argv.attempts || 6)),
      onProgress: r => console.log(`  [${r.ok ? 'ok  ' : 'FAIL'}] slot ${String(r.slot).padEnd(2)} ` +
        `${String(r.charName || '-').padEnd(13)} ${r.action}`),
    });
  }

  // Print the credentials so they can be copied straight out of the terminal.
  console.log('\nTeam');
  console.log('====');
  console.log('slot  username            class        character      password');
  console.log('----  ------------------  -----------  -------------  ----------------------');
  for (const m of team.members) {
    console.log(`${String(m.slot).padEnd(4)}  ${m.username.padEnd(18)}  ${String(m.job || '-').padEnd(11)}  ` +
      `${String(m.charName || '-').padEnd(13)}  ${m.password}`);
  }
  const covered = new Set(team.members.map(m => m.job).filter(Boolean));
  console.log(`\n${covered.size}/${BASE_CLASSES.length} base classes covered: ${[...covered].join(', ') || 'none'}`);
  const missing = BASE_CLASSES.filter(c => !covered.has(c));
  if (missing.length) console.log(`missing: ${missing.join(', ')} (add more accounts to cover them)`);
  console.log(`\nwritten to ${team.file}`);
  console.log('These are real accounts - you can sign in with them on the game website too.');
  console.log('Keep the file on this machine; anyone who has it can take the accounts.');
  console.log('\nStart the farm on this team with:  node scripts/run.js --n=' + team.members.length);
})();
