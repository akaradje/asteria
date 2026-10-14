// probe-economy.js - what would the item brain actually do with a real character's bag?
//
// Dry run by default: it boots one character, reads the server's save, and prints the plan.
// With --live it performs the sell and the stash for real, so the DOM path is exercised too.
//
//   node scripts/probe-economy.js [--slot=0] [--live]
'use strict';

const path = require('path');
const { GameInstance } = require('../src/instance');
const { AssetCache } = require('../src/assetcache');
const { Team } = require('../src/team');
const api = require('../src/api');
const eco = require('../src/economy');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ROOT = path.resolve(__dirname, '..');
const SLOT = +(argv.slot || 0);
const LIVE = !!argv.live;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await api.health().catch(() => null);
  console.log(`server: ${h ? `${h.online} online, build ${h.build}` : 'unreachable'}`);
  const cache = new AssetCache(ROOT, (h && h.build) || 'unversioned');

  const team = new Team(ROOT);
  const cred = team.bySlot(SLOT);
  if (!cred) { console.error(`no team member in slot ${SLOT}`); process.exit(1); }
  console.log(`slot ${SLOT}: ${cred.username} / "${cred.charName}" (${cred.job})\n`);

  const inst = new GameInstance({
    slot: SLOT, root: ROOT, headless: true, noDraw: true, credentials: cred,
    framesDir: null, cache,
    log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} ${m}`),
  });

  try {
    await inst.start();
    const b = await inst.belongings();
    console.log(`in world: ${b.job} Lv ${b.lv}, ${b.coins.toLocaleString()} Copper`);
    console.log(`bag: ${b.bag.length} item(s), equipped slots: ${Object.keys(b.equip).join(', ') || 'none'}`);

    const save = inst.lastSave || {};
    console.log(`materials: ${Object.keys(save.materials || {}).length} kind(s): ${Object.keys(save.materials || {}).slice(0, 8).join(', ')}`);
    console.log('\nraw bag:');
    for (const it of b.bag.slice(0, 12)) console.log('  ', JSON.stringify(it));
    if (b.bag.length > 12) console.log(`   ... and ${b.bag.length - 12} more`);

    const cat = inst.catalog();
    console.log(`\ncatalog: ${Object.keys(cat.items).length} items from build ${cat.build}`);
    console.log(`equipped: ${JSON.stringify(b.equip)}`);

    // The roster lets the planner decide "this is not mine, but it IS ExampleAccount4's".
    const roster = team.members.map(m => ({ charName: m.charName, job: m.job, lv: 99 }));
    const plan = await inst.planBag(roster);
    console.log('\n--- plan ---');
    for (const k of ['equip', 'give', 'store', 'sell']) {
      console.log(`${k} (${plan[k].length}):`);
      for (const x of plan[k].slice(0, 8)) {
        console.log(`   ${String(x.name).padEnd(22)} ${String(x.rarity || '').padEnd(10)} ${x.to ? '-> ' + x.to : ''} ${x.score !== undefined ? 'score ' + x.score : ''}`);
      }
      if (plan[k].length > 8) console.log(`   ... and ${plan[k].length - 8} more`);
    }
    console.log(`sell would yield: ${plan.sellCoins.toLocaleString()} Copper`);

    const ups = eco.shopUpgrades({ job: b.job, lv: b.lv, coins: b.coins, world: cat.world, items: cat.items });
    console.log(`\nshop upgrades affordable now (${ups.length}):`);
    for (const u of ups.slice(0, 5)) console.log(`   ${u.name.padEnd(22)} ${u.slot.padEnd(8)} tier${u.tier} ${String(u.price).padStart(7)}c score ${u.score}`);

    console.log(`\nnext bag page: ${JSON.stringify(eco.nextBagPage(cat.world, save.bagPage || 0))}`);

    if (LIVE) {
      console.log('\n--- LIVE: walk back to town first (the shop is a town service) ---');
      const town = await inst.returnToTown();
      console.log('returnToTown:', JSON.stringify(town));
      if (!town.ok) console.log('! could not reach town - sell would be a no-op, stopping here');
      console.log('\n--- LIVE: selling what the plan says to sell ---');
      const r = await inst.sellItems(plan.sell);
      console.log('sell result:', JSON.stringify(r));
      await sleep(1500);
      const b2 = await inst.belongings();
      console.log(`bag after: ${b2.bag.length} item(s), coins ${b2.coins.toLocaleString()} (was ${b.coins.toLocaleString()})`);
    } else {
      console.log('\n(dry run - pass --live to actually sell)');
    }
  } catch (e) {
    console.error('failed:', e.message);
  } finally {
    try { await inst.stop(); } catch { }
    console.log('\ndone.');
    process.exit(0);
  }
})();
