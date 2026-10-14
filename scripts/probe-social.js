// probe-social.js - prove the party path end to end, with two real windows.
//
// Everything the user asked for socially (party, guild, dungeon, trade, pets) rides on one
// socket command - window.AsteriaNet.social(kind, data). This boots two named accounts, has
// one invite the other, has the other accept, and then prints what the SERVER replied rather
// than what we hoped it would reply.
//
// It deliberately does NOT found a guild: that charges a fee on the server, and spending the
// player's coins is a decision for the player. It opens the guild tab and reports what it says
// the fee is instead.
//
//   node scripts/probe-social.js [--a=4] [--b=5] [--secs=40]
'use strict';

const path = require('path');
const { GameInstance } = require('../src/instance');
const { AssetCache } = require('../src/assetcache');
const { Team } = require('../src/team');
const api = require('../src/api');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
const SLOT_A = +(argv.a || 4);
const SLOT_B = +(argv.b || 5);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await api.health().catch(() => null);
  console.log(`server: ${h ? `${h.online} online, build ${h.build}` : 'unreachable'}`);
  const cache = new AssetCache(ROOT, (h && h.build) || 'unversioned');

  const team = new Team(ROOT);
  const ca = team.bySlot(SLOT_A), cb = team.bySlot(SLOT_B);
  if (!ca || !cb) { console.error(`team.json has no member in slot ${SLOT_A} or ${SLOT_B}`); process.exit(1); }
  console.log(`A: slot ${SLOT_A} ${ca.username} / "${ca.charName}"`);
  console.log(`B: slot ${SLOT_B} ${cb.username} / "${cb.charName}"\n`);

  const mk = (slot, cred) => new GameInstance({
    slot, root: ROOT, headless: true, noDraw: true, credentials: cred,
    framesDir: null, cache,
    log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} [${slot}] ${m}`),
  });

  const A = mk(SLOT_A, ca), B = mk(SLOT_B, cb);
  const out = {};

  try {
    console.log('--- boot ---');
    await A.start();
    console.log(`A in world: ${A.lastSave?.job} lv ${A.lastSave?.lv}`);
    await sleep(4000);
    await B.start();
    console.log(`B in world: ${B.lastSave?.job} lv ${B.lastSave?.lv}`);

    // Both windows must have their own socket up before any of this means anything.
    const onA = await A.socialOnline(), onB = await B.socialOnline();
    console.log(`\nsocket: A=${onA} B=${onB}`);
    if (!onA || !onB) { console.error('a window is not connected; aborting'); process.exit(2); }

    // Clear the buffers so we only read frames from this test.
    const t0 = Date.now();
    await A.eval(`(() => { if (window.__afTap) window.__afTap.frames.length = 0; return true; })()`);
    await B.eval(`(() => { if (window.__afTap) window.__afTap.frames.length = 0; return true; })()`);

    console.log('\n--- A invites B (pinv by character name) ---');
    console.log('A send:', JSON.stringify(await A.partyInvite(cb.charName)));
    await sleep(2500);

    const seen = await B.socialFrames('pinvite', t0);
    console.log(`B received ${seen.length} pinvite frame(s):`, JSON.stringify(seen));

    console.log('\n--- B accepts (pans {from, ok}) ---');
    console.log('B send:', JSON.stringify(await B.partyAcceptPending(t0)));
    await sleep(2500);

    console.log('\n--- what the SERVER says the party is ---');
    const pa = await A.partyState(), pb = await B.partyState();
    out.partyA = pa; out.partyB = pb;
    for (const [who, p] of [['A', pa], ['B', pb]]) {
      if (!p) { console.log(`${who}: no party frame`); continue; }
      const members = (p.members || []).map(m => `${m.name || m.n || m.aid}${m.aid === p.leader ? ' (leader)' : ''}`);
      console.log(`${who}: id=${p.id} leader=${p.leader} members(${(p.members || []).length})= ${members.join(', ')}`);
    }

    const both = pa && pb && (pa.members || []).length === 2 && (pb.members || []).length === 2;
    console.log(`\nVERDICT: party of two formed in both windows = ${both ? 'YES' : 'NO'}`);

    console.log('\n--- panel path (no NPC, no raycast) ---');
    console.log('A openGamePanel(social):', JSON.stringify(await A.openGamePanel('social')));
    const socText = await A.panelText();
    console.log('A social panel text:', JSON.stringify(socText.replace(/\s+/g, ' ').slice(0, 260)));
    // The guild tab is where the founding fee is stated; report it, do not pay it.
    await A.eval(`(() => { const b = document.querySelector('#pBody [data-soc-tab="guild"]'); if (b) b.click(); return true; })()`);
    await sleep(600);
    const guildText = await A.panelText();
    console.log('A guild tab text:', JSON.stringify(guildText.replace(/\s+/g, ' ').slice(0, 300)));
    await A.closeGamePanel();

    console.log('\n--- dungeon state (dgq -> "dg") ---');
    await A.queryDungeons();
    await sleep(2000);
    const dg = await A.socialFrames('dg', t0);
    for (const f of dg) console.log('dg frame:', JSON.stringify(f).slice(0, 700));

    console.log('\n--- pet list (prq) ---');
    await A.queryPets();
    await sleep(2000);
    const all2 = await A.socialFrames(null, t0);
    const types2 = [...new Set(all2.map(f => f.t))];
    console.log('frame types now seen:', types2.join(' '));
    for (const t of types2) {
      if (/pet|pr/i.test(t)) for (const f of all2.filter(x => x.t === t)) console.log(`${t} frame:`, JSON.stringify(f).slice(0, 500));
    }

    console.log('\n--- all frame types seen in this window ---');
    const all = await A.socialFrames(null, t0);
    const counts = {};
    for (const f of all) counts[f.t] = (counts[f.t] || 0) + 1;
    console.log(JSON.stringify(counts));
  } catch (e) {
    console.error('probe failed:', e.message);
  } finally {
    // Leave the party first so neither account is left in a group.
    try { await A.partyLeave(); } catch { }
    await sleep(500);
    try { await A.stop(); } catch { }
    try { await B.stop(); } catch { }
    console.log('\ndone.');
    process.exit(0);
  }
})();
