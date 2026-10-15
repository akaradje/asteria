// economy.js - what to keep, what to sell, what to buy, and who should be holding it.
//
// Everything here is computed from the GAME'S OWN TABLES, not from a guess:
//
//   * asteria-world-system.js does `root.AsteriaWorld = API` and `module.exports = API`, so
//     Node can require it straight out of the asset cache. It gives us EQUIPMENT (149 items),
//     MONSTERS (93, each with its drop table), MAPS, EQUIPMENT_SETS, BAG_PRICES, GUILD,
//     PREMIUM_BY_ID, MAX_LV, HIGH_CLASSES, ASCEND.
//   * The price constants below are copied verbatim from the client's shop code, so sell and
//     buy prices agree with what the shop will actually pay and charge.
//
// The client already has a "sell junk" button; what it does NOT have is a decision about what
// junk IS for a given class, and no notion of handing an item to the teammate who can use it.
// That is what this module adds.
'use strict';

const path = require('path');
const fs = require('fs');
const build = require('./build');
const classWeights = new WeakMap();

// Invalidate tables after a download completes or the verified Wiki changes.
function sourceKey(root,buildHash){
 const paths=[path.join(root,'cache',buildHash,'asteria-online.io','asteria-online-visual-polish.html'),path.join(root,'cache',buildHash,'asteria-online.io','asteria-world-system.js'),path.join(root,'data','wiki.json'),path.join(root,'machines','equipment-goal.json')];
 return path.resolve(root)+':'+buildHash+':'+paths.map(f=>{try{const s=fs.statSync(f);return s.size+':'+s.mtimeMs;}catch{return 'missing';}}).join('|');
}
function remember(cache,key,value){cache.set(key,value);while(cache.size>8)cache.delete(cache.keys().next().value);return value;}
// Client price constants
// Copied from the client (logs/client-pretty.js:32718-32725). If the game changes these, the
// numbers here are wrong - re-read them rather than trusting this comment.
const SHOP_TIER_PRICE = [0, 500, 6000, 20000, 30000, 55000, 90000];
const SHOP_SLOT_MUL = { weapon: 1, armor: 0.7, offhand: 0.6, head: 0.45, boots: 0.45 };
const SHOP_MAX_TIER = 3;
const NO_SHOP = new Set(['flame_saber', 'leafblade']);
const SELL_BY_RARITY = { common: 20, uncommon: 60, rare: 150, epic: 400, legendary: 1200 };

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const round10 = n => Math.round(n / 10) * 10;

// ---------------------------------------------------------------- the class tree
// 6 base -> 6 promoted (Job Lv 50 + Lv 60) -> 12 ascended (ASCEND, closed while open:false).
// An item restricted to `knight` must still be usable by a Dawnwarden, so class-fit checks
// walk the chain, not the current job alone.
const BASE_TO_PROMOTED = {
  knight: 'dawnwarden', assassin: 'nightfang', mage: 'starweaver',
  priest: 'lumenoracle', ranger: 'galehunter', monk: 'ironlotus',
};
/**
 * The next promotion id for a job, or null: tier-2 comes from the static table, tier-3
 * (hyper, added 2026-09-29: Lv 99 + Job 50 at the Job Master) from the world module's
 * HIGH_CLASSES. The caller decides the level gate - the two tiers need different levels.
 */
function nextPromotion(job, world) {
  if (BASE_TO_PROMOTED[job]) return BASE_TO_PROMOTED[job];
  const high = (world && world.HIGH_CLASSES) || {};
  for (const [id, def] of Object.entries(high)) if (def && def.from === job) return id;
  return null;
}

const PROMOTED_TO_BASE = Object.fromEntries(
  Object.entries(BASE_TO_PROMOTED).map(([b, p]) => [p, b]));

/**
 * Every class this character has effectively "been", current one first.
 * Built from BASE_TO_PROMOTED plus the world module's HIGH_CLASSES, so the third tier is
 * included automatically when the server opens it.
 */
function jobChain(job, world) {
  const out = [];
  const push = j => { if (j && !out.includes(j)) out.push(j); };
  push(job);
  const high = (world && world.HIGH_CLASSES) || {};
  const parent=high[job]?.from;
  if(parent)push(parent);
  push(PROMOTED_TO_BASE[parent||job]);
  return out;
}

// ---------------------------------------------------------------- world model
const worldCache = new Map();

