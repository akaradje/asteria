'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const os = require('node:os'), vm = require('node:vm');
const pet = require('../src/runtime/active-pet'), planner = require('../src/planning/active-pet');
const evidence = require('../src/runtime/capability-evidence');
const {DurableStore} = require('../src/runtime/durable-store');
const {ActionScheduler} = require('../src/runtime/action-scheduler');
const build = JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build;
const native = require('../src/economy').loadCatalog(process.cwd(), build);
const raw = fs.readFileSync('cache/' + build + '/asteria-online.io/asteria-online-visual-polish.html', 'utf8');
const contracts = require('../src/knowledge/client-contracts'), original = contracts.extract(raw);
assert(planner.reviewed(process.cwd(), build)); assert.equal(original.pets.state, 'DISCOVERED');
for (const changed of [raw.replace('function summonPet(id)', 'function changedPet(id)'),
  raw.replace('() => summonPet(b.dataset.pet)', '() => changedPet(b.dataset.pet)'),
  raw.replace("const bookStat = T => BOOK_STAT[elTh(T)]", "const bookStat = T => BOOK_STAT[T.element]"),
  raw.replace('const EL_TH = Object.fromEntries(AsteriaWorld.ELEMENTS)', 'const EL_TH = {}')])
  assert.notEqual(contracts.extract(changed).pets.revision, original.pets.revision);
