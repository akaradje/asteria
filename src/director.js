// director.js - the game brain.
//
// The planners in economy.js already know the game: refinePlan knows which ore the next
// +1 needs, wingPlan knows which materials the next wing tier costs, petPlan knows how many
// kills remain to the next pet, gearFarm knows which monster drops the upgrade, and the wiki
// knows every map's level range and every monster's drop table with rates. None of that ever
// reached the HUNTER: the farm map was a static --huntmap flag, so a character that needed
// Iron Ore would hunt w1 forever.
//
// This module closes that loop, in two halves:
//
//   decideGoal()  - state in, goal out: "hunt map w2 for Iron Ore, because the next refine
//                   needs 6 and you have 2" (or: pet at 84%, or the frontier EXP map). Every
//                   candidate is level-checked first - the brain must not send a Lv 22 to
//                   die on a Lv 40 boss just because the drop rate is 100%.
//   Learning      - what actually happened back in: per map, exp/coins/hour observed across
//                   sessions; per monster, kills and drops observed, blended with the wiki's
//                   claimed rates (the wiki says 30%, the character's own kills say 41% -
//                   believe the kills more as they accumulate). Persisted per slot under
//                   data/learning/, so knowledge survives restarts.
//
'use strict';

const fs = require('fs');
const path = require('path');
const economy = require('./economy');

// How dangerous each monster kind is to commit to, as a multiplier on drop rate. A 100%
// boss drop you can only kill once per respawn timer is worth far less per hour than a 30%
// trash-mob drop you can chain-kill.
const KIND_WEIGHT = { normal: 1.0, miniboss: 0.45, boss: 0.15 };

// A monster may only be the target if the character can plausibly kill it.
const MAX_LEVEL_OVER = { normal: 8, miniboss: 5, boss: 2 };

// Class survivability adjusts the same gate: a knight can farm two levels above the default
// ceiling (self-heal, plate), a mage or priest should stay a level lower (cloth). Everything
// else takes the kind gate as-is.
const CLASS_REACH = { knight: 2, monk: 1, assassin: 0, ranger: 0, mage: -1, priest: -1 };

const KIND_PRIORITY = { refine: 0, pet: 1, bestiary: 2, wing: 3, gear: 4, exp: 5 };

/** monsterId -> [mapId, ...] it spawns on, from the wiki's per-map spawn lists. */
function mapIndex(wiki) {
  const idx = {};
  for (const map of (wiki && wiki.maps && wiki.maps.maps) || []) {
    const kinds = map.monsters || {};
    for (const kind of Object.keys(kinds)) {
      for (const id of kinds[kind] || []) (idx[id] = idx[id] || []).push(map.id);
    }
  }
  return idx;
}

/** The map a monster is best farmed on for this level: reachable level range, own kind first. */
function bestMapFor(monsterId, lv, wiki, idx, blocked = {}) {
  let best = null;
  for (const mapId of idx[monsterId] || []) {
    const map = (wiki.maps.maps || []).find(m => m.id === mapId);
    if (!map || map.kind === 'town' || map.levelMin > lv || blocked[mapId]) continue;
    const fit = lv >= map.levelMin - 2 && lv <= map.levelMax + 6;
    // Tie-break on the map's own ceiling so, above all ranges, the most advanced map where
    // the monster lives wins - its co-spawns are the closest to the character's level.
    const rank = (fit ? 10 : 0) + (map.kind === 'field' ? 1 : 0) + (map.levelMax || 0) / 1000;
    if (!best || rank > best.rank) best = { mapId, mapName: map.name, rank };
  }
  return best;
}

/** Effective drop rate: the wiki's claim, pulled toward what this character actually saw. */
function blendRate(learned, monsterId, item, wikiRatePct) {
  const w = wikiRatePct / 100;
  const obs = learned && learned.observedRate(monsterId, item);
  if (obs == null || obs.kills < 20) return w;
  const weight = Math.min(0.8, obs.kills / (obs.kills + 30));   // 20 kills -> 0.4, 120 -> 0.8
  return weight * obs.rate + (1 - weight) * w;
}