/** The game's world model for a build, or null if that build is not cached. */
function loadWorld(root, buildHash) {
  const key=sourceKey(root,buildHash);
  if (worldCache.has(key)) return worldCache.get(key);
  const f = path.join(root, 'cache', buildHash, 'asteria-online.io', 'asteria-world-system.js');
  let w = null;
  try {
    if (fs.existsSync(f)) {
      // require() treats a bare "cache/..." as a module name, not a path, so resolve first.
      const abs = path.resolve(f);
      delete require.cache[abs];
      w = require(abs);
    }
  } catch { w = null; }
  if(w)remember(worldCache,key,w);
  return w;
}

/**
 * The world model for the newest cached build.
 *
 * Only a fallback: prefer loadWorld(liveBuildHash). This used to sort the cache directories by
 * NAME, which picked `f323279` - an old build whose EQUIPMENT has 111 items and no `rarity`
 * field at all, so every sell price silently came out wrong. Newest by mtime, not by name.
 */
/**
 * The client's own hand-authored `ITEMS` table, parsed out of the client HTML.
 *
 * The world module's EQUIPMENT has the full 149-item list with tier/reqLv/jobs/stats, but NO
 * `rarity` - and rarity is what the sell price is built from. The client keeps rarity, set
 * membership, art and description in a separate 31-entry ITEMS literal, so both are needed.
 * Same brace-walking parse gen-build.js uses for JOBS, with `__L` stubbed to identity.
 */
const clientItemsCache = new Map();
function loadClientItems(root, buildHash) {
  const key = sourceKey(root,buildHash);
  if (clientItemsCache.has(key)) return clientItemsCache.get(key);
  let out = {};
  try {
    const f = path.join(root, 'cache', buildHash, 'asteria-online.io',
      'asteria-online-visual-polish.html');
    const src = fs.readFileSync(f, 'utf8');
    const start = src.indexOf('const ITEMS = {');
    if (start >= 0) {
      let depth = 0, end = -1;
      const i = src.indexOf('{', start);
      for (let p = i; p < src.length; p++) {
        const c = src[p];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = p; break; } }
      }
      if (end > 0) {
        const L = s => s;
        out = new Function('__L', `return (${src.slice(i, end + 1)});`)(L) || {};
      }
    }
  } catch { out = {}; }
  remember(clientItemsCache,key,out);
  return out;
}

/**
 * The full catalog for a build: EQUIPMENT (all 149) merged with ITEMS (rarity/set/desc).
 * `rarity` defaults to 'common', which is exactly what the client's own sell price falls back
 * to when an item has none, so generated gear still prices correctly.
 */
