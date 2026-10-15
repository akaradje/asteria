// supervisor.js - runs N autonomous clients and keeps them alive.
//
// Responsibilities the per-instance controller cannot have:
//   * stagger the launches so N Chromium starts do not spike the machine at once
//   * a memory governor: refuse to start a window, or shed the newest one, when the
//     host is nearly out of RAM (each client is a real browser, so this is the real limit)
//   * restart a slot whose controller threw, with backoff
//   * periodic status table + a JSON snapshot on disk
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { GameInstance } = require('./instance');
const { BrowserPool } = require('./browserpool');
const { positionOf } = require('./team-map');
const { Reports } = require('./reports');
const director = require('./director');
const economy = require('./economy');
const { AssetCache } = require('./assetcache');
const api = require('./api');
const {maintenanceBlock,purgeBlock}=require('./runtime/memory-maintenance');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Supervisor {
  constructor(opts = {}) {
    this.root = opts.root || process.cwd();
    this.machine = opts.machine || null;
    this.fairRotation = !!opts.fairRotation;
    this.runtimeV2 = !!opts.runtimeV2;
    this.serialBoot = !!opts.serialBoot;
    this.sharedGuild = opts.sharedGuild || null;
    this.activityAutomationPaused = !!opts.activityAutomationPaused;
    this.federation = (opts.federation||require('./planning/host-team-scope').team(this.root,this.machine)) ? new (require('./federation').Federation)(this.root,this.machine,{log:m=>this.log(m)}) : null;
    this.gameKnowledge = opts.gameKnowledge ? new (require('./game-knowledge').GameKnowledge)(this.root,{log:m=>this.log(m,'info')}) : null;
    this.teamRoom = new (require('./team-room').TeamRoom)(this.root);
    this.reports = new Reports(this.root, opts.build || 'unversioned',undefined,{machine:this.machine});
    this.count = opts.count || 1;
    this.width = opts.width || 480;
    this.height = opts.height || 270;
    this.headless = opts.headless !== false;
    this.noDraw = !!opts.noDraw;
    this.noGpu = opts.noGpu !== false;
    this.fullChrome = !!opts.fullChrome;
    this.targetFps = opts.targetFps || 30;
    this.liteTextures = !!opts.liteTextures;
    this.sceneSyncMs = opts.sceneSyncMs || 250;
    this.splitBrowsers = !!opts.splitBrowsers;
    // One Chromium browser shared by every window; each window is an isolated context on it
    // (see browserpool.js - this removes the roughly 1GB/window of per-browser overhead).
    this.browserPool = new BrowserPool({
      headless: this.headless, noDraw: this.noDraw, noGpu: this.noGpu,
      fullChrome: this.fullChrome, splitBrowsers: this.splitBrowsers, log: (m, l) => this.log(m, l),
      gpuMemoryMb: opts.gpuMemoryMb || 0,
      softwareUi: !!opts.softwareUi,
    });
    this.roamRadius = opts.roamRadius || 120;
    this.potPct = opts.potPct || 50;
    this.stuckMs = opts.stuckMs || 180000;
    this.townStuckMs = opts.townStuckMs || 30000;
    this.huntMap = opts.huntMap || 'w1';
    this.jobPreference = opts.jobPreference || null;
    // Character build
    this.autoBuild = opts.autoBuild !== false;
    this.holdPointsAsNovice = opts.holdPointsAsNovice !== false;
    this.preferHotbarSkills = !!opts.preferHotbarSkills;
    this.autoRestock = opts.autoRestock !== false;
    this.restockBelow = opts.restockBelow || 20;
    // slot -> {username, password} for a named bot team; empty means guest accounts.
    this.teamCredentials = opts.teamCredentials || {};
    this.roster = opts.roster || null;              // [{charName, job}] for item hand-offs
    this.autoChores = opts.autoChores !== false;
    this.choresEveryMs = opts.choresEveryMs || 600000;
    // Live preview frames for the control panel. On by default: being able to see the
    // windows is the point of the panel, and the capture is rate-limited to ~1/s per window.
    this.framesOn = opts.frames !== false;
    this.frameEveryMs = opts.frameEveryMs || 1200;
    this.framesDir = path.join(this.root, 'logs', 'frames');
    this.minFreeMb = opts.minFreeMb || 700;
    this.criticalFreeMb = opts.criticalFreeMb || 350;
    // What one window is expected to cost. The launch check subtracts this, so the governor
    // stops while there is still headroom instead of filling the machine and then shedding.
    //
    // This is the *grown* cost, not the cost at launch, and it is the number that decides the
    // window count. Measured 2026-09-28: baseline 9,321MB free, four grown windows -> 885MB
    // free, i.e. 2,109MB each. At the old 1,600 the gate happily launched a fifth window
    // (5*1600+700 = 8,700 < 9,321) and the steady state could not hold it - free memory fell
    // to 406MB and the recycler tore a window down every ~90s until it hit its 10-minute gap
    // and the shed threshold took over. 1,900 refuses that fifth window while still allowing
    // the four that fit. Override with --windowcost= if your machine differs.
    this.windowCostMb = opts.windowCostMb || 1900;
    // Recycle a window rather than lose it when memory gets tight (see instance.recycle).
    this.recycleBelowMb = opts.recycleBelowMb || 1200;
    this.recycleMinGapMs = opts.recycleMinGapMs || 600000;
    this.recycleMinAgeMs = opts.recycleMinAgeMs || 180000;
    this.statusEveryMs = opts.statusEveryMs || 30000;

    // Party formation. Every window joins one party led by the lowest live slot, because a
    // dungeon run and shared EXP both need it (see PLAN-SOCIAL.md). Off with --no-party.
    // A member that reconnects is dropped from the party, so this is re-checked, not done once.
    this.partyOn = opts.party !== false;
    this.partyEveryMs = opts.partyEveryMs || 45000;
    this.partyChecking = false;
    this.lastPartyAt = 0;
    this.partyInfo = null;      // last thing the server said the party was
    // Guild membership rides the same timer. The guild itself is founded once by hand
    // (scripts/create-guild.js) because it costs 30,000 Copper; this only invites.
    this.guildOn = opts.guild !== false;
    this.guildInfo = null;
    // Asteria Tower: open every day, 1-6 players. Rides the same timer as the party.
    this.towerOn = opts.tower !== false;
    this.towerInfo = null;
    // Slots the RAM governor refused at launch. Retried from the status timer, never dropped.
    this.deferred = [];
    // A farm-wide throttle on recycling, so a RAM dip cannot trigger a "recycle storm".
    this.recycleFarmGapMs = opts.recycleFarmGapMs || 90000;   // minimum settle time between recycles, farm-wide; one in flight also blocks a new one
    this.lastFarmRecycleAt = 0;
    // Calm-time rotation: while the farm is fully up and RAM is comfortable, recycle the
    // oldest window every rotateEveryMs. The emergency path below only acts once memory is
    // already gone - on a 6-window farm that means recycling while the machine thrashes,
    // when a boot takes ~350s and fails. Rotation keeps windows from ever reaching their
    // ~2.1GB old age together, so the emergency path rarely fires at all. 0 disables it.
    this.rotateEveryMs = opts.rotateEveryMs != null ? opts.rotateEveryMs : 1200000;   // 20 min
    // Renderer purge (see instance.purgeMemory): every window purges itself on this schedule
    // (--purge=0 disables), and the governor runs a farm-wide round BEFORE it spends a recycle
    // or a shed - a purge hands purgable caches back in seconds, where a recycle tears a
    // window down for minutes and a shed loses it for good.
    this.purgeEveryMs = opts.purgeEveryMs != null ? opts.purgeEveryMs : 600000;
    this.lastGovernorPurgeAt = 0;
    this.purgeRoundBusy = false;
    this.governorBusy = false;
    this.launchStaggerMs = opts.launchStaggerMs || 12000;

    this.instances = [];
    this.stopping = false;
    // --no-audio aborts sound files at the route layer (see assetcache.js): decoded audio
    // is a few hundred MB per renderer that a bot has no use for.
    this.cache = new AssetCache(this.root, opts.build || 'unversioned', { blockAudio: !!opts.noAudio, liteWorldArt:!!opts.liteWorldArt && this.noDraw });
    this.stopFile = path.join(this.root, 'logs', '.stop');
    this.logFile = path.join(this.root, 'logs', `farm-${new Date().toISOString().slice(0, 10)}.log`);
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    try { fs.unlinkSync(this.stopFile); } catch { }
  }

  log(msg, level = 'info') {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
    console.log(line);
    try { fs.appendFileSync(this.logFile, line + '\n'); } catch { }
  }

  freeMb() { return Math.round(os.freemem() / 1048576); }

  makeInstance(slot) {
    return new GameInstance({
      slot, root: this.root, machine:this.machine,loadedFarmRevision:this.gameKnowledge?.systemIdentity.revision||null,
      reports: this.reports,
      width: this.width, height: this.height, headless: this.headless,
      noDraw: this.noDraw, roamRadius: this.roamRadius, potPct: this.potPct, stuckMs: this.stuckMs,
      noGpu: this.noGpu, fullChrome: this.fullChrome, targetFps: this.targetFps, splitBrowsers: this.splitBrowsers,
      liteTextures:this.liteTextures,sceneSyncMs:this.sceneSyncMs,
      browserPool: this.browserPool,
      townStuckMs: this.townStuckMs,
      huntMap: this.huntMap,
      jobPreference: this.jobPreference,
      autoBuild: this.autoBuild,
      holdPointsAsNovice: this.holdPointsAsNovice,
      preferHotbarSkills: this.preferHotbarSkills,
      autoRestock: this.autoRestock,
      restockBelow: this.restockBelow,
      credentials: this.teamCredentials[slot] || null,
      // The whole team, so the item planner can hand a drop to whoever can use it instead of
      // selling it for pennies.
      roster: this.roster,
      autoChores: this.autoChores,
      choresEveryMs: this.choresEveryMs,
      framesDir: this.framesOn ? this.framesDir : null,
      frameEveryMs: this.frameEveryMs,
      purgeEveryMs: this.purgeEveryMs,
      cache: this.cache,
      log: (m, l) => this.log(m, l),
    });
  }

  /** Launch one slot and keep it alive, with bounded retries and backoff. */
  async spawn(slot, maxAttempts = 5) {
    let closedRetry = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.stopping) return;
      this.capacityAdmissions ||=new(require('./registry/admission').Admission)();let admissionTicket;
      try{admissionTicket=this.capacityAdmissions.reserve({host:this.machine||'local',actorId:'assignment:'+slot,snapshot:{at:Date.now(),freeMb:this.freeMb()},estimateMb:this.windowCostMb,floorMb:this.minFreeMb});}
      catch{
        // A failed boot may have closed cleanly before RAM falls below admission.
        // Do not leave that old instance occupying the deferred slot forever.
        // Only this spawn's positively closed retry can be removed, never a
        // sibling replacement, parked/auth-required actor, or uncertain cleanup.
        if(closedRetry && this.instances[slot]===closedRetry && !closedRetry.parked
            && closedRetry.status==='stopped')this.instances[slot]=null;
        if(!this.deferred.includes(slot))this.deferred.push(slot);
        this.admission={at:Date.now(),state:'waiting_for_reserved_headroom',pending:this.capacityAdmissions.view()};return;
      }
      const inst = this.makeInstance(slot);
      if (this.activityAutomationPaused) inst.activityAutomationPaused = true;
      inst.onBrainReport = text => this.teamRoom.post('จอ '+slot,'หัวหน้าทีม',text,'result');
      inst.teamPeers=()=>this.federation?this.federation.peers(this.instances):this.instances.filter(Boolean);
      inst.teamEntryGate=()=>this.federation?this.federation.view().director:null;
      this.instances[slot] = inst;
      try {
        await inst.start();
        this.capacityAdmissions.release(admissionTicket.id,{settled:true});
        this.log(`slot ${slot} up: ${inst.character.name} (${inst.account.username})`);
        await inst.run({
          onStatus: (i, r) => { if (r !== 'ok') this.log(`slot ${slot} tick -> ${r}`); },
        });
        return;                                  // clean stop (shutdown or shed)
      } catch (e) {
        if(inst.parked)return;
        if(e.code==='ASTERIA_AUTH_REQUIRED'){let closed=false;try{await inst.stop();closed=true;}catch{}if(closed)this.capacityAdmissions.release(admissionTicket.id,{settled:true});inst.status='auth_required';inst.parked=true;inst.authRequired={at:Date.now(),reason:'native_authentication_required',resume:'reauthenticate registered account then start this actor'};this.log('slot '+slot+' requires authentication; no repeated login or replacement account','warn');return;}
        this.log(`slot ${slot} failed (attempt ${attempt}/${maxAttempts}): ${e.message}`, 'error');
        let closed=false;
        while(!closed&&!this.stopping){
          try{await inst.stop();closed=true;}
          catch{inst.status='cleanup_wait';inst.retryAt=Date.now()+60000;this.log(`slot ${slot} cleanup not confirmed; wait before replacement (no duplicate login)`,'warn');await sleep(60000);}
        }
        if (this.stopping) return;
        this.capacityAdmissions.release(admissionTicket.id,{settled:true});
        closedRetry=inst;
        if (attempt === maxAttempts) {
          if (!this.runtimeV2) { this.log(`slot ${slot} giving up`, 'error'); return; }
          inst.status='retrying';inst.retryAt=Date.now()+60000;
          this.log(`slot ${slot} retry budget reached -> cooling down 60s, slot remains supervised`,'warn');
          await sleep(60000);attempt=0;continue;
        }
        const backoff = Math.min(60000, 5000 * attempt);
        this.log(`slot ${slot} retrying in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
  }

  statusTable() {
    const rows = this.instances.filter(Boolean).map(i => i.snapshot());
    if (!rows.length) return 'no instances yet';
    const head = ['slot', 'status', 'lv', 'exp', 'coins', 'map', 'pot', 'fps', 'save(s)', 'noprog(s)', 'rec', 'err'];
    const body = rows.map(r => [
      r.slot, r.status, r.lv ?? '-', r.exp ?? '-', r.coins ?? '-', r.mapId ?? '-',
      r.potions ?? '-', r.fps ?? '-', r.lastSaveAgo ?? '-', r.noProgressFor ?? '-', r.recycles ?? 0, r.errors,
    ]);
    const w = head.map((h, i) => Math.max(String(h).length, ...body.map(b => String(b[i] ?? '').length)));
    const fmt = arr => arr.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ');
    return [fmt(head), w.map(x => '-'.repeat(x)).join('  '), ...body.map(fmt)].join('\n');
  }

  /**
   * The team brain: this farm is 6 accounts with 6 different classes, so hunting goals are
   * COORDINATED, not chosen per window. One gatherer per material target, at most half the
   * team detached from the party, everyone else on the shared frontier map (party EXP is
   * team EXP). Runs every ~3 min from the status timer; sets inst.teamGoal which
   * instance.refreshGoal() adopts in preference to its own decision.
   */
  assignTeamGoals() {
    const wiki = economy.loadWiki(this.root);
    if (!wiki || !wiki.maps) return;
    const playing = this.instances.filter(i => i && i.status === 'playing' && i.lastSave && i.lastSave.lv);
    const developmentPriorities=this.towerTeam?.learning.priorities()||[];
    for(const inst of playing){
      inst.developmentPriority=developmentPriorities.find(p=>p.slot===inst.slot)||null;
      inst.lastSave.developmentDefensive=!!inst.developmentPriority;
      inst.choresEveryMs=inst.developmentPriority?Math.min(this.choresEveryMs,300000):this.choresEveryMs;
    }
    if (playing.length < 2) return;                          // solo: the window decides for itself
    const recipes = wiki.crafting?.recipes||[];
    const rows = playing.flatMap(inst => {
      const save = inst.lastSave,now=Date.now();
      const buildHash=inst.cache?.dir?path.basename(inst.cache.dir):inst.buildHash;
      let cat,wings;
      try{
        if(!buildHash||!Number.isFinite(inst.lastSaveAt)||now-inst.lastSaveAt<0||now-inst.lastSaveAt>=30000)throw Error('fresh loaded-build observation required');
        cat=inst.catalog?.()||economy.loadCatalog(this.root,buildHash);
        if(cat.build!==buildHash||!cat.world||!cat.items)throw Error('catalog differs from actor loaded build');
        wings=economy.loadWings(this.root,buildHash);
        inst.teamPlanningStatus={state:'ready',build:buildHash,at:now};
      }catch(e){inst.teamGoal=null;inst.teamPlanningStatus={state:'waiting',build:buildHash||null,at:now,reason:e.message};return [];}

      const personal = require('./character-brain').profile(save, cat, wiki);
      inst.personalBrain = { combatObjective:personal.combatObjective, role: personal.role, progression:personal.progression, reserve: personal.reserve, coins: personal.coins, lowFunds: personal.lowFunds, craft: personal.craft, gearTargets: personal.gear.slice(0,3), availableFocuses: personal.availableFocuses, strategy: inst.brain.strategy(), recentDecisions: (inst.brain.data.decisions || []).slice(0,3) };
      let candidates = [];
      try {
        const refine = economy.refinePlan({ equip: save.equip || [], refine: save.refine || {},
          materials: save.materials || {}, coins: save.coins || 0, items: cat.items || {}, world:cat.world, wiki });
        const wing = economy.wingPlan({ job: save.job, materials: save.materials || {}, coins: save.coins || 0,
          lv: save.lv, world: cat.world, items: cat.items || {}, wings, recipes, held: economy.ownedNames(save) });
        const pets = economy.petPlan({ bestiary: save.bestiary || {}, wiki });
        const gear = personal.gear;
        candidates = director.goalCandidates(
          { lv: save.lv, job: save.job, coins: save.coins || 0, materials: save.materials || {},
            bestiary: save.bestiary || {}, mapId: save.mapId },
          { wiki, catalog:cat, personal, ...require('./planning/progression-work').context(inst), contextRecommendation: inst.contextRecommendation?.(wiki), farmEvidence: inst.v2?.farmEvidence, learningBuild: inst.v2?.learningRevision, currentSave: save, focus: inst.brain.strategy()?.action || this.towerTeam?.learning.priorities().find(p=>p.slot===inst.slot)?.focus, learned: inst.learning, blockedMaps: inst.brain.blocked(), refinePlan: refine, pets, wingPlan: wing, gear });
      } catch (e) { this.log(`team director: slot ${inst.slot} candidates failed: ${e.message}`, 'warn'); }
      return { slot: inst.slot, lv: save.lv, job: save.job, inst, candidates, personalStrategy: !!inst.brain.strategy() || personal.lowFunds, blockedMaps: inst.brain.blocked() };
    });
    // Only accepted, fresh actors may supply shared experience. Mixed builds have no
    // common measured frontier; use the wiki baseline until the loaded builds agree.
    const builds=new Set(rows.map(r=>r.inst.teamPlanningStatus.build));
    const learnedOf = lv => builds.size===1 ? rows.reduce((best, r) =>
      !best || Math.abs(r.lv-lv)<Math.abs(best.lv-lv) ? r : best, null)?.inst.learning||null : null;
    const assigned = director.teamAssign(rows, wiki, learnedOf);
    let changed = 0;
    for (const r of rows) {
      const goal = assigned.get(r.slot);
      const inst = r.inst;
      if(goal && (!inst.goal || inst.goal.label!==goal.label)){
        this.teamRoom.post('จอ '+inst.slot,'หัวหน้าทีม', 'เสนอเป้าหมาย: '+goal.label+' · '+goal.reason,'proposal');
        this.teamRoom.post('หัวหน้าทีม','จอ '+inst.slot, (goal.from==='personal'?'รักษาแผนรายตัว: ':'มอบหมาย: ')+goal.label,'assignment');
      }
      inst.teamGoal = goal;
      inst.teamGoalAt = Date.now();
      if (goal && (!inst.goal || inst.goal.label !== goal.label || inst.goal.mapId !== goal.mapId)) changed++;
    }
    if (changed) {
      this.log('team director: ' + rows.map(r => {
        const g = assigned.get(r.slot);
        return `จอ ${r.slot}(${r.job}) ${g ? '-> ' + g.label : 'ตัดสินใจเอง'}`;
      }).join(' · '), 'info');
    }
  }

  snapshotToDisk() {
    const now=Date.now(),file=path.join(this.root,'logs','status.json');
    if(this.machine==='vps'&&!this.federation?.localScope){const intent=(()=>{try{return JSON.parse(fs.readFileSync(path.join(this.root,'logs/fleet/primary.json')));}catch{return null;}})();for(const i of this.instances.filter(i=>i?.v2&&typeof i.catalog==='function'))require('./planning/cross-party').apply(i,intent,now);}
    if(this.lastSnapshotAt&&now>=this.lastSnapshotAt&&now-this.lastSnapshotAt<1000)return file;
    if(this.runtimeV2)this.checkSlotHealth();
    this.performance ||= new (require('./fleet-performance').FleetPerformance)(this.root);
    this.performance.sample(this.instances,this.count,this.freeMb());
    if(!this.federation&&(!this.nativeHostFeed||now-this.nativeHostFeed.at>=5000))this.nativeHostFeed={machine:this.machine,at:now,build:path.basename(this.cache.dir),members:this.instances.filter(i=>i?.actorIdentity).map(require('./federation').safeMember)};
    const p = path.join(this.root, 'logs', 'status.json');
    const data = {
      at: new Date().toISOString(),
      machine: this.machine,
      nativeHostFeed:this.nativeHostFeed||null,
      fleet: this.federation?.view() || null,
      governor: {target:this.count,deferred:[...this.deferred],windowCostMb:this.windowCostMb,minFreeMb:this.minFreeMb,splitBrowsers:this.splitBrowsers,serialBoot:this.serialBoot,rotateEveryMs:this.rotateEveryMs,revision:'reclaim-before-admission-v1',admission:this.admission||null,reclaim:this.lastReclaim||null},
      gameKnowledge: this.gameKnowledge?.view() || null,
      runtimeV2: this.runtimeV2 ? {enabled:true,expected:this.count,slots:this.instances.filter(Boolean).map(i=>({slot:i.slot,status:i.status,retryAt:i.retryAt||null,lastSaveAt:i.lastSaveAt,lastScreenAt:i.v2?.lastScreenAt||null}))} : null,
      freeMb: this.freeMb(),
      // What the RAM governor is doing, so the panel can say why a window is (or is not)
      // being recycled instead of leaving that to the log.
      recycle: { belowMb: this.recycleBelowMb, gapMs: this.recycleFarmGapMs, lastAt: this.lastFarmRecycleAt || null },
      performanceHealth: {sample:this.performance.data.current,persistence:this.performance.persistence||null},
      party: this.partyInfo,
      guild: this.guildInfo,
      tower: this.towerInfo,
      instances: this.instances.filter(Boolean).map(i => ({...i.snapshot(),teamPartyId:i.teamPartyId||null})),
    };
    try { fs.writeFileSync(p+'.tmp', JSON.stringify(data)); fs.renameSync(p+'.tmp',p);this.lastSnapshotAt=now; } catch { }
    return p;
  }

  checkSlotHealth(now=Date.now()) {
    for(const inst of this.instances.filter(Boolean)){
      if(this.stopping||inst.healthRecovery||inst.recycling||!inst.v2||['booting','retrying','stopping','stopped','cleanup_wait'].includes(inst.status))continue;
      const active=inst.v2.scheduler.view().active;
      const positionFresh=inst.livePos&&now-inst.livePos.at<10000;
      const screenAge=now-(Math.max(inst.v2.lastScreenAt||0,inst.v2.observation?.at||0)||inst.startedAt||now);
      const saveAge=now-(inst.lastSaveAt||inst.startedAt||now);
      const rendererStalled=require('./runtime/renderer-health').stalledRenderer(inst,now);
      const frozenContext=screenAge>=120000&&saveAge>=120000&&!positionFresh&&(!active||active.overdue);
      if(!rendererStalled&&!frozenContext)continue;
      if(rendererStalled||frozenContext){
        // Never trade a live dungeon quota for a telemetry-based intervention.
        const rooms=require('./runtime/room-policy');
        if([rooms.currentRoom(inst,now),inst.livePos?.room,inst.lastSave?.mapId].some(r=>rooms.roomPolicy(r).dungeon))continue;
        if(this.instances.some(i=>i&&(i.healthRecovery||i.recycling))||now-(this.lastRendererRecoveryAt||0)<90000)continue;
        this.lastRendererRecoveryAt=now;
      }
      inst.healthRecovery=true;
      const reason=rendererStalled?'three or more renderer timeouts over two minutes; screen/save stale despite socket position frames':'screen, save and position stale; scheduler overdue';
      const event=inst.v2.recovery?.begin('frozen_context',reason);
      this.log(`slot ${inst.slot} ${reason} -> closing frozen context for supervised recovery`,'warn');
      let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('context close timeout')),20000);});
      Promise.race([Promise.resolve().then(()=>inst.ctx?.close()),timeout]).then(()=>{if(event){event.status='context_closed_waiting_for_boot';inst.v2.recovery.save();}}).catch(e=>{if(event)inst.v2.recovery.finish(event,e);this.log(`slot health: ${e.message}`,'warn');}).finally(()=>{clearTimeout(timer);inst.healthRecovery=false;});
    }
  }

  /** Wait until a slot reports it is in the world (used to prime the asset cache). */
  async waitForPlaying(slot, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const i = this.instances[slot];
      if (i && i.status === 'playing') return true;
      if (this.stopping) return false;
      await sleep(2000);
    }
    return false;
  }

  async run() {
    // Read existing telemetry only when the panel requests it; no page evaluate or screenshots.
    this.rollingRefresh=new(require('./runtime/rolling-client-refresh').RollingRefresh)(this);
    setInterval(()=>this.rollingRefresh.tick().catch(e=>this.log('semantic refresh diagnostic: '+e.message)),5000).unref();
    process.on('message', message => {
      if(message?.type==='semantic-client-refresh'){try{this.rollingRefresh.request(message.build,message.sourceRevision);}catch(e){this.log('semantic refresh deferred: '+e.message);}return;}
      if (message?.type === 'ai-cancel') {
        for (const inst of this.instances.filter(Boolean)) inst.aiPending = null;
        return;
      }
      if (message?.type === 'ai-command' && process.connected) {
        const c = message.command;
        const inst = Number.isInteger(c?.slot) ? this.instances[c.slot] : null;
        const reason = inst ? require('./runtime/ai-command').accept(c, inst) || (inst.aiPending?'มีคำแนะนำเดิมรอตรวจ ไม่รับคำสั่งซ้อน':null) : 'ไม่พบตัวละคร';
        if (!reason && !inst.aiPending){inst.aiPending = c;inst.aiControl={id:c.id,actorId:c.actorId,build:c.build,action:c.action,at:Date.now(),expiresAt:c.expiresAt,state:'queued',status:'รับแผนแล้ว รอเจ้าของงานและตรวจข้อมูลสดก่อนใช้',evidence:'intent_queued_not_applied'};}
        this.teamRoom.post('สมองจอ '+c?.slot,'หัวหน้าทีม',String(c?.reason||'').slice(0,1000),'ai');
        this.teamRoom.post('หัวหน้าทีม','จอ '+c?.slot,reason || 'รับแผนและเข้าคิวตรวจข้อมูลล่าสุดก่อนทำ','decision');
        process.send({ type: 'ai-command-result', id: message.id, ok:!reason, status: reason || 'เข้าคิวตรวจซ้ำก่อนลงมือ' }, () => {});
        return;
      }
      if (message?.type !== 'team-map' || !process.connected) return;
      const at = Date.now();
      process.send({ type: 'team-map', id: message.id, at,
        members: this.instances.filter(Boolean).map(i => positionOf(i, at)) }, () => {});
    });
    this.log(`supervisor starting: ${this.count} window(s), ${this.width}x${this.height}, headless=${this.headless}, noDraw=${this.noDraw}`);
    this.log(`host: ${os.cpus().length} logical cores, ${(os.totalmem() / 1073741824).toFixed(1)}GB RAM, ${this.freeMb()}MB free now`);
    this.log(`asset cache: ${this.cache.dir}`);
    this.reports.setBuild(path.basename(this.cache.dir));
    if (this.framesOn) {
      // Drop frames from a previous run so the panel never shows a stale window.
      fs.mkdirSync(this.framesDir, { recursive: true });
      for (const f of fs.readdirSync(this.framesDir)) {
        if (f.endsWith('.jpg')) { try { fs.unlinkSync(path.join(this.framesDir, f)); } catch { } }
      }
      this.log(`live preview: ${this.framesDir} (1 frame / ${this.frameEveryMs}ms per window)`);
    } else {
      this.log('live preview: off');
    }

    const pending = [];

    // Status reporting starts immediately so the launch phase is observable too.
    const fleetTimer=this.federation?setInterval(()=>{
      try{
      this.federation.refreshDailyQuotas(this);
      this.federation.publish(this.instances,this.partyInfo,path.basename(this.cache.dir));
      this.federation.refreshTeamActivities(this);
      this.federation.exchange().then(()=>{
        // Send the accepted tum observation, rather than the previous round
        // that was on disk when the exchange started. Busy queued exchanges
        // defer this step to the exchange that actually writes the observation.
        if(this.machine==='windows'&&!this.federation.busy)return require('./expansion-dashboard').refresh();
      }).catch(e=>this.log(e.message,'warn'));
      // Invitations expire after 60s; party checks must not wait for the 30s
      // snapshot timer or a character's long maintenance tick.
      this.maybeFormParty().catch(e=>this.log(`party check failed: ${e.message}`,'warn'));
      }catch(e){this.log(`fleet publication failed: ${e.code||e.name}; retrying next tick`,'warn');}
    },5000):null;
    const healthRound=this.runtimeV2?new(require('./observability/runtime-health').HealthRound)(this):null;
    const healthTimer=healthRound?setInterval(()=>healthRound.pulse(),1000):null;
    const crossActivityTimer=this.machine==='vps'&&!this.federation?.localScope?setInterval(()=>{try{require('./runtime/cross-party-activities').pulse(this);}catch(e){this.log('cross-party activity: '+e.name,'warn');}},5000):null;
    // Publish already observed state independently of the 30s control/log beat.
    // This performs no page evaluation; preserve the original control cadence.
    const nativeObservationTimer=this.runtimeV2?setInterval(()=>{try{require('./observability/native-host-observation').write(this);}catch(e){this.log('native observation publication: '+e.name,'warn');}},3000):null;
    const snapshotTimer=this.runtimeV2?setInterval(()=>{try{this.snapshotToDisk();}catch(e){this.log('runtime snapshot: '+e.name,'warn');}},this.machine==='vps'?5000:10000):null;
    const statusTimer = setInterval(() => {
      const free = this.freeMb();
      this.log(`free RAM ${free}MB`);
      // The governor may await a purge round (seconds), so it runs detached and guards itself
      // against re-entry; the table and snapshot below keep their own beat either way.
      this.ramGovernor(free).catch(e => this.log(`RAM governor: ${e.message}`, 'warn'));
      console.log('\n' + this.statusTable() + '\n');
      this.snapshotToDisk();
      this.gameKnowledge?.poll(path.basename(this.cache.dir)).catch(e=>this.log(`game knowledge: ${e.message}`,'warn'));
      // Not awaited: the party round trip must never hold up the RAM governor or the status
      // table, and it rate-limits itself internally.
      this.maybeFormParty().catch(e => this.log(`party check failed: ${e.message}`, 'warn'));
      // The team brain: coordinate every window's hunting goal every ~3 min (6 ticks).
      this.teamTicks = (this.teamTicks || 0) + 1;
      if (this.teamTicks % 6 === 0) {
        try { this.assignTeamGoals(); } catch (e) { this.log(`team director: ${e.message}`, 'warn'); }
      }
      // Retry anything the governor refused at launch, now that memory may have changed.
      this.launchDeferred().catch(e => this.log(`deferred launch failed: ${e.message}`, 'warn'));
    }, this.statusEveryMs);

    // Slot 0 first: it pays the one-time network cost and fills the shared asset cache,
    // so every later window boots from disk instead of re-downloading ~2.5MB over a
    // slow link. Nothing else is launched until it is actually in the world.
    pending.push(this.spawn(0));
    if (this.count > 1) {
      this.log('priming asset cache with slot 0 ...');
      const ok = await this.waitForPlaying(0, +(process.env.PRIME_TIMEOUT_MS || 300000));
      this.log(ok ? `slot 0 is in the world; cache: ${JSON.stringify(this.cache.stats())}`
        : 'slot 0 did not reach the world in time; launching the rest anyway');
    }

    for (let i = 1; i < this.count; i++) {
      if (this.stopping) break;
      const free = this.freeMb();
      // Account for the cost of the window we are about to open, not just the floor. Without
      // this the governor happily launches until free RAM is *at* the floor, which leaves the
      // machine with ~600 MB and no headroom for a window that then grows.
      if (free - this.windowCostMb < this.minFreeMb) {
        this.log(`RAM governor: ${free}MB free, a window needs about ${this.windowCostMb}MB and the `
          + `floor is ${this.minFreeMb}MB - deferring slot ${i} and the rest for now.`, 'warn');
        this.log(`  to run all ${this.count} windows, free about `
          + `${Math.max(0, this.count * this.windowCostMb + this.minFreeMb - free)}MB more.`, 'warn');
        // DEFER, do not abandon. Boot is the worst possible moment to judge: the windows that did
        // start are still warming up, and the user is often still closing other apps. Breaking out
        // permanently is why a six-window run came up as three and stayed there - the remaining
        // slots were never tried again even after gigabytes freed up.
        for (let j = i; j < this.count; j++) if (!this.instances[j]) this.deferred.push(j);
        break;
      }
      pending.push(this.spawn(i));
      if(this.serialBoot){
        const ready=await this.waitForPlaying(i,180000);
        if(!ready&&!this.stopping){
          this.log(`slot ${i} still warming up; remaining slots wait for its recovery`,'warn');
          for(let j=i+1;j<this.count;j++)if(!this.instances[j]&&!this.deferred.includes(j))this.deferred.push(j);
          break;
        }
      }
      await sleep(this.launchStaggerMs);
    }

    let stopTimer = 0;
    const onSignal = async () => {
      this.log('shutdown requested');
      this.stopping = true;
      clearInterval(statusTimer);
      if(healthTimer)clearInterval(healthTimer);
      if(crossActivityTimer)clearInterval(crossActivityTimer);
      if(snapshotTimer)clearInterval(snapshotTimer);
      if(nativeObservationTimer)clearInterval(nativeObservationTimer);
      if(fleetTimer)clearInterval(fleetTimer);
      this.reports.flush(Date.now(), true);
      clearInterval(stopTimer);
      try { fs.unlinkSync(this.stopFile); } catch { }
      await Promise.all(this.instances.filter(Boolean).map(i => i.stop().catch(() => { })));
      // The contexts are closed; now kill the shared browser itself. Without this,
      // process.exit would leave one orphaned Chromium behind.
      await this.browserPool.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    // Graceful remote stop: the control panel drops a file, we notice it and shut down
    // cleanly (closing every browser context) instead of being killed, which would leave
    // orphaned Chromium processes behind.
    stopTimer = setInterval(() => {
      if (fs.existsSync(this.stopFile)) onSignal();
    }, 2000);

    await Promise.all(pending);
    // Deferred/replacement slots are not in the original startup promises.
    // Keep the V2 supervisor alive until an explicit shutdown.
    if(this.runtimeV2)while(!this.stopping)await sleep(1000);
    clearInterval(statusTimer);
    if(crossActivityTimer)clearInterval(crossActivityTimer);
      if(snapshotTimer)clearInterval(snapshotTimer);
      if(nativeObservationTimer)clearInterval(nativeObservationTimer);
    if(fleetTimer)clearInterval(fleetTimer);
    await this.browserPool.shutdown();       // last window gone - do not orphan the shared browser
    this.log('all slots finished');
  }

  /**
   * Start the windows the RAM governor refused at launch, as memory frees up.
   *
   * One at a time, re-reading free memory between each, so a burst of spawns cannot overshoot.
   * This is what turns "it only came up as three" into "it came up as three and grew to six".
   */
  async launchDeferred() {
    if (!this.deferred.length || this.stopping || this.admissionBusy || this.governorBusy || this.purgeRoundBusy) return;
    this.admissionBusy=true;
    try {
      const booting=()=>this.instances.some(i=>i&&(i.recycling||['init','booting'].includes(i.status)));
      if(this.serialBoot&&booting())return;
      let free=this.freeMb();const required=this.windowCostMb+this.minFreeMb;
      if(free<required){
        this.admission={at:Date.now(),state:'reclaiming',freeMb:free,requiredMb:required};
        await this.maybePurgeFor('deferred slot headroom',required);
        free=this.freeMb();
      }
      // A stop, a recovery, or another launch may have happened while reclaiming.
      if(this.stopping||!this.deferred.length||(this.serialBoot&&booting()))return;
      this.admission={at:Date.now(),state:free>=required?'starting':'waiting_for_memory',freeMb:free,requiredMb:required};
      if(free<required)return;
      const slot=this.deferred[0];
      if(this.instances[slot]){this.deferred.shift();return;}
      this.log(`RAM governor: ${free}MB free now - starting deferred slot ${slot}`);
      this.deferred.shift();
      this.spawn(slot).catch(e=>this.log(`slot ${slot} failed: ${e.message}`,'warn'));
    } finally {this.admissionBusy=false;}
  }

  /**
   * The RAM governor, one pass. Called from the status timer with that tick's free-memory
   * reading; never re-entered (governorBusy), because a purge round can outlast one tick.
   *
   * Three tiers, unchanged - shed, recycle, rotate - each now preceded by a purge step: a
   * renderer purge (instance.purgeMemory) hands purgable caches back to the OS in seconds,
   * so when it reclaims enough, the expensive action does not happen at all. Shedding loses
   * a window for good and a recycle interrupts one for minutes, so both try the cheap
   * reclaim first - but at most once every two minutes: memory still short after a purge is
   * memory genuinely held, and then the expensive action must go ahead.
   */
  async ramGovernor(free) {
    if (this.governorBusy || this.admissionBusy || this.stopping) return;
    this.governorBusy = true;
    try {
      if(this.runtimeV2&&this.fairRotation&&this.deferred.length&&free>=this.recycleBelowMb&&this.rotateEveryMs&&Date.now()-(this.lastFarmRecycleAt||0)>this.recycleFarmGapMs){
        const victim=this.instances.filter(i=>!maintenanceBlock(i))
          .sort((a,b)=>a.startedAt-b.startedAt)[0];
        if(victim&&Date.now()-victim.startedAt>=this.rotateEveryMs){
          this.log(`RAM-limited roster: parking slot ${victim.slot} so queued accounts get a turn`,'info');
          this.lastFarmRecycleAt=Date.now();await this.deferInstance(victim);return;
        }
      }
      if (free < this.criticalFreeMb) {
        const alive = this.instances.filter(i => !maintenanceBlock(i));
        const victim = alive[alive.length - 1];
        if (!victim) return;
        if (await this.maybePurgeFor('critical memory', this.criticalFreeMb)) return;
        if(this.stopping)return;
        // Re-read after the purge round: a window may have stopped while it ran.
        const v = this.instances.filter(i => !maintenanceBlock(i)).pop();
        if (!v) return;
        this.log(`RAM critical (${this.freeMb()}MB): shedding slot ${v.slot}`, 'warn');
        v.status = 'stopping';
        if(this.runtimeV2){
          await this.deferInstance(v);
        }else v.stop().catch(() => { });
      } else if (free < this.recycleBelowMb) {
        // Below this, a window's memory growth is the problem rather than the number of
        // windows. Recycle the longest-running one: closing the browser releases what a page
        // reload cannot, and the window comes straight back instead of being lost.
        //
        // Two guards that a per-window gap does NOT give:
        //
        //  1. A farm-wide gap, and strictly ONE recycle at a time. A recycle is itself
        //     expensive - under memory pressure it takes ~180s and sometimes fails - so when
        //     free RAM dips, recycling every old window in quick succession (a "recycle
        //     storm") makes the memory problem worse, not better. The time gap alone cannot
        //     enforce that: a recycle outlasts the 90s settle time, so a new one is also
        //     blocked while any recycle is still in flight. Recycle ONE, let it come back
        //     and the memory settle, then consider the next.
        //  2. Never interrupt an active instanced run. A window in the Asteria Tower ('tw') or
        //     the Eclipse Rift ('dx') loses the run if it is recycled, and a window mid-chores
        //     loses its economy pass. Defer those; reclaim from a window doing nothing.
        const farmGapOk = Date.now() - (this.lastFarmRecycleAt || 0) > this.recycleFarmGapMs;
        const recycleInFlight = this.instances.some(i => i && i.recycling);
        const inRun = i => !!maintenanceBlock(i);
        const alive = this.instances.filter(i => i && i.status === 'playing' && !i.recycling && !inRun(i));
        const oldest = alive.sort((a, b) => a.startedAt - b.startedAt)[0];
        if (oldest && farmGapOk && !recycleInFlight) {
          // The first recycle of a window may happen sooner than the gap between recycles:
          // memory gets tight during the launch phase, when every window is still young, and
          // waiting ten minutes there would mean never reclaiming at the moment it matters.
          const sinceRecycle = Date.now() - (oldest.lastRecycleAt || 0);
          const age = Date.now() - oldest.startedAt;
          const allowed = oldest.lastRecycleAt ? sinceRecycle > this.recycleMinGapMs : age > this.recycleMinAgeMs;
          if (allowed) {
            if (await this.maybePurgeFor('low system memory', this.recycleBelowMb)) return;
            if (maintenanceBlock(oldest) || this.stopping) return;
            oldest.lastRecycleAt = Date.now();
            this.lastFarmRecycleAt = Date.now();
            this.log(`RAM low (${this.freeMb()}MB): recycling slot ${oldest.slot} to reclaim memory`, 'warn');
            oldest.recycle('low system memory').catch(e => this.log(`slot ${oldest.slot} recycle failed: ${e.message}`, 'error'));
          }
        }
      } else if (this.rotateEveryMs > 0 && free > this.recycleBelowMb + 500) {
        // Calm-time rotation (see the rotateEveryMs note in the constructor). Same guards as
        // the emergency path - one recycle at a time, never a busy or instanced window - plus
        // every slot must be up, because rotation is a luxury and must never compete with a
        // boot. The victim is the window with the oldest EFFECTIVE age (last recycled or
        // launched, whichever is later) that has passed rotateEveryMs.
        const farmGapOk = Date.now() - (this.lastFarmRecycleAt || 0) > this.recycleFarmGapMs;
        const recycling = this.instances.some(i => i && i.recycling);
        const inRun = i => !!maintenanceBlock(i);
        const alive = this.instances.filter(i => i && i.status === 'playing' && !i.recycling && !inRun(i));
        const up = this.instances.filter(Boolean);
        const oldest = alive.sort((a, b) =>
          (a.lastRecycleAt || a.startedAt) - (b.lastRecycleAt || b.startedAt))[0];
        if (oldest && farmGapOk && !recycling && alive.length === up.length) {
          const effAge = Date.now() - (oldest.lastRecycleAt || oldest.startedAt);
          if (effAge > this.rotateEveryMs) {
            oldest.lastRecycleAt = Date.now();
            this.lastFarmRecycleAt = Date.now();
            this.log(`farm calm (${this.freeMb()}MB): recycling slot ${oldest.slot} (rotation - keep windows young)`, 'warn');
            oldest.recycle('rotation').catch(e => this.log(`slot ${oldest.slot} recycle failed: ${e.message}`, 'error'));
          }
        }
      }
    } finally {
      this.governorBusy = false;
    }
  }

  async deferInstance(instance){
    instance.parked=true;
    await instance.stop();
    if(this.instances[instance.slot]===instance)this.instances[instance.slot]=null;
    if(!this.stopping&&!this.deferred.includes(instance.slot))this.deferred.push(instance.slot);
  }

  /**
   * Run one farm-wide purge round if pacing allows, and report whether it reclaimed enough
   * to reach `wantMb`. True means the caller should stand down: the cheap reclaim worked.
   * False means "go ahead with the expensive action" - either the purge did not run (pacing,
   * disabled) or it ran and memory is still short.
   */
  async maybePurgeFor(reason, wantMb) {
    if (this.purgeEveryMs <= 0) return false;
    if (this.purgeRoundBusy || Date.now() - this.lastGovernorPurgeAt < 120000) return false;
    if (!await this.purgeRound(reason)) return false;
    const now = this.freeMb();
    if (now >= wantMb) {
      this.log(`purge reclaimed enough: ${now}MB free (needed ${wantMb}MB) - standing down`, 'warn');
      return true;
    }
    return false;
  }

  /**
   * One farm-wide renderer purge (see instance.purgeMemory). Steady state is covered by each
   * window's own schedule; this is the governor's emergency round before it spends a recycle
   * or a shed. All windows at once - they are independent renderers, and the reclaim we are
   * after takes seconds.
   */
  async purgeRound(reason) {
    if (this.purgeRoundBusy) return false;
    this.purgeRoundBusy = true;
    try {
      // An external purge must not wait behind a long navigation/maintenance
      // action: that used to hold governorBusy for minutes with GC queued.
      const candidates=this.instances.filter(Boolean).map(i=>({instance:i,reason:purgeBlock(i)}));
      const targets=candidates.filter(row=>!row.reason).map(row=>row.instance);
      const blocked=candidates.filter(row=>row.reason).map(row=>({slot:row.instance.slot,reason:row.reason}));
      if (!targets.length) {this.lastReclaim={at:Date.now(),reason,state:'blocked',completed:0,blocked};return false;}
      this.lastGovernorPurgeAt = Date.now();
      this.log(`purging ${targets.length} renderer(s) (${reason})`, 'warn');
      // Shared GPU/browser resources should not be stalled by simultaneous GC.
      const beforeMb=this.freeMb();let reclaimed=0;
      for (const i of targets) {
        if(this.stopping)break;
        const hold=purgeBlock(i);if(hold){blocked.push({slot:i.slot,reason:hold});continue;}
        if(await i.purgeMemory(reason,'critical').catch(()=>null))reclaimed++;
        else blocked.push({slot:i.slot,reason:purgeBlock(i)||'purge unavailable or failed'});
      }
      await sleep(4000);                     // let Chromium hand the freed pages back
      this.lastReclaim={at:Date.now(),reason,state:reclaimed?'completed':'no_reclaim',beforeMb,afterMb:this.freeMb(),completed:reclaimed,blocked};
      return reclaimed>0;
    } finally {
      this.purgeRoundBusy = false;
    }
  }

  /**
   * Keep every live window in one party.
   *
   * The party is SERVER state, not client state: a window that gets recycled, reloaded or
   * reconnected comes back OUT of the party. So this runs on a timer rather than once, and it
   * reads the party back from the server's own `party` frame instead of assuming the invite
   * landed. The lowest live slot leads, because only the leader may invite.
   */
  async maybeFormParty() {
    if (!this.partyOn || this.stopping || this.partyChecking) return;
    if (Date.now() - this.lastPartyAt < this.partyEveryMs) return;

    const live = this.instances.filter(i => i && i.status === 'playing'
      && i.credentials && i.credentials.charName);
    if (live.length < 2) {
      if (this.sharedGuild) await this.maybeJoinGuild(live[0], live, null);
      return;
    }

    this.partyChecking = true;
    this.lastPartyAt = Date.now();
    try {
      if(this.federation){await this.federation.partyRound(this);return;}
      const known = await live[0].partyState();
      const leaderName = known?.members?.find(m => m.aid === known.leader)?.name;
      const leader = known?.id ? live.find(i => i.credentials.charName === leaderName) : live[0];
      if (!leader) { this.towerInfo = { phase:'waiting', reason:'รอหัวหน้าปาร์ตี้ออนไลน์', at:Date.now() }; return; }
      const rest = live.filter(i => i !== leader);

      const before = await leader.partyState();
      const have = new Set(((before && before.members) || []).map(m => m.name));
      const missing = rest.filter(m => !have.has(m.credentials.charName));

      if (!before || missing.length) {
        const t0 = Date.now();
        for (const m of missing) await leader.partyInvite(m.credentials.charName);
        await sleep(1500);
        for (const m of rest) await m.partyAcceptPending(t0);
        await sleep(1500);
      }

      const after = await leader.partyState();
      const names = ((after && after.members) || []).map(m => m.name);
      // Compare the ROSTER, not the length. A party keeps members that have gone offline (seen
      // 2026-09-29: a party still listed a character whose window had been stopped), so
      // `members.length >= live.length` passes while a live window is actually missing.
      const missingLive = live
        .map(i => i.credentials.charName)
        .filter(n => !names.includes(n));
      for(const i of live)i.teamPartyId=names.includes(i.credentials.charName)?after?.id:null;

      this.partyInfo = {
        checkedAt: after?._receivedAt || null,
        id: (after && after.id) || null,
        leader: (after?.members || []).find(m => m.aid === after.leader)?.name || null,
        members: names,
        want: live.map(i => i.credentials.charName),
        missing: missingLive,
      };

      const key = names.join(',');
      if (!missingLive.length) {
        if (this.partyLogged !== key) {
          this.partyLogged = key;
          this.log(`party formed: ${names.join(', ')} (${names.length}, all ${live.length} live window(s) present)`);
        }
      } else if (this.partyLogged !== 'bad:' + key) {
        this.partyLogged = 'bad:' + key;
        this.log(`party incomplete: missing ${missingLive.join(', ')} - server has [${names.join(', ')}]`, 'warn');
      }

      await this.maybeJoinGuild(leader, live, after);
      await this.maybeRunTower(leader, live);
    } finally {
      this.partyChecking = false;
    }
  }

  /**
   * Get every live window into the founder's guild.
   *
   * The guild already exists by the time this runs (scripts/create-guild.js founds it once,
   * because it costs 30,000 Copper). Only a leader or officer may invite, and an invitee has to
   * answer, so this is the same shape as the party: invite the ones the guild frame says are
   * missing, then read the guild back from the server rather than trusting the send.
   */
  async maybeJoinGuild(leader, live, partyFrame) {
    if (!this.guildOn) return;
    if (this.sharedGuild) {
      await require('./runtime/shared-guild').round(this, live, this.sharedGuild);
      return;
    }
    const g = await leader.guildState();
    if (!g || !g.id) { this.guildInfo = null; return; }

    // Explicit user invitations queued locally; never invite arbitrary detected players.
    const inviteFile = path.join(this.root, 'logs', 'guild-invite-request.json');
    try {
      const request = JSON.parse(fs.readFileSync(inviteFile, 'utf8'));
      if (request.status === 'pending' && request.guildId === g.id
          && Date.now() - request.at < 600000 && /^[\p{L}\p{N}_-]{2,24}$/u.test(request.name)) {
        if ((g.members || []).some(m => m.name === request.name)) request.status = 'already-member';
        else {
          const sent = await leader.guildInvite(request.name);
          request.status = sent?.ok ? 'sent-awaiting-acceptance' : 'failed';
          request.reason = sent?.reason || null;
        }
        request.sentAt = Date.now();
        fs.writeFileSync(inviteFile, JSON.stringify(request, null, 2));
        this.log(`guild user invitation: ${request.name} -> ${request.status}`);
      }
    } catch (e) { if (e.code !== 'ENOENT') this.log(`guild invite request: ${e.message}`, 'warn'); }

    const inGuild = new Set((g.members || []).map(m => m.name));
    const missing = live.filter(i => !inGuild.has(i.credentials.charName));
    if (!missing.length) {
      if (this.guildLogged !== g.id + ':' + g.members.length) {
        this.guildLogged = g.id + ':' + g.members.length;
        this.log(`guild "${g.name}" (id ${g.id}, lv ${g.lv}): ${g.members.map(m => m.name).join(', ')}`);
      }
      this.guildInfo = { checkedAt: g._receivedAt || null, id: g.id, name: g.name, lv: g.lv, cap: g.cap, members: g.members.map(m => m.name) };
      return;
    }

    const t0 = Date.now();
    for (const m of missing) await leader.guildInvite(m.credentials.charName);
    await sleep(1500);
    for (const m of missing) await m.guildAcceptPending(t0);
    await sleep(1500);

    const after = await leader.guildState();
    this.guildInfo = after ? {
      checkedAt: after._receivedAt || null, id: after.id, name: after.name, lv: after.lv, cap: after.cap,
      members: (after.members || []).map(m => m.name),
    } : null;
    const names = this.guildInfo ? this.guildInfo.members : [];
    if (this.guildLogged !== 'inv:' + names.join(',')) {
      this.guildLogged = 'inv:' + names.join(',');
      this.log(`guild "${g.name}" now has ${names.length}/${g.cap}: ${names.join(', ')}`);
    }
  }

  /**
   * Asteria Tower: 100 floors, 1-6 players, open EVERY DAY. Leader opens from town, the rest
   * join from the `twinv` frame - the same shape as the party, so it rides the same timer.
   *
   * It is gated on the server's own `tw` frame rather than a local schedule: `left` is the runs
   * remaining today, and a run already in progress is left alone.
   */
  async maybeRunTower(leader, live) {
    if (!this.towerOn || this.stopping) return;
    if (!this.towerTeam) this.towerTeam = new (require('./tower-team').TowerTeam)(this.root, {
      report: info => {
        this.towerInfo = info;
        this.teamRoom.post('หัวหน้าทีม','ทุกคน',info.reason + (info.missing?.length ? ' · รอ '+info.missing.join(', ') : ''),'tower');
        this.snapshotToDisk();
      }
    });
    await this.towerTeam.run(live, this.count, () => this.stopping);
  }
}

module.exports = { Supervisor };