/** Rank one material's drop sources into the single best reachable target. */
function bestSourceFor(materialName, lv, job, wiki, learned, idx, blocked = {}, allowed = () => true) {
  let best = null;
  for (const m of (wiki.monsters.monsters || [])) {
    const dr = (m.dropTable || []).find(d => d.item === materialName);
    if (!dr) continue;
    const over = (MAX_LEVEL_OVER[m.kind] != null ? MAX_LEVEL_OVER[m.kind] : 5) + (CLASS_REACH[job] || 0);
    if (m.level > lv + over) continue;                       // cannot kill it yet - skip
    const map = bestMapFor(m.id, lv, wiki, idx, blocked);
    if (!map||!allowed(m,(wiki.maps.maps||[]).find(x=>x.id===map.mapId))) continue;
    const rate = blendRate(learned, m.id, materialName, dr.ratePct);
    const score = rate * (KIND_WEIGHT[m.kind] || 0.5);
    if (!best || score > best.score) {
      best = { material: materialName, monster: m.name, monsterId: m.id, monsterLv: m.level,
        kind: m.kind, ratePct: dr.ratePct, effRate: rate, score, ...map };
    }
  }
  return best;
}

/** The frontier EXP map for one level: highest field map the character can survive. */
function frontierMap(lv, wiki, learned, blocked = {}) {
  let best = null;
  for (const map of wiki.maps.maps || []) {
    if (map.kind !== 'field' || lv < map.levelMin || blocked[map.id]) continue;
    const eph = learned ? learned.expPerHour(map.id) : null;
    const rank = map.levelMin + (lv <= map.levelMax ? 0.5 : 0) + (eph != null ? Math.min(2, eph / 60000) : 0);
    if (!best || rank > best.rank) best = { rank, map };
  }
  return best ? best.map : null;
}

/**
 * Every goal this character could take, ranked: priority first (refine > pet > wing > gear >
 * exp), then score. `decideGoal` takes the head; the TEAM layer (teamAssign) consumes the
 * whole list so two slots that both need Iron Ore don't walk to the same map.
 */