const catalogCache = new Map();
function loadCatalog(root, buildHash) {
  const key = sourceKey(root,buildHash);
  if (catalogCache.has(key)) return catalogCache.get(key);
  const world = loadWorld(root, buildHash);
  if(!world)throw Error('World data unavailable for requested loaded build: '+buildHash);
  const items = {};
  for (const it of (world && world.EQUIPMENT) || []) {
    items[it.id] = Object.assign({ rarity: 'common' }, it);
  }
  for (const [id, it] of Object.entries(loadClientItems(root, buildHash))) {
    const base = items[id] || {};
    const merged = Object.assign({ id }, base, it);
    // The client's sellPrice() reads ITS OWN ITEMS entry (`ITEMS[id].tier || 1`), so pricing
    // fields must come from that entry ALONE. Inheriting `tier` from the world module's
    // EQUIPMENT when the authored entry has none made Sandstride Boots price at 410 when the
    // shop actually paid 50 - an estimate 4x the truth, which is worse than no estimate.
    if (!('tier' in it)) delete merged.tier;
    if (!('rarity' in it)) delete merged.rarity;
    else merged.rarityEvidence='native_authored_table';
    items[id] = merged;
  }
  // Reviewed native post-processing: EQUIPMENT overrides the initial ITEMS
  // literal, including its rarity. A default common label is not game evidence.
  const client=fs.readFileSync(path.join(root,'cache',buildHash,'asteria-online.io','asteria-online-visual-polish.html'),'utf8');
  let generated=null;try{generated=require('./knowledge/native-item-metadata').read(client,world,loadClientItems(root,buildHash));}catch{/* Unknown metadata remains unpriced, never invent a rarity. */}
  for(const it of world?.EQUIPMENT||[]){const old=items[it.id]||{};if(generated)items[it.id]={...old,...generated[it.id],rarityEvidence:'reviewed_native_generator'};else items[it.id].rarityEvidence='unknown';}
  // The client adds these after its ITEMS literal; omitting them hides forge weapons.
  for(const it of world?.ARSENAL||[])items[it.id]={...it};
  const wings=loadWings(root,buildHash),wiki=loadWiki(root);
  const wingRecipes=require('./verify-wing-recipes').verify(root,buildHash,wings,wiki?.crafting?.recipes||[]);
  for(const [id,w]of Object.entries(wings)){
    const recipe=wingRecipes.find(r=>r.resultId===id);
    items[id]={id,name:w.name,slot:'wing',tier:w.tier,reqLv:recipe?.reqLv||Infinity,rarity:w.tier>=6?'legendary':'epic',jobs:[w.line],class3Only:w.tier>=6,stats:w.stats,desc:w.desc,recipeCost:recipe?.cost||null,recipeVerified:!!recipe?.verified,recipeVerificationBuild:buildHash,wikiFetchedAt:wiki?._source?.fetchedAt||null};
  }
  const cat = { world, items, build: buildHash,wingRecipes,wikiSource:wiki?._source||null,nativeClientContracts:require('./knowledge/client-contracts').extract(client),nativeSemanticContracts:Object.fromEntries(['craft','refine','rewards','enchant','astral'].map(k=>[k,require('./knowledge/native-contract').validate(client,k)])) };
  // Reuse a checked domain across cosmetic builds only with exact transport
  // bytes as well as exact native handler/rules. Missing transport never reuses.
  try{cat.nativeTransportRevision=require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'cache',buildHash,'asteria-online.io/asteria-net.js'))).digest('hex');}catch{cat.nativeTransportRevision=null;}
  try{cat.jobs=require('./class-build').load({root,catalog:()=>cat});classWeights.set(world,Object.fromEntries(Object.entries(cat.jobs).map(([id,j])=>[id,j.bonus||{}])));}catch(e){cat.classSchemaError=e.message;classWeights.set(world,{});}
  require('./equipment-goal').configure(cat,require('./equipment-goal').read(root));
  cat.nativeRecipes=require('./knowledge/development-source').nativeEquipmentRecipes(root,buildHash,cat).map(r=>({resultId:r.out.item,result:items[r.out.item]?.name,type:r.type,reqLv:r.reqLv,cost:Object.fromEntries(Object.entries(r.cost).map(([k,v])=>[k==='coins'?'Copper':k.startsWith('item:')?items[k.slice(5)]?.name||k:k,v])),verified:true,source:'reviewed_loaded_client',verifiedBuild:buildHash})).filter(r=>r.result);
  // Cache refusals as observations too; changing files invalidates sourceKey.
  // This never changes verified=false or grants dispatch permission.
  remember(catalogCache,key,cat);
  return cat;
}

/**
 * The newest cached build hash.
 *
 * The dashboard reads status.json, which carries no build, so it needs a way to find the right
 * cache directory - and "newest by mtime" is the same rule anyWorld uses, for the same reason.
 */
function newestBuild(root) {
  // Archive extraction may give an old fixture a newer directory timestamp.
  // Prefer the explicitly staged native release with all three bound sources.
  try {
    const pin=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'),'utf8'));
    if(pin.version===1&&require('./knowledge/build-id').hashBuild(pin.build)&&pin.files?.length===3){
      const identity=require('./knowledge/loaded-source').capture(root,pin.build);
      if(!identity.missing.length&&['client','world','network'].every((key,n)=>pin.files[n].sha256===identity.sourceHashes[key]))return pin.build;
    }
  } catch {}
  const dir = path.join(root, 'cache');
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir)
    .map(b => {
      let m = 0;
      try { m = fs.statSync(path.join(dir, b, 'asteria-online.io')).mtimeMs; } catch { }
      return { b, m };
    })
    .filter(x => x.m)
    .sort((a, b) => b.m - a.m)
    .map(x => x.b)[0] || '';
}

function anyWorld(root) {
  const dir = path.join(root, 'cache');
  if (!fs.existsSync(dir)) return null;
  const builds = fs.readdirSync(dir)
    .map(b => {
      const f = path.join(dir, b, 'asteria-online.io', 'asteria-world-system.js');
      let m = 0;
      try { m = fs.statSync(f).mtimeMs; } catch { }
      return { b, m };
    })
    .filter(x => x.m)
    .sort((a, b) => b.m - a.m);
  for (const { b } of builds) {
    const w = loadWorld(root, b);
    if (w && w.EQUIPMENT && w.EQUIPMENT.length) return w;
  }
  return null;
}