assert.equal(contracts.extract(raw + '\n' + contracts.petCallbacks(raw)[0]).pets.state, 'UNKNOWN');
const cap = require('../src/knowledge/capability-registry').registry(native);
assert.equal(cap.pets.contracts.petActive.inputs.budget, 'owned_pet_no_currency_cost');
assert.equal(cap.pets.contracts.petOptions.state, 'DISCOVERED', 'summon implementation never approves options');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asteria-v32-pet-'));
const oldReview = planner.reviewed, oldProjection = evidence.projection, oldConfirm = evidence.confirmed;
(async () => {
  const store = new DurableStore(path.join(tmp, 'ledger.db'));
  try {
    const actor = 'actor-' + 'a'.repeat(32), owner = store.acquire({accountId: 'fixture', actorId: actor, host: 'windows', session: 'one'});
    const monsters = [{id: 'fire', kind: 'normal', level: 80, element: 'ไฟ', race: 'สัตว์', name: 'Fire'},
      {id: 'water', kind: 'normal', level: 20, element: 'น้ำ', race: 'วิญญาณ', name: 'Water'}];
    const cat = {...native, world: {...native.world, MONSTERS: monsters}};
    const s = {lv: 120, job: 'asura', pets: {fire: 1000, water: 0}, petActive: null, petOpts: {},
      equip: {weapon: 'held'}, coins: 937, bag: ['held'], materials: {Ore: 2}};
    let clicks = 0, opens = 0, reads = 0, closes = 0, rev = 40, lost = false, blocked = false;
    const runId = '12345678-1234-1234-1234-123456789012', source = 'a'.repeat(64);
    fs.mkdirSync(path.join(tmp, 'logs/system-audit'), {recursive: true});
    const release = {sourceRevision: source, build, stages: {runId, soak3h: 'RUNNING', loads: [{host: 'windows', sourceRevision: source, build}]}};
    const manifest = path.join(tmp, 'logs/system-audit/architecture-release.json');
    fs.writeFileSync(manifest, JSON.stringify(release));
    const i = {root: tmp, machine: 'windows', loadedFarmRevision: source, actorIdentity: {actorId: actor}, actorOwner: owner,
      character: {id: 7}, bagSessionStartedAt: Date.now() - 60000, socialInbox: {generation: 2},
      registryV32: {store, policy: {policyRevision: 1, activePetCanaryActors: [actor], activePetCanaryRunId: runId}},
      page: {}, buildHash: build, catalog: () => cat, lastSave: s, lastSaveAt: Date.now(),
      livePos: {room: 'town', at: Date.now()}, vitals: {at: Date.now(), hp: 1},
      v2: {scheduler: new ActionScheduler(), sourceCoherence: {matches: true}, journal: {rows: []}},
      expeditionAuto: async () => {}, openGamePanel: async () => {opens++; return {ok: true};},
      closeGamePanel: async () => {closes++;}, canDo: () => true};
    const tile = {dataset: {pet: 'fire'}, disabled: false, classList: {contains: () => s.petActive === 'fire'},
      click() {assert.equal(store.pending(actor)[0].status, 'SENT'); clicks++; s.petActive = s.petActive === 'fire' ? null : 'fire';}};
    const body = {dataset: {panel: 'collection'}, querySelector: () => ({click() {}}), querySelectorAll: () => [tile]};
    const net = {online: true, isConnected: () => true, get block() {return blocked;}, account: {charId: 7},
      handlers: {resave() {}}, flush: async () => {}, api: async () => {
        reads++; if (lost && clicks >= 2) throw Error('native GET unavailable');
        const at = Date.now(); i.serverSaveReceipt = {state: structuredClone(s), proof: {authority: 'server_readback',
          actorId: actor, nativeId: '7', generation: 2, sessionStartedAt: i.bagSessionStartedAt, build, rev: ++rev, requestAt: at, at}};
      }};
    i.eval = async code => vm.runInNewContext(code, {window: {AsteriaNet: net}, document: {getElementById: () => body}});
    planner.reviewed = () => true;
    evidence.projection = () => ({pets: {revision: 'reviewed', contracts: {petActive: {state: 'READY'}}}});
    evidence.confirmed = () => true;
    assert(pet.gate(i, 'fire').allowed);
    const historical = {at: Date.now() - 180000, kind: 'craft', status: 'UNCERTAIN', target: {id: 'old-gear'}};
    i.v2.journal.rows = [historical]; assert(pet.gate(i, 'fire').allowed); assert.equal(historical.status, 'UNCERTAIN');
    for (const patch of [{at: Date.now()}, {kind: 'unknown'}, {kind: 'pets:petActive'}, {target: {id: 'fire'}}]) {
      i.v2.journal.rows = [{...historical, ...patch}]; assert(!pet.gate(i, 'fire').allowed);
    }
    i.v2.journal.rows = [];
    for (const patch of [{teamControl: true}, {dailyTeamPending: true}, {pendingTravel: {}}, {survivalRecovery: {}},
      {livePos: {room: 'd3', at: Date.now()}}, {goal: {bossReturnAt: Date.now() + 10000}},
      {socialInbox: {generation: 2, criticalGap: true}}, {vitals: {hp: .4, at: Date.now()}}, {lastSaveAt: Date.now() - 31000}])
      assert(!pet.gate({...i, ...patch}, 'fire').allowed);
    const off = await pet.equip({...i, registryV32: {...i.registryV32, policy: {}}});
    assert(!off.confirmed); assert.equal(reads, 0); assert.equal(opens, 0);
    s.petActive = 'fire'; const outgoing = await pet.equip({...i, registryV32: {...i.registryV32, policy: {}}});
    assert(outgoing.observed); assert(!outgoing.confirmed); assert.equal(clicks, 0); s.petActive = null;
    for (const patch of [{sourceRevision: 'foreign'}, {build: 'foreign'}, {stages: {...release.stages, runId: 'foreign'}}, {stages: {...release.stages, soak3h: 'COMPLETED'}}]) {
      fs.writeFileSync(manifest, JSON.stringify({...release, ...patch}));
      assert.equal((await pet.equip(i)).reason, 'pet-current-loaded-measured-run-required'); assert.equal(opens, 0);
    }
    fs.writeFileSync(manifest, JSON.stringify(release));
    const nativeScheduler=i.v2.scheduler;
    for(const skipped of [undefined,null]){
      i.v2.scheduler={run:async()=>skipped};
      const deferred=await pet.equip(i);
      assert.equal(deferred.worn,0);assert.equal(deferred.sent,false);
      assert.equal(deferred.reason,'pet-action-deferred-by-current-owner-contract');
      assert.equal(i.activePetPlan.status,'waiting');assert.equal(opens,0);assert.equal(clicks,0);
    }
    i.v2.scheduler=nativeScheduler;
    const out = await pet.equip(i); assert(out.confirmed); assert.equal(out.worn, 1);
    assert.equal(clicks, 1); assert.equal(closes, 1); assert.equal(store.get(out.id).status, 'CONFIRMED');
    assert.equal(store.held(actor)['pet-active-slot'], undefined); assert.equal(s.coins, 937);
    const row = store.get(out.id), after = structuredClone(i.serverSaveReceipt); assert(pet.result(row, after, i));
    for (const mutate of [r => r.proof.authority = 'outgoing_save', r => r.proof.generation++, r => r.proof.actorId = 'foreign',
      r => r.proof.sessionStartedAt++, r => r.proof.at = Date.now() + 60000, r => delete r.state.coins, r => r.proof.rev = row.target.beforeRev,
      r => r.proof.requestAt = row.sentAt - 1, r => r.state.coins--, r => r.state.petOpts.fire = [{v: 3}],
      r => r.state.pets.fire++, r => r.state.equip.weapon = 'foreign', r => r.state.petActive = null]) {
      const r = structuredClone(after); mutate(r); assert.equal(pet.result(row, r, i), null);
    }
    assert((await pet.equip(i)).confirmed); assert.equal(clicks, 1, 'already native-active never toggles OFF');
    i.serverSaveReceipt = null; s.petActive = null;
    assert.equal((await pet.equip(i)).reason, 'pet-one-attempt-per-run'); assert.equal(clicks, 1);
    i.registryV32.policy.activePetCanaryRunId = '22345678-1234-1234-1234-123456789012';
    release.stages.runId = i.registryV32.policy.activePetCanaryRunId; fs.writeFileSync(manifest, JSON.stringify(release));
    lost = true; const uncertain = await pet.equip(i); assert(!uncertain.confirmed);
    assert.equal(clicks, 2); assert.equal(store.get(uncertain.id).status, 'UNCERTAIN');
    i.serverSaveReceipt = null; store.recover(actor);
    assert.equal((await pet.equip(i)).reason, 'pet-one-attempt-per-run'); assert.equal(clicks, 2);
    blocked = true; assert.equal(await pet.nativeButton(i, 'fire', true), false); assert.equal(clicks, 2);
    const policyRoot = path.join(tmp, 'policy');fs.mkdirSync(path.join(policyRoot,'machines'),{recursive:true});fs.mkdirSync(path.join(policyRoot,'logs/registry-keys'),{recursive:true});
    fs.writeFileSync(path.join(policyRoot,'machines/runtime-v32.json'),JSON.stringify({version:1,realm:'r',epoch:'e',epochEvidence:'fixture',policyRevision:1}));
    fs.writeFileSync(path.join(policyRoot,'machines/fleet.json'),JSON.stringify({leader:'One',members:[{machine:'windows',slot:0,charName:'One'}]}));
    const policyFile=path.join(policyRoot,'logs/registry-keys/runtime-policy.json');
    for(const patch of [{activePetCanaryActors:[actor,actor]},{activePetCanaryActors:['One']},{activePetCanaryRunId:'------------------------------------'}]){
      fs.writeFileSync(policyFile,JSON.stringify({version:1,host:'windows',...patch}));assert.throws(()=>require('../src/registry/registry').policy(policyRoot),/Active pet/);
    }

    console.log('PASS W12: native owned-pet toggle, current loaded measured run, role choice, default OFF, durable-before-send, exact GET delta and no ambiguous/restart/already-active replay');
  } finally {
    planner.reviewed = oldReview; evidence.projection = oldProjection; evidence.confirmed = oldConfirm;
    store.close(); fs.rmSync(tmp, {recursive: true, force: true});
  }
})().catch(e => {console.error(e); process.exitCode = 1;});