function goalCandidates(char, ctx) {
  const { wiki, learned } = ctx;
  const blocked = ctx.blockedMaps || {};
  if (!wiki || !wiki.maps) return [];
  const lv = char.lv || 1;
  const job = char.job || 'novice';
  const idx = mapIndex(wiki);
  const capped=!!ctx.personal?.progression?.capped,work=require('./planning/progression-work');
  const allowedSource=(m,map)=>capped?work.allowedSource(m,map,char,ctx):m?.kind==='normal'?map?.bossRoom===false&&map.levelMax<=Math.max(8,lv)&&m.level<=Math.max(1,lv-3):work.allowedSource(m,map,char,ctx);
  const out = [];
  const add = (goal, priority, score) => {
    if (!blocked[goal.mapId]) out.push({ ...goal, priority, score, at: new Date().toISOString() });
  };

  // 1. Refine: the plan says what is blocked; route to its ore source.
  if (ctx.refinePlan) {
    for (const b of (ctx.refinePlan.blockedByOre || [])) {
      const src = bestSourceFor(b.need, lv, job, wiki, learned, idx, blocked, allowedSource);
      if (src) add({
        kind: 'refine', mapId: src.mapId, mapName: src.mapName, material: b.need,
        monsterId:src.monsterId,monsterKind:src.kind,monster: src.monster, label: `ฟาร์ม ${b.need}`,
        reason: `รีไฟน์ ${b.slot === 'weapon' ? 'อาวุธ' : b.slot} +${b.from} → +${b.to} (${Math.round(ctx.refinePlan.steps?.find(s => s.slot === b.slot)?.chancePct ?? 100)}% สำเร็จ) ` +
          `ขาด ${b.need} ${Math.max(0, b.want - b.have)} — ดรอปจาก ${src.monster} (Lv${src.monsterLv}, ` +
          `${Math.round(src.effRate * 100)}%) ที่ ${src.mapName}`,
      }, KIND_PRIORITY.refine, src.score);
    }
  }

  // 2. Pet: the closest unlock whose monster is still reachable.
  if (ctx.pets && ctx.pets.length) {
    const cand = ctx.pets.find(x => !x.unlocked && (x.progressPct >= 40||ctx.personal?.milestones?.stage==='pet') && (ctx.personal?.milestones?.stage!=='pet'||(wiki.monsters.monsters||[]).find(m=>m.id===x.id)?.kind==='normal'));
    if (cand) {
      const mons = (wiki.monsters.monsters || []).find(m => m.id === cand.id);
      const over = mons && (MAX_LEVEL_OVER[mons.kind] != null ? MAX_LEVEL_OVER[mons.kind] : 5) + (CLASS_REACH[job] || 0);
      const map = mons ? bestMapFor(cand.id, lv, wiki, idx, blocked) : null;
      if (mons && allowedSource(mons,(wiki.maps.maps||[]).find(x=>x.id===map?.mapId)) && over != null && mons.level <= lv + over && map) {
        add({
          kind: 'pet', mapId: map.mapId, mapName: map.mapName,
          monsterId:mons.id,monsterKind:mons.kind,label: `ล่า ${cand.monster} ${cand.kills}/${cand.need}`,
          reason: `สัตว์เลี้ยง "${cand.monster}" ใกล้ปลดล็อก (${cand.progressPct}%) เหลืออีก ${cand.remaining} ตัว ` +
            `— เก็บที่ ${map.mapName} เพื่อรับโบนัส`,
        }, KIND_PRIORITY.pet, cand.progressPct / 100);
      }
    }
  }

  // 2b. Bestiary completion: every NEVER-KILLED normal species counts toward the permanent
  //     milestones (30 species = elemental stat +1, 150 = MaxHP by monster level). Route to
  //     the reachable map with the most unseen species - free permanent stats while AUTO
  //     does what it was doing anyway.
  const seen = char.bestiary || {};
  const unseenByMap = {};
  for (const m of (wiki.monsters.monsters || [])) {
    if(capped)continue; // Capped bestiary work uses one verified normal target below.
    if (m.kind !== 'normal' || seen[m.id]) continue;
    const over = (MAX_LEVEL_OVER.normal || 8) + (CLASS_REACH[job] || 0);
    if (m.level > lv + over) continue;
    const map = bestMapFor(m.id, lv, wiki, idx, blocked);
    if (!map||!allowedSource(m,wiki.maps.maps.find(x=>x.id===map.mapId))) continue;
    (unseenByMap[map.mapId] = unseenByMap[map.mapId] || { map, ids: [] }).ids.push(m.name || m.id);
  }
  const bestiaryPick = Object.values(unseenByMap).sort((a, b) => b.ids.length - a.ids.length)[0];
  if (bestiaryPick && bestiaryPick.ids.length >= 2) {
    add({
      monsterId:(wiki.monsters.monsters||[]).find(m=>m.kind==='normal'&&!seen[m.id]&&idx[m.id]?.includes(bestiaryPick.map.mapId)&&allowedSource(m,wiki.maps.maps.find(x=>x.id===bestiaryPick.map.mapId)))?.id,monsterKind:'normal',kind: 'bestiary', mapId: bestiaryPick.map.mapId, mapName: bestiaryPick.map.mapName,
      label: `เก็บสมุดมอน ${bestiaryPick.map.mapName}`,
      reason: `มอนที่ยังไม่เคยฆ่าอีก ${bestiaryPick.ids.length} ชนิด (${bestiaryPick.ids.slice(0, 3).join(', ')}) — ` +
        `เก็บสมุดให้ครบได้สเตตัสถาวร`,
    }, KIND_PRIORITY.bestiary, Math.min(1, bestiaryPick.ids.length / 10));
  }

  // 3. Wing materials: the big leap, but only chase what is reachable - and the CHAIN is
  //    respected: the T6 recipe consumes the T5 wing, so until the base wing is held the
  //    T5 bill comes first (wingPlan already re-targets the bill; chainNote explains why).
  if (ctx.wingPlan && ctx.wingPlan.missing && ctx.wingPlan.missing.length) {
    for (const w of ctx.wingPlan.missing) {
      const mat = w.name || w;
      const src = bestSourceFor(mat, lv, job, wiki, learned, idx, blocked, allowedSource);
      if (src) add({
        kind: 'wing', mapId: src.mapId, mapName: src.mapName, material: mat,
        monsterId:src.monsterId,monsterKind:src.kind,monster: src.monster, label: `หา ${mat} ทำปีก`,
        reason: `ปีกขั้นถัดไปขาด ${mat} (มี ${w.have ?? (char.materials[mat] || 0)}/${w.want ?? '?'}) — ดรอปจาก ${src.monster} ` +
          `(Lv${src.monsterLv}, ${Math.round(src.effRate * 100)}%) ที่ ${src.mapName}` +
          (ctx.wingPlan.chainNote ? ' · ' + ctx.wingPlan.chainNote : ''),
      }, KIND_PRIORITY.wing, src.score);
    }
  }

  // 4. Reachable gear upgrade: tier 4+ drops only, with a sane rate.
  if (ctx.gear && ctx.gear.length) {
    for (const g of ctx.gear) {
      if (!(g.monsterLv <= lv + (MAX_LEVEL_OVER[g.kind || 'normal'] || 5) + (CLASS_REACH[job] || 0)) || !Number.isFinite(g.ratePct) || g.ratePct < 0.5) continue;
      const mons = (wiki.monsters.monsters || []).find(m => m.name === g.monster);
      const map = mons ? bestMapFor(mons.id, lv, wiki, idx, blocked) : null;
      if (map&&allowedSource(mons,(wiki.maps.maps||[]).find(x=>x.id===map.mapId))) add({
        kind: 'gear', itemId:g.itemId, mapId: map.mapId, mapName: map.mapName, material: g.item,
        monsterId:mons.id,monsterKind:mons.kind,monster: g.monster, label: `ล่าหา ${g.item} (T${g.tier})`,
        reason: `เกียร์อัปเกรดที่ดีที่สุดที่หาได้: ${g.item} T${g.tier} ดรอปจาก ${g.monster} ` +
          `(Lv${g.monsterLv}, ${Math.round(g.ratePct * 100) / 100}%) ที่ ${map.mapName}`,
      }, KIND_PRIORITY.gear, g.ratePct / 100);
    }
  }

  // 5. Frontier EXP: always available - the party's shared grind.
  const recommendation = ctx.contextRecommendation;
  const observed = recommendation && (wiki.maps.maps || []).find(m=>m.id===recommendation.mapId&&m.kind==='field'&&m.levelMin<=lv&&!blocked[m.id]);
  const fm = observed || frontierMap(lv, wiki, learned, blocked);
  const training=ctx.catalog?require('./planning/level-training').candidates(char,wiki,ctx.catalog,{blocked,room:char.mapId}):[];
  const rankedTraining=ctx.farmEvidence&&ctx.learningBuild?ctx.farmEvidence.rank(training,ctx.currentSave||char,ctx.learningBuild):training;
  const tg=rankedTraining[0];
  // Keep alternative validated normal targets available to measured ranking;
  // selecting one estimate first made every better observed route invisible.
  if(tg&&!capped)for(const g of rankedTraining.slice(0,16))add({...g,contextEvidence:observed&&g.mapId===observed.id?recommendation:null},KIND_PRIORITY.exp,g.score);
  else if(fm&&!capped&&!ctx.catalog)add({kind:'exp',mapId:fm.id,mapName:fm.name,label:'เก็บเวล '+fm.name,reason:'legacy fixture map estimate'},KIND_PRIORITY.exp,0);

  // Income uses measured net yield when enough field samples exist; otherwise a safe field.
  const incomeMap = ((wiki.maps.maps || []).filter(m => m.kind === 'field' && m.levelMin <= lv && !blocked[m.id])
    .map(m => ({ m, value: learned?.coinsPerHour?.(m.id) }))
    .filter(x => x.value != null && x.value > 0).sort((a,b) => b.value-a.value)[0] || {}).m || fm;
  const safeIncome=capped?work.fallback(char,wiki,char.mapId,blocked):null;
  if (capped&&safeIncome) add(safeIncome,6,0);
  if(!capped&&tg)for(const g of rankedTraining.slice(0,16))add({...g,kind:'income',label:'สะสมเสบียง: '+g.label},6,g.score);
  if (!capped&&!ctx.catalog&&incomeMap) add({ kind: 'income', mapId: incomeMap.id, mapName: incomeMap.name,
    label: 'สะสมเงินสำรองที่ ' + incomeMap.name,
    reason: 'หาเงินสำหรับพัฒนาอุปกรณ์และค่าใช้จ่าย · ใช้ผลรายได้ที่วัดได้เมื่อมีข้อมูล มิฉะนั้นใช้พื้นที่ตามเลเวล' }, 6, 0);
  for (const missing of ctx.personal?.craft?.missing || []) {
    if (['Copper','tokens','runeDust'].includes(missing.name)) continue;
    const src = bestSourceFor(missing.name, lv, job, wiki, learned, idx, blocked, allowedSource);
    if (src) add({kind:'craft',mapId:src.mapId,mapName:src.mapName,material:missing.name,monsterId:src.monsterId,monsterKind:src.kind,
      label:'หา '+missing.name+' คราฟ '+ctx.personal.craft.name,
      reason:`มี ${missing.have}/${missing.want} · เลือกสูตรที่ใส่ได้และคะแนนสูงกว่าของที่ถืออยู่`},3,src.score);
  }

  for(const missing of ctx.personal?.progression?.promotionMissing||[]){
    if(['lv','jobLv','coins','class_system_closed'].includes(missing.name))continue;
    const src=bestSourceFor(missing.name,lv,job,wiki,learned,idx,blocked,allowedSource);
    if(src)add({monsterId:src.monsterId,monsterKind:src.kind,kind:'promotion',mapId:src.mapId,mapName:src.mapName,material:missing.name,label:'หา '+missing.name+' เลื่อนเป็น '+ctx.personal.progression.nextClass,reason:'เงื่อนไขคลาสขาด '+missing.name+' '+missing.have+'/'+missing.want+' · ห้ามใช้วัตถุดิบสำรองนี้คราฟอื่น'},-1,src.score);
  }
  const measured=ctx.farmEvidence&&ctx.learningBuild?ctx.farmEvidence.rank(out,ctx.currentSave||char,ctx.learningBuild):out.sort((a,b)=>a.priority-b.priority||b.score-a.score);
  return require('./character-brain').prioritize(measured,ctx.focus,ctx.personal);
}