// ---------------------------------------------------------------- prices
function gearPrice(item) {
  if (!item) return 0;
  return round10(SHOP_TIER_PRICE[clamp(item.tier || 1, 1, 6)] * (SHOP_SLOT_MUL[item.slot] || 0.5));
}

/** What the shop pays. Verbatim from the client: a floor by rarity, or 15% of shop value. */
function sellPrice(item) {
  if (!item) return 0;
  return Math.max(SELL_BY_RARITY[item.rarity] || 20,
    round10(gearPrice(item) * (item.uniqueBoss ? 0.3 : 0.15)));
}

/** What the shop charges - the same number, unless the shop does not stock it at all. */
function buyPrice(item) { return gearPrice(item); }

/** Is this item sold in a shop at all? Tier 4+ and the two unique-boss pieces are not. */
function inShop(item, lv) {
  if (!item) return false;
  if (item.uniqueBoss || item.class3Only) return false;
  if (NO_SHOP.has(item.id)) return false;
  if ((item.tier || 1) > SHOP_MAX_TIER) return false;
  if (!(item.slot === 'weapon' || item.slot === 'offhand' || item.set)) return false;
  return (lv || 1) >= (item.reqLv || 1);
}

// ---------------------------------------------------------------- class fit and value
function canUse(item, job, world) {
  if (!item) return false;
  if (item.slot==='wing' && item.class3Only && !jobChain(job,world).some(j=>Object.values(BASE_TO_PROMOTED).includes(j))) return false;
  if (!item.jobs || !item.jobs.length) return true;      // unrestricted
  const chain = jobChain(job, world);
  return item.jobs.some(j => chain.includes(j));
}

/**
 * How much this item is worth TO THIS CLASS.
 *
 * Stats are weighted by the class's own build weights from build.js (the game's
 * JOBS[job].bonus table), so a DEX-heavy item scores high for a ranger and low for a mage
 * without anyone hard-coding that. Unweighted stats still count, at a low flat rate, so an
 * item with a big raw number is never scored at zero.
 */
function score(item, job, world) {
  if (!item || !item.stats) return 0;
  const weights=classWeights.get(world)||build.STAT_WEIGHTS;
  const chain = jobChain(job, world);
  // Merge the weights of every class in the chain so a promoted class keeps its base's taste.
  const merged = {};
  for (const j of chain) for (const [k, v] of Object.entries(weights[j] || {})) {
    merged[k] = Math.max(merged[k] || 0, v);
  }
  let s = 0;
  for (const [k, v] of Object.entries(item.stats)) {
    const key = k.startsWith('st_') ? k.slice(3) : k;
    const weight = merged[key];
    s += v * (weight != null ? 1 + weight * 10 : 0.25);
  }
  return Math.round(s * 10) / 10;
}

/**
 * The single best item this character could be holding in each slot, out of a candidate list.
 * Returns { slot: {id, score} }. Used both to pick upgrades and to spot what to sell.
 */
function bestPerSlot(ids, job, lv, world, items) {
  const out = {};
  for (const id of ids) {
    const it = items[id];
    if (!it || !it.slot) continue;
    if ((it.reqLv || 1) > lv) continue;
    if (!canUse(it, job, world)) continue;
    const s = score(it, job, world);
    if (!out[it.slot] || out[it.slot].score < s) out[it.slot] = { id, score: s, item: it };
  }
  return out;
}

/**
 * Decide what to do with a bag.
 *
 *   equip  - better than what is worn (or the slot is empty) and the class can use it
 *   give   - the class cannot use it, but a teammate's class can; worth more to them than to us
 *   store  - worth keeping but not equipping: rare+, or part of a set we are collecting
 *   sell   - everything else
 *
 * Carded and locked pieces are never proposed for sale - the client refuses to sell them and
 * the card cannot be recovered, so they are left alone.
 */
