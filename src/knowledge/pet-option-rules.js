'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const cache = new Map(), sha = s => crypto.createHash('sha256').update(s).digest('hex');
const reviewedPool = 'b78cf16a640046a8f74ead4f63a3fab80fb4cd185a6c5f83296f356f0c46d127';
const keys = new Set(['atk', 'matk', 'hp', 'hit', 'flee', 'st_str', 'st_agi', 'st_vit',
  'st_int', 'st_dex', 'st_luk', 'crit', 'aspdPct', 'hpPct', 'healBonus', 'dmgPct', 'critDmg', 'bossDmg']);
const unknown = reason => ({complete: false, reason, pools: null, actionsEnabled: false});
function extract(text) {
  if (typeof text !== 'string' || text.length > 8000000) return unknown('bounded_pet_client_required');
  const start = '  const ENCH_PET = [', middle = '  ENCH_PET[1] = ENCH_PET[0].concat([', end = '  const ENCH_TH =';
  if ([start, middle, end].some(k => text.split(k).length !== 2)) return unknown('unique_pet_pool_required');
  const a = text.indexOf(start), b = text.indexOf(end, a), cut = text.indexOf(middle, a);
  if (b <= cut || cut <= a || b - a > 10000 || sha(text.slice(a, b)) !== reviewedPool)
    return unknown('pet_option_pool_changed_requires_review');
  const clauses = ["const ENCH_PET_TIER = lv => Math.max(1, Math.min(5, Math.ceil((lv || 1) / 24)));",
    'const ENCH_STEP_W = [36, 28, 20, 11, 5];',
    "if (collectionReady && player.petActive && player.pets && player.pets[player.petActive] !== undefined) enchAdd(petOpts[player.petActive]);"];
  if (clauses.some(k => text.split(k).length !== 2)) return unknown('pet_tier_steps_or_active_effect_changed');
  // Only reviewed data rows are parsed. No downloaded function/VM execution.
  const rows = region => [...region.matchAll(/\{ k: '([\w]+)', w: (\d+), (?:per: \[([\d, ]+)\]|pct: ([\d.]+)) \}/g)].map(m => {
    const r = {k: m[1], w: Number(m[2])};
    if (m[3]) r.per = m[3].split(',').map(Number); else r.pct = Number(m[4]);
    return r;
  });
  const base = rows(text.slice(a, cut)), extra = rows(text.slice(cut, b));
  if (base.length !== 10 || extra.length !== 4) return unknown('pet_literal_row_count_mismatch');
  const statRows = ['str', 'agi', 'vit', 'int', 'dex', 'luk'].map(s => ({k: 'st_' + s, w: 5, per: [1, 1, 1, 2, 2]}));
  const first = [...base.slice(0, 5), ...statRows], third = base.slice(5);
  const pools = [first, [...first, ...extra], third];
  if (pools.flat().some(r => !keys.has(r.k) || !Number.isSafeInteger(r.w) || r.w <= 0 ||
      (r.per ? r.per.length !== 5 || r.per.some(n => !Number.isSafeInteger(n) || n < 0) : !Number.isFinite(r.pct) || r.pct <= 0)))
    return unknown('invalid_pet_literal_values');
  return {complete: true, pools, revision: sha(text.slice(a, b) + clauses.join('\n')),
    authority: 'reviewed_native_static_client_data', PvEOnly: true, actionsEnabled: false};
}
function read(root, build) {
  try {
    const file = path.join(root, 'cache', build, 'asteria-online.io/asteria-online-visual-polish.html');
    const stat = fs.statSync(file), key = file + '|' + stat.mtimeMs + '|' + stat.size;
    if (cache.has(key)) return cache.get(key);
    const r = extract(fs.readFileSync(file, 'utf8')); cache.set(key, r);
    while (cache.size > 8) cache.delete(cache.keys().next().value);
    return r;
  } catch { return unknown('native_pet_options_source_unavailable'); }
}
function stats(lines, level, rules) {
  if (lines === undefined || lines === null || Array.isArray(lines) && !lines.length) return {complete: true, stats: {}, source: 'no_owned_option_lines'};
  if (!Array.isArray(lines) || lines.length > 3 || !rules?.complete || !Number.isSafeInteger(level) || level < 1)
    return {complete: false, stats: {}, reason: 'native_pet_option_data_incomplete'};
  const out = {}, tier = Math.max(1, Math.min(5, Math.ceil(level / 24)));
  for (let n = 0; n < lines.length; n++) {
    const o = lines[n]; if (!o) continue;
    const rule = rules.pools[n].find(r => r.k === o.k);
    if (!rule || !Number.isSafeInteger(o.s) || o.s < 1 || o.s > 5 || !Number.isFinite(o.v) ||
        Math.abs(o.v - (rule.per ? rule.per[tier - 1] * o.s : Number((rule.pct * o.s).toFixed(3)))) > 1e-9)
      return {complete: false, stats: {}, reason: 'pet_option_line_not_native_for_tier_and_stars'};
    out[o.k] = (out[o.k] || 0) + o.v;
  }
  return {complete: true, stats: out, tier, revision: rules.revision, PvEOnly: true, measuredBenefit: false};
}
module.exports = {extract, read, stats};
