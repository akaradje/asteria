// probe-chores.js - do the town chores actually work on a live character?
//
// Runs each piece of runTownChores() separately so a failure names the piece rather than the
// pass, and reports what the SERVER said afterwards.
//
//   node scripts/probe-chores.js [--slot=0] [--dry] [--only=daily,pet,guild,equip]
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
const SLOT = +(argv.slot || 0);
const DRY = !!argv.dry;
const ONLY = argv.only ? String(argv.only).split(',') : ['daily', 'pet', 'guild', 'equip', 'economy', 'tower', 'wing', 'exchange', 'refine'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const want = k => ONLY.includes(k);

(async () => {
  const h = await api.health().catch(() => null);
  console.log(`server: ${h ? `${h.online} online, build ${h.build}` : 'unreachable'}`);
  const cache = new AssetCache(ROOT, (h && h.build) || 'unversioned');
  const team = new Team(ROOT);
  const cred = team.bySlot(SLOT);
  if (!cred) { console.error(`no team member in slot ${SLOT}`); process.exit(1); }
  const roster = team.members.map(m => ({ charName: m.charName, job: m.job }));
  console.log(`slot ${SLOT}: ${cred.charName} (${cred.job}) | roster: ${roster.map(r => r.charName).join(', ')}\n`);

  const inst = new GameInstance({
    slot: SLOT, root: ROOT, headless: true, noDraw: true, credentials: cred, roster,
    framesDir: null, cache,
    log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} ${m}`),
  });

  const before = {};
  try {
    await inst.start();
    const s0 = inst.lastSave || {};
    console.log(`in world: ${s0.job} Lv ${s0.lv}, ${(s0.coins || 0).toLocaleString()} Copper, bag ${(s0.bag || []).length}, potions ${s0.potions}`);

    const town = await inst.returnToTown();
    console.log('returnToTown:', JSON.stringify(town));
    if (!town.ok) { console.error('! not in town; the chores need town services'); process.exit(2); }
    await sleep(1500);

    // --- dailies -------------------------------------------------------------
    if (want('daily')) {
      console.log('\n=== daily quests ===');
      await inst.openGamePanel('daily');
      const txt = await inst.panelText();
      console.log('panel:', JSON.stringify(txt.replace(/\s+/g, ' ').slice(0, 300)));
      const buttons = await inst.eval(`(() => Array.from(document.querySelectorAll('#pBody [data-daily]')).map(b => ({ i: b.dataset.daily, disabled: !!b.disabled, text: (b.innerText||'').trim().slice(0,40) })))()`);
      console.log('claim buttons:', JSON.stringify(buttons));
      await inst.closeGamePanel();
      if (!DRY) console.log('claimDailies ->', JSON.stringify(await inst.claimDailies()));
    }

    // --- pets ----------------------------------------------------------------
    if (want('pet')) {
      console.log('\n=== pets ===');
      await inst.openGamePanel('collection');
      await sleep(600);
      const pets = await inst.eval(`(() => Array.from(document.querySelectorAll('#pBody [data-pet]')).map(b => ({ id: b.dataset.pet, disabled: !!b.disabled, text: (b.innerText||'').trim().slice(0,30) })))()`);
      console.log(`pet buttons: ${(pets || []).length}`, JSON.stringify((pets || []).slice(0, 6)));
      await inst.closeGamePanel();
      if (!DRY) console.log('wearBestPet ->', JSON.stringify(await inst.wearBestPet()));
    }

    // --- guild donation ------------------------------------------------------
    if (want('guild')) {
      console.log('\n=== guild donation ===');
      console.log('dry-run list ->', JSON.stringify(await inst.donateToGuild({ dryRun: true })));
      const g0 = await inst.guildState();
      console.log('guild before:', JSON.stringify(g0 && { name: g0.name, funds: g0.funds, total: g0.total, lv: g0.lv }));
      if (!DRY) {
        console.log('donateToGuild ->', JSON.stringify(await inst.donateToGuild()));
        await sleep(2000);
        const g1 = await inst.guildState();
        console.log('guild after: ', JSON.stringify(g1 && { name: g1.name, funds: g1.funds, total: g1.total, lv: g1.lv }));
      }
    }

    // --- equip ---------------------------------------------------------------
    if (want('equip')) {
      console.log('\n=== equip upgrades ===');
      const plan = await inst.planBag(roster);
      console.log(`plan says equip ${plan.equip.length}:`, JSON.stringify(plan.equip.slice(0, 5)));
      console.log('worn before:', JSON.stringify((inst.lastSave || {}).equip));
      if (!DRY && plan.equip.length) {
        console.log('equipItems ->', JSON.stringify(await inst.equipItems(plan.equip)));
        await sleep(1500);
        console.log('worn after: ', JSON.stringify((inst.lastSave || {}).equip));
      }
    }

    // --- economy -------------------------------------------------------------
    if (want('economy')) {
      console.log('\n=== economy (sell / stash / buy) ===');
      const c0 = (inst.lastSave || {}).coins || 0;
      const n0 = ((inst.lastSave || {}).bag || []).length;
      if (DRY) {
        const plan = await inst.planBag(roster);
        console.log(`dry: sell ${plan.sell.length} (${plan.sellCoins} Copper), store ${plan.store.length}, give ${plan.give.length}`);
      } else {
        const r = await inst.runEconomy({ roster });
        console.log('runEconomy ->', JSON.stringify(r));
        await sleep(2000);
        const c1 = (inst.lastSave || {}).coins || 0;
        const n1 = ((inst.lastSave || {}).bag || []).length;
        console.log(`coins ${c0.toLocaleString()} -> ${c1.toLocaleString()} (+${(c1 - c0).toLocaleString()}), bag ${n0} -> ${n1}`);
      }
    }
    // --- refine --------------------------------------------------------------
    if (want('refine')) {
      console.log('\n=== refine (smith) ===');
      const save = inst.lastSave || {};
      console.log('worn refine levels:', JSON.stringify(save.refine || {}));
      const dry = await inst.refineEquipped({ dryRun: true });
      console.log('doable now:', JSON.stringify((dry.doable || []).map(s => `${s.slot} ${s.from}->${s.to} ${s.chancePct}% ${s.coinCost}c ${s.oreName}x${s.oreNeed}`)));
      console.log('blocked by ore:', JSON.stringify(dry.blockedByOre));
      if (!DRY) {
        const c0 = save.coins || 0;
        const r = await inst.refineEquipped();
        console.log('refineEquipped ->', JSON.stringify(r));
        await sleep(1500);
        console.log('coins', c0, '->', (inst.lastSave || {}).coins);
        console.log('refine after:', JSON.stringify((inst.lastSave || {}).refine || {}));
      }
    }

    // --- tower ---------------------------------------------------------------
    if (want('tower')) {
      console.log('\n=== Asteria Tower (open every day, 1-6 players) ===');
      const st = await inst.towerState();
      console.log('tower state:', JSON.stringify(st));
      console.log('openTowerPanel:', JSON.stringify(await inst.openTowerPanel()));
      await sleep(700);
      const t = await inst.panelText();
      console.log('panel:', JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 400)));
      const starts = await inst.eval(`(() => Array.from(document.querySelectorAll('#pBody [data-tw-from]')).map(b => ({ from: b.dataset.twFrom, on: b.classList.contains('on') })))()`);
      console.log('floor pickers:', JSON.stringify(starts));
      await inst.closeGamePanel();
    }

    // --- wing ----------------------------------------------------------------
    if (want('wing')) {
      console.log('\n=== wing target ===');
      const wp = await inst.wingPlan();
      if (!wp) console.log('no wing line for this class');
      else {
        console.log(`${wp.name} (tier ${wp.tier}) | coins ${wp.coinsHave.toLocaleString()}/${wp.coinsNeeded.toLocaleString()} (short ${wp.coinsShort.toLocaleString()}) | craftable=${wp.craftable}`);
        console.log('bill:', JSON.stringify(wp.needs));
        for (const m of wp.missing.slice(0, 6)) {
          console.log(`  missing ${String(m.name).padEnd(18)} ${m.have}/${m.want}  <- ${(m.sources[0] && (m.sources[0].monster + ' (' + m.sources[0].rate + '%)')) || 'unknown source'}`);
        }
      }
    }

    // --- exchange ------------------------------------------------------------
    if (want('exchange')) {
      console.log('\n=== exchange merchant ===');
      const ex = await inst.readExchange();
      console.log(`recipes listed: ${(ex.rows || []).length}, ready: ${(ex.rows || []).filter(r => r.ready).length}`);
      for (const r of (ex.rows || []).filter(r => r.ready).slice(0, 6)) console.log('  READY:', r.text);
      for (const r of (ex.rows || []).filter(r => !r.ready).slice(0, 3)) console.log('  not ready:', r.text);
    }
  } catch (e) {
    console.error('failed:', e.message);
  } finally {
    try { await inst.stop(); } catch { }
    console.log('\ndone.');
    process.exit(0);
  }
})();