function planBag({ bag, equip, job, lv, world, items, roster, keepIds, save }) {
  const planned=save?{...save,equip:{...equip}}:null;
  const worn = {};
  for (const [slot, id] of Object.entries(equip || {})) {
    if (typeof id === 'string' && items[id]) worn[slot] = score(items[id], job, world);
  }
  const keep = new Set([...(keepIds || []),...(save?.locks||[])]);
  const stored = new Set();          // ids already proposed for storage - no duplicates
  const plan = { equip: [], give: [], store: [], keep: [], sell: [], sellCoins: 0 };
  const stageCopyKept=new Set();

  // The SAVED bag is an array of bare item ids (`["leaf_hood", ...]`); the client's live bag is
  // an array of `{id, uid}`. Accept both - assuming objects made the planner return an empty
  // plan on a real character, which reads exactly like "nothing to do".
  const norm = raw => (typeof raw === 'string' ? { id: raw, uid: raw } : raw);

  for (const raw of bag) {
    const entry = norm(raw);
    const it = items[entry.id];
    if (!it) continue;
    if(it.rarityEvidence==='unknown'){plan.store.push({uid:entry.uid,id:entry.id,name:it.name,reason:'native rarity generator not reviewed; no sale'});continue;}
    if (entry.locked || entry.cards || save?.sockets?.[entry.id]?.length) continue; // preserve irreversible investments
    if (keep.has(entry.id)) continue;
    if(save&&Object.values(equip||{}).includes(entry.id)&&it.tier>=6&&world?.FORGE?.canStage(it)&&(save.stage?.[entry.id]||0)<5&&!stageCopyKept.has(entry.id)){
      stageCopyKept.add(entry.id);plan.keep.push({id:entry.id,uid:entry.uid,name:it.name,reason:'reserve plain bag copy for stage 5; do not store/sell/trade'});continue;
    }

    const s = score(it, job, world);

    if (canUse(it, job, world) && (it.reqLv || 1) <= lv) {
      const comparison=planned?require('./gear-value').compare(planned,{world,items},entry.id):null;
      if (comparison?comparison.upgrade:(worn[it.slot] === undefined || s > worn[it.slot])) {
        worn[it.slot] = s;
        const targetSlot=comparison?.slot||it.slot;
        if(planned)planned.equip[targetSlot]=entry.id;
        plan.equip.push({ uid: entry.uid, id: entry.id, slot: targetSlot, score: s, name: it.name, comparison });
        continue;
      }
    } else if (roster && roster.length) {
      // Who on the team could use it, and would it beat what they are wearing?
      const better = roster.filter(r => r.charName !== undefined
        && canUse(it, r.job, world) && (it.reqLv || 1) <= (r.lv || 1)
        && (!r.worn || (r.worn[it.slot] || 0) < s));
      if (better.length) {
        plan.give.push({ uid: entry.uid, id: entry.id, name: it.name, to: better[0].charName, score: s });
        continue;
      }
    }

    if(it.slot==='wing')continue; // preserve prerequisite / other-class wings after considering equip
    // Keep one of a kind. Personal storage caps at 100 items, so hoarding duplicate set pieces
    // fills it with things we already have - the second copy is worth its Copper instead.
    if(save?.refine?.[entry.id]>0||save?.weaponOpts?.[entry.id]?.some(Boolean))continue;
    const keepsake = ['rare', 'epic', 'legendary'].includes(it.rarity) || it.set;
    if (keepsake && !stored.has(entry.id)) {
      stored.add(entry.id);
      plan.store.push({ uid: entry.uid, id: entry.id, name: it.name, rarity: it.rarity, score: s });
      continue;
    }
    plan.sell.push({ uid: entry.uid, id: entry.id, name: it.name, rarity: it.rarity, dup: keepsake });
    plan.sellCoins += sellPrice(it);
  }
  return plan;
}

/** Which shop items would be an upgrade right now, best first. */
function shopUpgrades({ job, lv, coins, world, items }) {
  const out = [];
  for (const it of Object.values(items)) {
    if (!inShop(it, lv)) continue;
    if (!canUse(it, job, world)) continue;
    const p = buyPrice(it);
    if (p > coins) continue;
    out.push({ id: it.id, name: it.name, slot: it.slot, tier: it.tier || 1, price: p, score: score(it, job, world) });
  }
  return out.sort((a, b) => b.score - a.score || a.price - b.price);
}

/** The next bag page, or null when fully expanded. */
function nextBagPage(world, currentPage) {
  const prices = (world && world.BAG_PRICES) || [5000, 20000, 60000, 150000];
  const p = (currentPage || 0) + 1;
  if (p > prices.length) return null;
  return { page: p, price: prices[p - 1], cap: (world && world.bagCap) ? world.bagCap(p) : null };
}

