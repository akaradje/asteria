'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const fresh = require('./freshness'), storage = require('./isolated-storage');
const planner = require('../planning/active-pet'), evidence = require('./capability-evidence');

// Native summonPet toggles the same pet OFF. An outgoing save or selected tile
// is neither a receipt nor permission to retry an ambiguous click.
const stable = ['pets', 'petOpts', 'popts', 'plk', 'bag', 'storage', 'equip', 'refine',
  'stage', 'holes', 'sockets', 'weaponOpts', 'coins', 'tokens', 'runeDust',
  'leaves', 'materials', 'keyItems'];
function owned(s, id, cat) {
  return !!s?.pets && Object.hasOwn(s.pets, id) && Number.isSafeInteger(s.pets[id]) &&
    s.pets[id] >= 0 && cat.world.MONSTERS?.some(m => m.id === id);
}
function currentReceipt(i, receipt, now = Date.now()) {
  const p = receipt?.proof;
  return !!p && p.authority === 'server_readback' &&
    p.actorId === i.actorIdentity?.actorId && p.nativeId === String(i.character?.id) &&
    p.generation === i.socialInbox?.generation && p.sessionStartedAt === i.bagSessionStartedAt &&
    p.build === i.catalog().build && Number.isSafeInteger(p.rev) &&
    p.at >= p.requestAt && fresh.fresh(p.requestAt, 5000, now) && fresh.fresh(p.at, 5000, now) &&
    i.registryV32?.store.validateOwner(i.actorOwner) === true;
}
function measuredRun(i, runId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId || '')) return false;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(i.root, 'logs/system-audit/architecture-release.json')));
    return m.sourceRevision === i.loadedFarmRevision && m.build === i.catalog().build &&
      m.stages?.runId === runId && m.stages.soak3h === 'RUNNING' &&
      m.stages.loads?.some(h => h.host === i.machine && h.sourceRevision === i.loadedFarmRevision && h.build === m.build);
  } catch { return false; }
}
function gate(i, id, now = Date.now()) {
  const deny = reason => ({allowed: false, reason});
  if (!i.actorIdentity?.actorId || !i.actorOwner || !i.v2?.scheduler ||
      !i.registryV32?.store.validateOwner(i.actorOwner) || !require('../registry/worker').valid(i))
    return deny('pet-current-native-owner-required');
  if (!owned(i.lastSave, id, i.catalog()) || !planner.reviewed(i.root, i.catalog().build))
    return deny('pet-owned-current-rules-required');
  if (i.socialInbox?.criticalGap || !fresh.decisionGate(i, now).allowed ||
      i.v2.sourceCoherence?.matches !== true || !fresh.fresh(i.vitals?.at, 15000, now) ||
      i.vitals.hp < .85 || i.livePos?.dead || i.livePos?.room !== 'town')
    return deny('pet-fresh-idle-town-required');
  const independent = storage.unrelated(i, id, now);
  const admission = independent ? {...i, v2: {...i.v2, journal: {rows: []}}} : i;
  if (!require('./v3-instance').optionalWork(admission, now) || !independent ||
      i.freeRewardsBusy || ['uncertain_no_replay', 'legacy_reward_outcome_needs_identity_reconciliation'].includes(i.freeRewards?.status))
    return deny('pet-other-owner-or-uncertain-action');
  const deadlines = [i.goal?.bossReturnAt, i.bossWindow?.departAt, i.bossWindow?.returnAt].filter(Number.isFinite);
  if (deadlines.some(at => at - now < 30000) || ['boss-live', 'return-to-boss', 'preposition'].includes(i.bossWindow?.phase))
    return deny('pet-boss-foreground-required');
  return {allowed: true};
}
function result(row, receipt, i) {
  const t = row?.target, p = receipt?.proof, s = receipt?.state;
  if (!t || !currentReceipt(i, receipt) || p.actorId !== row.actorId ||
      p.generation !== row.generation || p.requestAt < row.sentAt ||
      p.rev <= t.beforeRev || p.sessionStartedAt !== t.sessionStartedAt || i.actorOwner.session !== row.session ||
      evidence.projection(i).pets?.revision !== row.contractRevision ||
      t.build !== i.catalog().build || !owned(s, t.id, i.catalog()) ||
      s.petActive !== t.id || t.before.petActive === t.id ||
      !Number.isSafeInteger(s.coins) || s.coins < 0 || !Number.isSafeInteger(t.before.coins) || t.before.coins < 0 ||
      stable.some(k => !storage.equal(s[k], t.before[k]))) return null;
  return {id: t.id, previous: t.before.petActive || null, rev: p.rev,
    ownershipUnchanged: true, gearUnchanged: true, currencyCost: 0,
    measuredCombatBenefit: false, scope: 'native_GET_after_one_owned_pet_toggle'};
}
async function nativeButton(i, id, click = false) {
  return i.eval(`(() => {const n=window.AsteriaNet,p=document.getElementById('pBody');
    if(!n?.online||!n.isConnected?.()||n.block||n.pause||n.fixed||n.kicked||p?.dataset.panel!=='collection')return false;
    const b=Array.from(p.querySelectorAll('.mon-tile[data-pet]')).find(b=>b.dataset.pet===${JSON.stringify(id)});
    if(!b||b.disabled||b.classList.contains('sel'))return false;
    ${click ? 'b.click();' : ''}return true;})()`);
}
async function execute(i, best) {
  const actor = i.actorIdentity.actorId, policy = i.registryV32.policy;
  if (!policy.activePetCanaryActors?.includes(actor)) return {worn: 0, reason: 'pet-canary-not-selected'};
  if (!measuredRun(i, policy.activePetCanaryRunId)) return {worn: 0, reason: 'pet-current-loaded-measured-run-required'};
  const store = i.registryV32.store;
  const id = 'pet-canary:' + crypto.createHash('sha256').update(actor + '|' + policy.activePetCanaryRunId).digest('hex');
  if (store.get(id)) return {worn: 0, reason: 'pet-one-attempt-per-run', id};
  const access = gate(i, best.id);
  if (!access.allowed) return {worn: 0, reason: access.reason};
  const cap = evidence.projection(i).pets;
  if (!['READY', 'VERIFIED'].includes(cap?.contracts.petActive?.state)) return {worn: 0, reason: 'pet-current-action-review-required'};
  await i.expeditionAuto(false);
  try {
    const opened = await i.openGamePanel('collection');
    if (!opened || opened.ok === false) return {worn: 0, reason: 'pet-native-collection-required'};
    await i.eval(`(()=>{const p=document.getElementById('pBody');if(p?.dataset.panel!=='collection')return false;const b=p.querySelector('[data-col-tab="pets"]');if(!b||b.disabled)return false;b.click();return true;})()`);
    const before = await storage.readback(i);
    if (!currentReceipt(i, before) || !Number.isSafeInteger(before.state.coins) || before.state.coins < 0 || !owned(before.state, best.id, i.catalog()) ||
        !storage.equal(before.state.pets, i.lastSave.pets) ||
        before.state.petActive !== (i.lastSave.petActive || null)) return {worn: 0, reason: 'pet-native-baseline-required'};
    if (before.state.petActive === best.id) return {worn: 0, confirmed: true, pet: best.id, evidence: 'server_readback', actionSent: false};
    const selected = planner.choose({...i, lastSave: before.state}, i.catalog()).selected;
    if (selected?.id !== best.id || !await nativeButton(i, best.id)) return {worn: 0, reason: 'pet-plan-or-native-button-changed'};
    i.v2.scheduler.checkpoint();
    if (!gate(i, best.id).allowed || !currentReceipt(i, before) ||
        evidence.projection(i).pets?.revision !== cap.revision) return {worn: 0, reason: 'pet-owner-or-rules-changed'};
    const claim = 'pet-active-slot';
    const row = store.begin({id, actorId: actor, session: i.actorOwner.session, generation: before.proof.generation,
      kind: 'pets:petActive', bill: {[claim]: 1}, available: {[claim]: 1}, contractRevision: cap.revision,
      target: {id: best.id, build: before.proof.build, sessionStartedAt: before.proof.sessionStartedAt, runId: policy.activePetCanaryRunId,
        beforeRev: before.proof.rev, before: structuredClone(before.state)}});
    store.sent(id);
    try {
      if (!await nativeButton(i, best.id, true)) throw Error('pet_native_callback_not_observed');
      const after = await storage.readback(i), proof = result(store.get(id), after, i);
      if (!proof) throw Error('pet_native_outcome_unconfirmed');
      store.receipt(id, {receiptId: 'pet:' + id + ':' + after.proof.rev, actorId: actor,
        session: row.session, generation: row.generation, kind: row.kind,
        authority: 'server_readback', at: after.proof.at, applied: true, proof});
      try { evidence.confirmed(i, id, 'pets', 'petActive'); } catch { i.activePetEvidenceError = 'Native receipt preserved; capability projection needs refresh'; }
      return {worn: 1, confirmed: true, sent: true, pet: best.id, id, evidence: 'server_readback', measuredCombatBenefit: false};
    } catch {
      store.transition(id, 'UNCERTAIN', {reason: 'Sole native pet toggle has no exact server readback; no replay'});
      return {worn: 0, sent: true, pet: best.id, id, reason: 'pet-native-result-uncertain-no-replay'};
    }
  } finally { await i.closeGamePanel().catch(() => {}); }
}
async function equip(i) {
  const now = Date.now(), s = i.lastSave, cat = i.catalog();
  if (!s || !fresh.fresh(i.lastSaveAt, 30000, now)) return {worn: 0, reason: 'fresh pet save required'};
  if (!planner.reviewed(i.root, cat.build)) return {worn: 0, reason: 'pet mechanics require source review'};
  const decision = planner.choose(i, cat, now), best = decision.selected;
  i.activePetPlan = {at: now, selected: best || null, growth: i.endgameGrowth || null, rare: i.rarePetPlan || null,
    bestNow: decision.best, target: decision.target, projected: decision.projected, mode: decision.mode,
    reason: decision.reason, active: s.petActive || null, owned: planner.rank(s, cat, i.root).length,
    method: 'role-weighted native rules and verified owned options; not measured DPS', status: 'observed'};
  if (!best) return {worn: 0, reason: 'no verified owned pets'};
  const native = i.serverSaveReceipt;
  if (s.petActive === best.id && currentReceipt(i, native) && owned(native.state, best.id, cat) && native.state.petActive === best.id) {
    i.activePetPlan.status = 'native-confirmed';
    return {worn: 0, confirmed: true, pet: best.id, evidence: 'server_readback', actionSent: false};
  }
  if (!i.registryV32?.policy.activePetCanaryActors?.includes(i.actorIdentity?.actorId))
    return {worn: 0, observed: s.petActive === best.id, reason: 'pet-canary-not-selected'};
  if (!i.v2?.scheduler) return {worn: 0, reason: 'pet-current-native-owner-required'};
  const contract = require('./action-contract').contract(i, 'active-pet');
  // A scheduler refusal has no native outcome. Keep the caller's result
  // contract explicit so stale position/another owner cannot abort chores.
  const out = await i.v2.scheduler.run('active-pet', () => execute(i, best), {contract}) ||
    {worn: 0, sent: false, reason: 'pet-action-deferred-by-current-owner-contract'};
  i.activePetPlan.active = out.confirmed ? out.pet : i.lastSave.petActive || null;
  i.activePetPlan.status = out.confirmed ? 'native-confirmed' : out.sent ? 'uncertain-no-replay' : 'waiting';
  i.activePetPlan.action = {at: Date.now(), pet: out.pet || best.id, id: out.id || null,
    status: i.activePetPlan.status, reason: out.reason || null, evidence: out.evidence || null};
  return out;
}
async function tick(i, screen = {}) {
  if (screen.death || screen.panelOpen || i.pendingTravel || i.teamControl || i.choresBusy ||
      i.recycling || !i.canDo('activeBestPet', 60000)) return null;
  const r = await equip(i);
  return r.worn ? 'pet native-confirmed: ' + r.pet : null;
}
function view(i) {
  const p = i.activePetPlan;
  return p ? {at: p.at, status: p.status, active: p.active, selected: p.selected?.id || null,
    mode: p.mode, method: p.method, action: p.action || null} : null;
}
module.exports = {equip, tick, execute, gate, result, owned, currentReceipt, measuredRun, nativeButton, view};