function decideGoal(char, ctx) {
  return goalCandidates(char, ctx)[0] || null;
}

/**
 * The TEAM layer: assign goals across the whole farm so 6 slots work as one team of
 * different classes. Rules, in order:
 *
 *   1. One slot per material target - two characters farming the same ore map is a waste;
 *      the slot with the better-ranked candidate keeps the goal, the other takes its next.
 *   2. At most half the team may detach from the party for material runs - the shared party
 *      EXP of the remaining core is worth more than a third duplicated gatherer.
 *   3. Everyone else grinds the SHARED frontier map (frontier of the team's median level, so
 *      the party's 20-level rule holds) - together, because party EXP is team EXP.
 *
 * `rows` is [{ slot, lv, job, candidates }]; returns a Map of slot -> goal (null keeps the
 * slot's own decision).
 */
function teamAssign(rows, wiki, learnedOf) {
  const assigned = new Map();
  for (const r of rows) if (r.personalStrategy && r.candidates?.length) assigned.set(r.slot,{...r.candidates[0],from:'personal'});
  const claimed = new Set();
  const cursors = new Map(rows.map(r => [r.slot, 0]));
  const detachCap = Math.max(1, Math.floor(rows.length / 2));
  let detached = 0;

  for (let round = 0; round < 8 && assigned.size < rows.length; round++) {
    for (const r of rows) {
      if (assigned.has(r.slot)) continue;
      const i = cursors.get(r.slot) || 0;
      const cand = (r.candidates || [])[i];
      cursors.set(r.slot, i + 1);
      if (!cand) continue;
      if ((r.blockedMaps || {})[cand.mapId]) continue;
      if (cand.kind === 'exp') continue;                     // exp goals are the cohesion pass
      const key = (cand.mapId || '') + '|' + (cand.material || cand.monster || '');
      if (claimed.has(key)) continue;                        // a teammate already owns this target
      if (detached >= detachCap) continue;                   // the party needs its core
      claimed.add(key);
      detached++;
      assigned.set(r.slot, { ...cand, from: 'team' });
    }
  }

  // Cohesion pass: everyone left grinds the team's shared frontier map together.
  const rest = rows.filter(r => !assigned.has(r.slot));
  if (rest.length) {
    const levels = rest.map(r => r.lv).sort((a, b) => a - b);
    const median = levels[Math.floor(levels.length / 2)] || 1;
    const shared = frontierMap(median, wiki, learnedOf ? learnedOf(median) : null);
    for (const r of rest) {
      const own = (r.candidates || []).find(c => c.kind === 'exp' && !(r.blockedMaps || {})[c.mapId]);
      if(!own){assigned.set(r.slot,(r.candidates||[]).find(c=>c.kind!=='exp'&&!(r.blockedMaps||{})[c.mapId])||null);continue;}
      let goal = own || null;
      if (shared && own && !own.monsterId && !own.contextEvidence && own.mapId !== shared.id && Math.abs(r.lv - median) <= 10
          && r.lv >= shared.levelMin && !(r.blockedMaps || {})[shared.id]) {
        goal = { ...own, mapId: shared.id, mapName: shared.name, from: 'team',
          label: `ปาร์ตี้เก็บเวล ${shared.name} (Lv${shared.levelMin}–${shared.levelMax})`,
          reason: `ทีมไม่มีงานเฉพาะตัวให้ — เก็บ EXP รวมกันที่ ${shared.name} เพื่อโบนัสปาร์ตี้` };
      }
      assigned.set(r.slot, goal);
    }
  }
  return assigned;
}