/**
 * Where to farm for a given material, from the monsters' own drop tables.
 * Returns the map, the monsters that drop it, and the drop rate, best rate first.
 */
function farmFor(materialName, world) {
  const out = [];
  for (const m of (world && world.MONSTERS) || []) {
    for (const d of m.dropTable || []) {
      if (d.itemName === materialName) {
        out.push({ monster: m.name, id: m.id, lv: m.level, kind: m.kind, rate: d.rate, area: m.area, region: m.region });
      }
    }
  }
  return out.sort((a, b) => b.rate - a.rate);
}

/**
 * The wing table, parsed out of the client like ITEMS.
 *
 * Twelve wings: two per class, a tier-5 and a tier-6 that upgrades it. The class is `line` and
 * the upgrade path is `from`, so a character's target is decided by its class, not by hand.
 * (The `cwing_*` entries in PREMIUM_BY_ID are COSTUME wings - they sit over the real wing and
 * explicitly do not replace its stats, so they are not what "get wings" means.)
 */
const wingsCache = new Map();
function loadWings(root, buildHash) {
  const key = sourceKey(root,buildHash);
  if (wingsCache.has(key)) return wingsCache.get(key);
  let out = {};
  try {
    const f = path.join(root, 'cache', buildHash, 'asteria-online.io',
      'asteria-online-visual-polish.html');
    const src = fs.readFileSync(f, 'utf8');
    const start = src.indexOf('const WINGS = {');
    if (start >= 0) {
      let depth = 0, end = -1;
      const i = src.indexOf('{', start);
      for (let p = i; p < src.length; p++) {
        const c = src[p];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = p; break; } }
      }
      if (end > 0) {
        const L = s => s;
        out = new Function('__L', `return (${src.slice(i, end + 1)});`)(L) || {};
      }
    }
  } catch { out = {}; }
  if(Object.keys(out).length)remember(wingsCache,key,out);
  return out;
}

// Wing costs come from the verified Wiki recipes for the loaded game build.

/**
 * What wing this character should be working towards, and what is still missing.
 *
 * Returns the target wing, its full material bill (the tier-6 wing also needs the tier-5 one),
 * what the character already has, and - for anything missing - where it drops, best rate first.
 * That last part is the difference between "you need 6 Celestial Plume" and a plan.
 */
/** Item ids the character holds, from the save's equip map ({slot: id}) and bag id list. */
function ownedNames(save) {
  return [...Object.values((save && save.equip) || {}), ...((save && save.bag) || [])].map(x=>typeof x==='string'?x:x?.id).filter(x=>typeof x==='string');
}
function withNativeRecipes(wiki,cat){const native=cat?.nativeRecipes||[];if(!native.length)return wiki;const ids=new Set(native.map(r=>r.type+':'+r.resultId));return {...wiki,crafting:{...wiki?.crafting,recipes:[...(wiki?.crafting?.recipes||[]).filter(r=>!ids.has(r.type+':'+r.resultId)),...native]}};}

function wingPlan(options) {
  const recipes=options.recipes||[];
  const canonical=o=>JSON.stringify(Object.entries(o||{}).sort(([a],[b])=>a.localeCompare(b)));
  const verified=recipes.map(r=>{const item=options.items?.[r.resultId];return item?.recipeVerified===false||(item?.recipeCost&&(canonical(item.recipeCost)!==canonical(r.cost)||item.reqLv!==r.reqLv))?{...r,verified:false}:r;});
  const reserve=require('./upgrade-reserve'),reservedMaterials={};
  if(Object.values(options.world?.HIGH_CLASSES||{}).some(c=>c.from===options.job))for(const name of reserve.cores)reservedMaterials[name]=1;
  const result=require('./wing-recipes').plan({...options,recipes:verified,chain:jobChain(options.job,options.world),farmFor,reserveCoins:reserve.reserve({job:options.job,lv:options.lv},options.world),reservedMaterials});
  if(result){result.verifiedBuild=options.items?.[result.target]?.recipeVerificationBuild||null;result.wikiFetchedAt=options.items?.[result.target]?.wikiFetchedAt||null;}
  return result;
}
/**
 * The game's own wiki dataset (`https://asteria-online.io/wiki/data.json`, saved as data/wiki.json).
 *
 * This is the authoritative source for the RULES - crafting recipes, refine costs, guild and
 * party constants, pet unlock counts - which the shipped client does not expose in a usable
 * form. The client stays authoritative for item STATS, because it is live and the wiki is a
 * snapshot. `scripts/update-wiki.js` refreshes the file.
 */
