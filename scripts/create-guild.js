// create-guild.js - found the guild, once.
//
// Guild creation is a one-off, irreversible spend (30,000 Copper, Lv 20+, from
// AsteriaWorld.GUILD), so it does NOT live in the supervisor's loop the way party formation
// does. Run this deliberately; after it succeeds the supervisor only invites members.
//
//   node scripts/create-guild.js [--name="ExampleGuild"] [--slot=0]
'use strict';

const path = require('path');
const fs = require('fs');
const { GameInstance } = require('../src/instance');
const { AssetCache } = require('../src/assetcache');
const { Team } = require('../src/team');
const api = require('../src/api');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
let guildGoal = {};
try { guildGoal = JSON.parse(fs.readFileSync(path.join(ROOT, 'machines/guild-goal.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const NAME = String(argv.name || guildGoal.name || 'ExampleGuild');
const SLOT = +(argv.slot || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// From AsteriaWorld.GUILD - read out of the shipped client, not guessed.
const CREATE_LV = 20, CREATE_COST = 30000;

(async () => {
  const h = await api.health().catch(() => null);
  console.log(`server: ${h ? `${h.online} online, build ${h.build}` : 'unreachable'}`);
  const cache = new AssetCache(ROOT, (h && h.build) || 'unversioned');

  const team = new Team(ROOT);
  const cred = team.bySlot(SLOT);
  if (!cred) { console.error(`no team member in slot ${SLOT}`); process.exit(1); }
  console.log(`founder: slot ${SLOT} "${cred.charName}"`);
  console.log(`name: "${NAME}" (${[...NAME].length} chars, the client allows 2-16)\n`);

  const inst = new GameInstance({
    slot: SLOT, root: ROOT, headless: true, noDraw: true, credentials: cred,
    framesDir: null, cache,
    log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} ${m}`),
  });

  try {
    await inst.start();
    const save = inst.lastSave || {};
    console.log(`\nin world: ${save.job} Lv ${save.lv}, ${save.coins} Copper`);

    // Check the requirements before spending anything, using the server's own numbers.
    if ((save.lv || 0) < CREATE_LV) {
      console.error(`need Lv ${CREATE_LV}+ to found a guild, this character is Lv ${save.lv}`);
      process.exit(2);
    }
    if ((save.coins || 0) < CREATE_COST) {
      console.error(`need ${CREATE_COST.toLocaleString()} Copper, this character has ${(save.coins || 0).toLocaleString()}`);
      process.exit(2);
    }

    const before = await inst.guildState();
    if (before && before.id) {
      console.log(`already in a guild: "${before.name}" (id ${before.id}) - nothing to do`);
      process.exit(0);
    }

    // Confirm the panel agrees before sending, so a refusal is explained rather than silent.
    await inst.openGamePanel('social');
    await inst.eval(`(() => { const b = document.querySelector('#pBody [data-soc-tab="guild"]'); if (b) b.click(); return true; })()`);
    await sleep(700);
    const txt = await inst.panelText();
    console.log('guild tab says:', JSON.stringify(txt.replace(/\s+/g, ' ').slice(-220)));
    await inst.closeGamePanel();

    const t0 = Date.now();
    console.log(`\nsending gcreate {name:"${NAME}"} ...`);
    console.log('send:', JSON.stringify(await inst.guildCreate(NAME)));

    // Wait for the server to answer: `guild` (joined) or `gcreated` (founded, fee charged).
    let created = null, guild = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      created = (await inst.socialFrames('gcreated', t0)).pop() || null;
      guild = await inst.guildState();
      if (created || guild) break;
    }

    console.log('gcreated frame:', JSON.stringify(created));
    if (guild) {
      console.log(`\nguild: id=${guild.id} name="${guild.name}" members=${(guild.members || []).length}`);
      console.log('full guild frame:', JSON.stringify(guild).slice(0, 500));
    } else {
      console.log('\nno guild frame came back - the server did not create it');
    }
    const after = await inst.socialLast('guild');
    console.log('\nlast guild frame:', JSON.stringify(after).slice(0, 400));
    console.log(`\nVERDICT: guild founded = ${guild && guild.id ? 'YES' : 'NO'}`);
  } catch (e) {
    console.error('failed:', e.message);
  } finally {
    try { await inst.stop(); } catch { }
    console.log('done.');
    process.exit(0);
  }
})();
