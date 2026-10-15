'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const rules = require('../src/knowledge/pet-option-rules'), planner = require('../src/planning/active-pet');
const build = JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build;
const raw = fs.readFileSync('cache/' + build + '/asteria-online.io/asteria-online-visual-polish.html', 'utf8');
const native = rules.extract(raw); assert(native.complete); assert.equal(native.actionsEnabled, false);
assert.deepEqual(native.pools.map(p => p.length), [11, 15, 5]);
const changedRow = "{ k: 'atk', w: 14, per: [2, 3, 4, 6, 8] }", nextRow = "{ k: 'atk', w: 14, per: [2, 3, 9, 6, 8] }";
assert(rules.extract(raw.replace(changedRow, nextRow)).complete, 'unrelated earlier weapon pool does not invalidate pet data');
const at = raw.indexOf('  const ENCH_PET = [');
const changedPool=rules.extract(raw.slice(0,at)+raw.slice(at).replace(changedRow,nextRow)); assert(changedPool.complete); assert.notEqual(changedPool.revision,native.revision); assert.equal(changedPool.pools[0][0].per[2],9);
assert(rules.extract(raw.replace('const ENCH_STEP_W = [36, 28, 20, 11, 5]', 'const ENCH_STEP_W = [36, 28, 20, 10, 6]')).complete,'new finite native star distribution is data, not execution approval');
for (const change of [
  raw.replace('const ENCH_PET_TIER = lv =>', 'const changedTier = lv =>'),
  raw.replace('const ENCH_STEP_W = [36, 28, 20, 11, 5]', 'const ENCH_STEP_W = [36, 28, 20, 11, -5]'),
  raw.replace('enchAdd(petOpts[player.petActive]);', 'enchAdd(petOpts.other);'),
  raw + '\n  const ENCH_PET = [', raw.replace('  const ENCH_PET = [', '  const ENCH_PET = globalThis.badCode() || [')])
  assert(!rules.extract(change).complete, 'unknown or executable pool changes never retain old approval');
assert.equal(globalThis.badCode, undefined);
const opts = [{k: 'atk', s: 5, v: 20}, {k: 'atk', s: 5, v: 20}, {k: 'bossDmg', s: 5, v: .1}];
const actual = rules.stats(opts, 55, native); assert(actual.complete); assert.equal(actual.PvEOnly, true);
assert.deepEqual(actual.stats, {atk: 40, bossDmg: .1}); assert.equal(actual.measuredBenefit, false);
for (const mutate of [a => a[0].s = 6, a => a[0].v = 999, a => a[0].k = 'adminPower',
  a => a[0].v = -20, a => a[0].s = 1.5, a => a.push(opts[0])]) {
  const a = structuredClone(opts); mutate(a); assert(!rules.stats(a, 55, native).complete);
}
assert(!rules.stats(opts, 80, native).complete, 'tier-sensitive numeric values must match current native tier');
assert(!rules.stats(opts, 55, {complete: false}).complete);
assert(rules.stats(undefined, 55, null).complete); assert(rules.stats([], 55, null).complete);
const cat = require('../src/economy').loadCatalog(process.cwd(), build);
const a = {id: 'higher-bond-base', level: 80, element: 'ไฟ', kind: 'normal', race: 'สัตว์', name: 'Base'};
const b = {id: 'lower-base-with-options', level: 55, element: 'Fire', kind: 'normal', race: 'สัตว์', name: 'Options'};
const world = {...cat.world, MONSTERS: [a, b], getMonster: id => [a, b].find(m => m.id === id)};
const current = {...cat, world}, save = {lv: 120, job: 'asura', equip: {}, pets: {[a.id]: 1000, [b.id]: 1000}, petActive: a.id};
assert.equal(planner.rank(save, current)[0].id, a.id);
const upgraded = {...save, petOpts: {[b.id]: opts}}, copy = JSON.stringify(upgraded);
assert.equal(planner.rank(upgraded, current)[0].id, b.id, 'owned options can beat a higher native base bonus');
assert.equal(JSON.stringify(upgraded), copy, 'comparison must not alter owned friendship/options/active pet');
const wrong = {...upgraded, petOpts: {[b.id]: [{k: 'atk', s: 5, v: 999}]}};
const uncertain = planner.choose({lastSave: wrong}, current);
assert.equal(uncertain.selected, null, 'unknown owned line blocks a blind replacement, preserving current native pet');
assert.match(uncertain.reason, /native rule review/);
const gear = require('../src/gear-value');
assert.deepEqual(gear.pet(b.id, 1000, world), {st_str: 5, atk: 45}, 'whole-loadout pet uses canonical native English element');
assert.equal(gear.totals({...upgraded, petActive: null}, current).score, 0, 'inactive pet options contribute nothing');
assert(gear.totals({...upgraded, petActive: b.id}, current).stats.atk > gear.totals({...save, petActive: b.id}, current).stats.atk);
console.log('PASS W12: bounded native data parsing without evaluation, pool/tier/active-effect invalidation, exact owned stars/values, additive active-only PvE lines and role ranking without client mutation/payment');