let wikiCache = null,wikiKey=null;
function loadWiki(root) {
  const key=sourceKey(root,'wiki');
  if (wikiCache&&wikiKey===key) return wikiCache;
  try {
    const f = path.join(root, 'data', 'wiki.json');
    wikiCache = JSON.parse(fs.readFileSync(f, 'utf8'));wikiKey=key;
  } catch { wikiCache = null; }
  return wikiCache;
}

/**
 * What to refine next on each equipped item.
 *
 * Refining is the cheapest real power in the game and it is SAFE: from the wiki's own rules,
 * +0 to +3 succeed 100% of the time, and a failure costs ore and Copper but "ของไม่พังและระดับไม่ลด"
 * - the item is not destroyed and the level does not drop. That is what makes it automatable
 * where enchanting (gacha) is a judgement call.
 *
 * Chance by CURRENT level: [100,100,100,100,90,80,65,50,40,30]. Cost (35 + lv*30) * tier.
 * Ore 1 + floor(lv/3), and the ore type is set by the item's tier.
 */
function refinePlan({ equip, refine = {}, materials = {}, coins = 0, items, wiki, world, maxChanceDrop = 0, foundation = false, state = {} }) {
  const goal=require('./equipment-goal').policy({items});
  const live = world?.REFINE;
  if(goal.enabled&&!require('./knowledge/refine-capability').nativeRules(world))return {steps:[],doable:[],coinCost:0,blockedByOre:[],blockedRule:'native refinement rules not verified'};
  const rules = (wiki && wiki.systems && wiki.systems.refine) || {};
  const chance = live?.chance || rules.chancePctByCurrentLevel || [100, 100, 100, 100, 90, 80, 65, 50, 40, 30];
  const ores = rules.orePerTier || ['Iron Ore', 'Sunsteel Ore', 'Frost Ore', 'Dark Iron', 'Abyss Steel', 'Starmetal'];
  const max = require('./knowledge/refine-capability').nativeRules(world)?.max || live?.max || rules.max || 10;

  const steps = [];
  for (const [slot, id] of Object.entries(equip || {})) {
    if (typeof id !== 'string') continue;
    const it = items[id];
    const bridgeFoundation=foundation===true&&it?.rarity==='epic'&&it.rarityEvidence!=='unknown'&&it.tier>=4&&['weapon','offhand','head','armor','boots'].includes(slot)&&(refine[id]||0)===0;
    if (!it || require('./knowledge/refine-capability').support(slot,world).state!=='supported'||goal.enabled&&!goal.dynamicProgression&&it.rarity!==goal.rarity&&!bridgeFoundation) continue;
    const lv = Math.max(0, Math.min(max, +(refine[id] || 0)));
    if (lv >= Math.min(max,goal.enabled?require('./equipment-goal').target({items,world},slot):require('./power-plan').refineTarget(it))) continue;

    const pct = chance[lv] != null ? chance[lv] : 30;
    if(bridgeFoundation&&pct<100)continue;
    const tier = Math.max(1, it.tier || 1);
    const coinCost = live?.cost ? live.cost(tier, lv) : (35 + lv * 30) * tier;
    const oreName = live?.ore ? live.ore(tier) : ores[Math.min(ores.length - 1, tier - 1)];
    const oreNeed = live?.need ? live.need(lv) : 1 + Math.floor(lv / 3);
    const oreHave = materials[oreName] || 0;

    const nativeStep=require('./knowledge/refine-capability').step({...state,equip,refine,materials,coins},{items,world},id,{materials,coins});
    if(!nativeStep)continue;
    const value=goal.dynamicProgression?require('./planning/combat-roi').refinement({...state,equip,refine},{items,world},nativeStep):null;
    steps.push({
      ...nativeStep,...(value?{valuation:value,expectedGain:value.expectedGain,riskEligible:value.eligible}:{}),slot, id, name: it.name, tier, from: lv, to: lv + 1, ...(bridgeFoundation?{foundation:true}:{}),
      chancePct: nativeStep.chancePct, guaranteed: nativeStep.guaranteed,
      coinCost, oreName, oreNeed, oreHave,
      can: nativeStep.ready&&(!value||value.eligible),
      // One bounded attempt is journaled by the runtime; low odds do not change the goal.
      worthIt: pct > 0 && pct >= maxChanceDrop&&(!value||value.eligible),
    });
  }
  steps.sort((a, b) => (b.guaranteed - a.guaranteed) || (b.chancePct - a.chancePct) || (a.coinCost - b.coinCost));
  const doable = steps.filter(s => s.can && s.worthIt);
  return {
    steps,
    doable,
    coinCost: doable.reduce((n, s) => n + s.coinCost, 0),
    blockedByOre: steps.filter(s => s.worthIt && s.oreHave < s.oreNeed).map(s => ({ slot: s.slot, from:s.from, to:s.to, need: s.oreName, have: s.oreHave, want: s.oreNeed })),
  };
}