// ------------------------------------------------------------------ learning

/**
 * Per-slot learned knowledge, persisted to data/learning/slot-XX.json.
 *
 * Fed from the game's own save stream (PUT /api/save): every save is a sample of the
 * character's state, so deltas between consecutive saves ARE the yield of the time spent
 * on that map - exp, coins, materials, and bestiary kills.
 */
class Learning {
  constructor(root, slot, wiki) {
    const dir = path.join(root, 'data', 'learning');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { }
    this.file = path.join(dir, `slot-${String(slot).padStart(2, '0')}.json`);
    this.wiki = wiki || null;
    this.data = { maps: {}, monsters: {} };
    try { this.data = { maps: {}, monsters: {}, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { }
    if (this.data.version !== 2) this.data = { version: 2, maps: {}, monsters: {}, legacy: this.data };
    this.totals = require('./reports').loadExpTable(root, economy.newestBuild(root));
    this.prev = null;
    this.prevAt = 0;
    this.dirty = false;
    this.lastWriteAt = 0;
  }

  /** Feed one save sample. Deltas outside sane bounds (level-up resets, town shopping) are dropped. */
  observe(save, now = Date.now()) {
    if (!save || !save.mapId || save.mapId === 'town') { this.prev = null; this.prevAt = 0; return; }
    const prev = this.prev, prevAt = this.prevAt;
    this.prev = save; this.prevAt = now;
    if (!prev || prev.mapId !== save.mapId) return;         // a sample must be one map's yield
    const dt = now - prevAt;
    if (dt <= 0 || dt > 30000) return;
    const map = this._map(save.mapId);
    map.ms += dt;
    let dexp = save.exp - prev.exp;
    if (save.lv > prev.lv && this.totals?.[save.lv] != null && this.totals?.[prev.lv] != null) dexp += this.totals[save.lv] - this.totals[prev.lv];
    if (save.lv < prev.lv || !Number.isFinite(dexp) || dexp < 0) dexp = 0;
    map.exp += dexp;
    map.eph = map.exp / (map.ms / 3600000);
    if (Number.isFinite(save.coins) && Number.isFinite(prev.coins)) map.coins += save.coins - prev.coins;
    this.dirty = true;
    const matDeltas = {};
    for (const [mat, n] of Object.entries(save.materials || {})) {
      const d = n - ((prev.materials || {})[mat] || 0);
      if (d > 0) { matDeltas[mat] = d; map.mats = map.mats || {}; map.mats[mat] = (map.mats[mat] || 0) + d; this.dirty = true; }
    }
    for (const [id, kills] of Object.entries(save.bestiary || {})) {
      const d = kills - ((prev.bestiary || {})[id] || 0);
      if (d > 0) {
        const mon = this._mon(id);
        mon.kills += d; mon.lastMap = save.mapId; this.dirty = true;
      }
    }
    // Attribute drops only if exactly one eligible species was killed in this sample.
    // Mixed kills and rewards are ambiguous, so they must not invent per-monster rates.
    for (const [mat, delta] of Object.entries(matDeltas)) {
      const killed = (this.wiki?.monsters?.monsters || []).filter(m =>
        (save.bestiary?.[m.id] || 0) > (prev.bestiary?.[m.id] || 0) && m.dropTable?.some(d => d.item === mat));
      if (killed.length === 1) {
        const mon = this._mon(killed[0].id);
        mon.drops[mat] = (mon.drops[mat] || 0) + delta;
      }
    }
  }

  /** Monsters of one map, for attributing drops to what AUTO actually attacks there. */
  monstersOn(mapId, wiki) {
    const map = (wiki.maps.maps || []).find(m => m.id === mapId);
    return map ? [...(map.monsters.normal || []), ...(map.monsters.miniboss || [])] : [];
  }

  _map(id) {
    if (!this.data.maps[id]) this.data.maps[id] = { ms: 0, exp: 0, coins: 0, eph: null };
    return this.data.maps[id];
  }
  _mon(id) {
    if (!this.data.monsters[id]) this.data.monsters[id] = { kills: 0, drops: {} };
    return this.data.monsters[id];
  }

  expPerHour(mapId) { const m = this.data.maps[mapId]; return m && m.ms > 120000 ? Math.round(m.eph) : null; }
  coinsPerHour(mapId) { const m = this.data.maps[mapId]; return m && m.ms >= 300000 ? Math.round(m.coins / (m.ms / 3600000)) : null; }
  observedRate(monsterId, item) {
    const mon = this.data.monsters[monsterId];
    if (!mon || !mon.drops || !(item in mon.drops)) return null;
    return { kills: mon.kills, rate: (mon.drops[item] || 0) / Math.max(1, mon.kills) };
  }
  summary() {
    const maps = Object.entries(this.data.maps)
      .filter(([, m]) => m.eph != null)
      .sort((a, b) => b[1].eph - a[1].eph).slice(0, 4)
      .map(([id, m]) => ({ mapId: id, expPerHour: Math.round(m.eph), minutes: Math.round(m.ms / 60000) }));
    const kills = Object.values(this.data.monsters).reduce((s, m) => s + m.kills, 0);
    return { maps, killsObserved: kills };
  }

  /** Persist learned data - throttled to one write a minute unless forced (shutdown). */
  save(force = false) {
    if (!this.dirty) return;
    const now = Date.now();
    if (!force && now - this.lastWriteAt < 60000) return;
    try {
      const tmp = this.file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
      this.lastWriteAt = now;
    } catch { }
  }
}

module.exports = { decideGoal, goalCandidates, teamAssign, frontierMap, Learning, mapIndex, bestMapFor, bestSourceFor, blendRate };
