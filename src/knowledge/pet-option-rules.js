'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const cache = new Map(), sha = s => crypto.createHash('sha256').update(s).digest('hex');
const keys = new Set(['atk', 'matk', 'hp', 'hit', 'flee', 'st_str', 'st_agi', 'st_vit',
  'st_int', 'st_dex', 'st_luk', 'crit', 'aspdPct', 'hpPct', 'healBonus', 'dmgPct', 'critDmg', 'bossDmg']);
const unknown = reason => ({complete: false, reason, pools: null, actionsEnabled: false});
function extract(text) {
  try {
    const literal = require('./static-data');
    if (typeof text !== 'string' || text.length > 8000000 || (text.match(/\bconst\s+ENCH_PET\s*=/g)||[]).length !== 1) return unknown('unique_bounded_pet_pool_required');
    const ast = literal.index(text, ['ENCH_PET', 'ENCH_PET_TIER', 'ENCH_STEP_W']);
    if (!literal.same(ast.get('ENCH_PET_TIER'), 'lv => Math.max(1, Math.min(5, Math.ceil((lv || 1) / 24)))')) return unknown('pet_tier_contract_changed');
    const steps = literal.data(ast.get('ENCH_STEP_W'));
    if (!Array.isArray(steps) || steps.length !== 5 || steps.some(n => !Number.isSafeInteger(n) || n <= 0)) return unknown('pet_star_distribution_unknown');
    const pools = literal.data(ast.get('ENCH_PET'));
    if (!Array.isArray(pools) || pools.length !== 3 || pools[1] !== null || ast.assignments.length !== 1) return unknown('pet_pool_shape_changed');
    const concat = ast.assignments[0], member = require('./native-contract').member;
    if (concat.type !== 'CallExpression' || member(concat.callee) !== 'ENCH_PET.0.concat' || concat.arguments.length !== 1) return unknown('pet_pool_construction_changed');
    pools[1] = pools[0].concat(literal.data(concat.arguments[0]));
    const effect = 'if (collectionReady && player.petActive && player.pets && player.pets[player.petActive] !== undefined) enchAdd(petOpts[player.petActive]);';
    if (text.split(effect).length !== 2) return unknown('active_pet_effect_contract_changed');
    if (pools.some(p => !Array.isArray(p) || !p.length || p.length > 64 || new Set(p.map(r=>r.k)).size !== p.length) || pools.flat().some(r => !keys.has(r.k) || !Number.isSafeInteger(r.w) || r.w <= 0 || r.w > 10000 || Object.keys(r).some(k=>!['k','w','per','pct'].includes(k)) || !!r.per === Number.isFinite(r.pct) || (r.per ? !Array.isArray(r.per) || r.per.length !== 5 || r.per.some(n => !Number.isSafeInteger(n) || n < 0 || n > 100000) : r.pct <= 0 || r.pct > 1))) return unknown('invalid_pet_literal_values');
    return {complete: true, pools, starWeights: steps, revision: sha(JSON.stringify([pools,steps])), authority: 'AST_native_static_data_structural_contract', PvEOnly: true, actionsEnabled: false};
  } catch { return unknown('pet_AST_contract_unverified'); }
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
function expectedOptions(rules,level,job,world){
 if(!rules?.complete||!Number.isSafeInteger(level)||level<1)return {known:false};
 const tier=Math.max(1,Math.min(5,Math.ceil(level/24))),weights=require('./modifier-effects').roleWeights(job,world).weights,steps=rules.starWeights||[36,28,20,11,5],meanStar=steps.reduce((n,w,i)=>n+w*(i+1),0)/steps.reduce((a,b)=>a+b,0);
 return {known:true,tier,estimated:true,measuredBenefit:false,lines:rules.pools.map(pool=>{const total=pool.reduce((n,r)=>n+r.w,0);return pool.map(r=>({key:r.k,probability:r.w/total,meanValue:(r.per?r.per[tier-1]:r.pct)*meanStar,rolePriorUtility:(r.per?r.per[tier-1]:r.pct)*meanStar*(weights[r.k]||0)})).sort((a,b)=>b.rolePriorUtility-a.rolePriorUtility);}),executable:false};
}
module.exports = {extract, read, stats,expectedOptions};