/** Where a refine ore comes from: the shop, or which monsters drop it. */
function oreSource(oreName, wiki, world) {
  const shop = (wiki && wiki.systems && wiki.systems.refine && wiki.systems.refine.ironOreShop) || 0;
  const fromShop = oreName === 'Iron Ore' && shop ? { shop, price: shop } : null;
  return { fromShop, drops: farmFor(oreName, world).slice(0, 3) };
}

/**
 * Which pet this character is closest to unlocking, and what it would give.
 *
 * Pets are not bought and not crafted: each monster unlocks one at a fixed kill count, and the
 * wiki carries that per monster (`pet.unlockKills` plus `bonusByTier`, so the reward is known in
 * advance rather than discovered afterwards). Only one pet may be active at a time.
 */
function petPlan({ bestiary = {}, wiki, limit = 8 }) {
  const mons = (wiki && wiki.monsters && wiki.monsters.monsters) || [];
  const out = [];
  for (const m of mons) {
    if (!m.pet || !m.pet.unlockKills) continue;
    const kills = bestiary[m.id] || 0;
    const need = m.pet.unlockKills;
    out.push({
      monster: m.name, id: m.id, lv: m.level, race: m.race,
      kills, need, remaining: Math.max(0, need - kills),
      unlocked: kills >= need,
      progressPct: Math.min(100, Math.round(kills / need * 100)),
      firstTier: (m.pet.bonusByTier && m.pet.bonusByTier['แรกพบ']) || null,
      area: m.area || m.region,
    });
  }
  // Closest first, then the ones already unlocked.
  out.sort((a, b) => (b.unlocked - a.unlocked) || (a.remaining - b.remaining));
  return out.slice(0, limit);
}

/**
 * Where to farm for gear better than what is worn.
 *
 * Tier 4+ equipment has NO crafting recipe - it drops. So the answer to "how do I get god gear"
 * is a monster list, and the wiki's drop tables give it with rates.
 */
function gearFarm({ lv, job, world, items, wiki, minTier = 4, limit = 10 }) {
  const byName = {};
  for (const it of Object.values(items || {})) if (it && it.name) byName[it.name] = it;
  const rows = [];
  for (const m of (wiki && wiki.monsters && wiki.monsters.monsters) || []) {
    for (const dr of m.dropTable || []) {
      const it = byName[dr.item];
      if (!it) continue;
      const tier = it.tier || 1;
      if (tier < minTier) continue;
      if (it.reqLv && it.reqLv > lv) continue;
      if (it.jobs && it.jobs.length && !canUse(it, job, world)) continue;
      rows.push({
        monster: m.name, monsterLv: m.level, kind: m.kind, area: m.area || m.region,
        item: it.name, itemId: it.id, slot: it.slot, tier, ratePct: dr.ratePct,
        score: score(it, job, world),
      });
    }
  }
  // Best upgrade first, then the likeliest drop.
  rows.sort((a, b) => b.score - a.score || b.ratePct - a.ratePct);
  return rows.slice(0, limit);
}

module.exports = { nextPromotion,  SHOP_TIER_PRICE, SHOP_SLOT_MUL, SHOP_MAX_TIER, NO_SHOP, SELL_BY_RARITY,
  BASE_TO_PROMOTED, PROMOTED_TO_BASE,
  jobChain, loadWorld, anyWorld, newestBuild, loadCatalog, loadClientItems, loadWings,
  wingPlan, ownedNames, withNativeRecipes,
  loadWiki, refinePlan, oreSource, petPlan, gearFarm,
  gearPrice, sellPrice, buyPrice, inShop,
  canUse, score, bestPerSlot,
  planBag, shopUpgrades, nextBagPage, farmFor,
};
