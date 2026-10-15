// instance.js - one autonomous game client.
//
// Design: we run the REAL game client (headless Chromium) so we inherit the game's own
// simulation, combat, pathfinding and its built-in AUTO hunt + auto-quest. Everything we
// add is the "meta" layer the game does not ship with: account provisioning, unattended
// login, session recovery, death recovery, stuck detection and telemetry.
//
// Identity is owned by Node, not by the browser: we create the guest account and the
// character through the public REST API, then seed localStorage before any page script
// runs. That makes boot deterministic instead of depending on clicking a login button.
'use strict';

const path = require('path');
const fs = require('fs');
const { sharedPool } = require('./browserpool');
const { installResourceMode } = require('./resource-mode');
const api = require('./api');
const build = require('./build');
const social = require('./social');
const economy = require('./economy');
const director = require('./director');
const { BrainMemory, chooseGate } = require('./brain-memory');
const characterBrain = require('./character-brain');
const SOCIAL = social.SOCIAL;
const api_social = social.api;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// In-page helpers, prepended to every evaluate() so selectors stay short.
const H = `
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const shown = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  const vis = s => shown($(s));
  const tap = s => { const e = $(s); if (!e) return false; e.click(); return true; };
  const txt = s => (($(s) && $(s).innerText) || '').trim();
  const setChk = (id, want) => { const e = document.getElementById(id); if (e && e.checked !== want) { e.click(); return true; } return false; };
`;

// Read town gate coordinates from this instance's loaded native source; no legacy fallback.

/**
 * One-line description of a `screen()` snapshot, for error messages and logs.
 *
 * "boot timed out" on its own is undiagnosable - the useful fact is which screen the client
 * was sitting on when it ran out of time (a disabled #csGo and a stuck #loadScr have nothing
 * in common as causes). Keep the output short: the flags that are on, plus the client's own
 * error text when there is one.
 */
function describeScreen(s) {
  if (!s) return 'unknown screen';
  const on = ['startVisible', 'loading', 'lgGuest', 'srvGo', 'csGo', 'csForm', 'death', 'inGame']
    .filter(k => s[k]);
  if (s.csGo && s.csGoDisabled) on.push('csGo(disabled)');
  const bits = [];
  if (on.length) bits.push(on.join('+'));
  if (s.loc) bits.push(`at ${s.loc}`);
  if (s.panelOpen) bits.push(`panel=${s.panelName || 'open'}`);
  if (s.authErr) bits.push(`authErr=${String(s.authErr).slice(0, 60)}`);
  if (s.startSub) bits.push(`startSub=${String(s.startSub).slice(0, 60)}`);
  return bits.length ? bits.join(' ') : `no known screen flags (url ${s.url || '?'})`;
}

// Town service NPCs. Coordinates are the client's own townActions table (TOWN = {cx:160, cz:0},
// each NPC placed at a fixed offset), and `panel` is the panel the click handler opens for that

// NPC kind. Walking next to one and clicking its projected position is the only way to reach
// these panels: they are 3-D objects picked by raycasting, not DOM buttons.
const TOWN_SERVICES = {
  potionShop: { x: 138, z: -5.2, y: 2.6, panel: 'potionShop', label: 'ร้านขายของใช้' },
  gearShop: { x: 182, z: -5.2, y: 2.5, panel: 'gearShop', label: 'ร้านอาวุธและเกราะ' },
  storage: { x: 138, z: 15.8, y: 2.5, panel: 'storage', label: 'คลังเก็บของ' },
  smithShop: { x: 182, z: 15.8, y: 2.6, panel: 'refineShop', label: 'ช่างตีบวก' },
  questBoard: { x: 155, z: 13, y: 3.45, panel: 'questBoard', label: 'กระดานภารกิจ' },
  exchange: { x: 165, z: 13, y: 2.6, panel: 'exchange', label: 'พ่อค้าแลกเปลี่ยน' },
  enchanter: { x: 172, z: -18.8, y: 2.6, panel: 'enchant', label: 'นักร่ายอาคม' },
  tester: { x: 148, z: -18.8, y: 2.6, panel: 'tester', label: 'ผู้สนับสนุนเซิร์ฟทดสอบ' },
  jobMaster: { x: 153.5, z: -4.5, y: 2.5, panel: 'jobMaster', label: 'ครูฝึกอาชีพ' },
};

class GameInstance {
  /**
   * @param {object} o
   * @param {number} o.slot            index of this window
   * @param {string} o.root            project root (profiles/ and logs/ live here)
   * @param {number} [o.width]         viewport width  (rendering cost scales with this)
   * @param {number} [o.height]        viewport height
   * @param {boolean} [o.headless]
   * @param {boolean} [o.noDraw]       suppress WebGL draw calls -> near-zero GPU cost
   * @param {boolean} [o.autoRespawn]
   * @param {number}  [o.stuckMs]      no EXP for this long => escalate
   * @param {number}  [o.roamRadius]   8|16|28|120; 120 = whole map
   * @param {number}  [o.potPct]       25|35|50|70
   * @param {boolean} [o.offlineBot]   enable the game's own offline bot as a crash fallback
   * @param {(m:string,level?:string)=>void} [o.log]
   */
  constructor(o) {
    this.slot = o.slot;
    this.machine = o.machine || (process.platform==='win32'?'windows':'tum');
    this.storageSlot = o.credentials?.storageSlot ?? this.slot;
    this.root = o.root;
    this.loadedFarmRevision=o.loadedFarmRevision||null;
    this.outcomes=new (require('./outcome-monitor').OutcomeMonitor)(this.root,this.storageSlot);
    this.manaDisabled=this.outcomes.data.manaDisabled||[];this.manaConserve=this.manaDisabled.length>0;
    this.gearImpact=new (require('./gear-impact').GearImpact)(this.root,this.storageSlot);
    this.width = o.width || 480;
    this.height = o.height || 270;
    this.headless = o.headless !== false;
    this.noDraw = !!o.noDraw;
    // Software-rendered frame cap. 30 is the safe default; a farm whose window count
    // approaches its CPU core count needs 20 (see resource-mode.js).
    this.targetFps = o.targetFps || 30;
    this.liteTextures = !!o.liteTextures;
    this.sceneSyncMs = o.sceneSyncMs || 250;
    // With --nodraw the GPU has nothing to do, so drop it (see NO_GPU_ARGS). Opt out with
    // --keep-gpu if a particular machine behaves better with hardware acceleration.
    this.noGpu = o.noGpu !== false;
    this.fullChrome = !!o.fullChrome;
    this.autoRespawn = o.autoRespawn !== false;
    this.stuckMs = o.stuckMs || 180000;
    this.townStuckMs = o.townStuckMs || 30000;   // town has no monsters: act sooner
    this.roamRadius = o.roamRadius || 120;
    this.potPct = o.potPct || 50;
    this.offlineBot = o.offlineBot !== false;
    this.huntMap = o.huntMap || 'w1';   // field used when the character is stranded in town
    // Class chosen at the Job Lv 10 hand-off. A team member carries its own class, so six
    // windows cover all six base classes; a slot with no assignment falls back to the ranged
    // preference (less damage taken when nobody is watching).
    this.jobPreference = (o.credentials && o.credentials.job)
      ? [o.credentials.job]
      : (o.jobPreference || ['ranger', 'mage', 'priest', 'knight', 'assassin', 'monk']);
    // Character build behaviour.
    this.holdPointsAsNovice = o.holdPointsAsNovice !== false;   // bank stats until a class is picked
    this.preferHotbarSkills = !!o.preferHotbarSkills;           // learn the action-bar skills first
    this.autoBuild = o.autoBuild !== false;                     // spend stat/skill points at all
    this.autoRestock = o.autoRestock !== false;                 // buy potions when in town and low
    this.restockBelow = o.restockBelow || 20;
    this.autoQuestBoard = o.autoQuestBoard !== false;           // accept/claim board contracts
    // Town chores: dailies, pets, guild donation, equip upgrades, sell/stash/buy. Throttled
    // because each one opens a panel and some walk to an NPC.
    this.autoChores = o.autoChores !== false;
    this.autoAdvanceJob = o.autoAdvanceJob !== false;   // promote to tier 2 when eligible
    this.choresEveryMs = o.choresEveryMs || 600000;             // 10 minutes
    // The rest of the team, so the planner can hand an item to whoever can actually use it.
    this.roster = o.roster || null;
    this.questEnabledAt = 0;
    this.questNavBlockedUntil = 0;
    this.questNavBlockCooldown = o.questNavBlockCooldown || 600000;
    this.emit = o.log || (() => { });

    this.profileDir = path.join(this.root, 'profiles', `slot-${String(this.storageSlot).padStart(2, '0')}`);
    this.accountFile = path.join(this.profileDir, 'account.json');
    // The game brain: a recomputed hunting goal ("farm map w2 for Iron Ore - the next refine
    // needs it") plus the learning record of what actually worked, kept across restarts.
    this.goal = null;
    this.goalEveryMs = o.goalEveryMs || 180000;
    this.learning = new director.Learning(this.root, this.storageSlot, economy.loadWiki(this.root));
    this.brain = new BrainMemory(this.root, this.storageSlot);

    this.cache = o.cache || null;     // shared AssetCache; keeps N boots off the network
    this.onWebSocket = o.onWebSocket || null;
    this.credentials = o.credentials || null;   // {username, password} for a named account
    this.framesDir = o.framesDir || null;        // live-preview JPEGs land here
    this.frameEveryMs = o.frameEveryMs || 1200;
    this.frameAt = 0;
    // Renderer memory hygiene. A window's footprint grows with session age even though its JS
    // heap stays tiny (measured 10-51MB): the growth lives in Blink's purgable caches - decoded
    // images, audio buffers, layout scratch - which Chromium only hands back under memory
    // pressure. purgeMemory() applies that pressure over CDP on a schedule (0 disables).
    this.purgeEveryMs = o.purgeEveryMs != null ? o.purgeEveryMs : 600000;
    this.nextPurgeAt = 0;
    this.cdp = null;             // CDP session for the current page; dies with the context
    this.lastPurge = null;

    this.ctx = null;
    this.page = null;
    this.account = null;
    this.character = null;
    // One Chromium browser for the whole farm; this window is one isolated context on it.
    // The supervisor injects its own pool; direct callers (probes) share a per-process one.
    this.pool = o.browserPool || sharedPool({
      headless: this.headless, noDraw: this.noDraw, noGpu: this.noGpu,
      fullChrome: this.fullChrome, splitBrowsers: o.splitBrowsers, log: (m, l) => this.log(m, l),
    });

    this.status = 'init';
    this.startedAt = 0;
    this.restarts = 0;
    this.recycles = 0;
    this.recycling = false;
    this.choresBusy = false;  // true while a town-chores pass is mid-flight (recycler defers)
    this.stuckCount = 0;
    this.lastSave = null;
    this.lastSaveAt = 0;
    this.progressAt = 0;
    this.progressKey = '';
    this.errors = 0;
    this.unresponsive = 0;
    // evaluate() has no timeout of its own, so every eval races a watchdog: a frozen renderer
    // surfaces as an ordinary controller error (which the supervisor recovers) instead of a
    // control loop that hangs forever as silent dead weight.
    // 45s, not 30: on a fully loaded host a healthy-but-slow page can miss a 30s deadline
    // while it shares four cores with five other renderers, and every miss costs a recycle
    // (minutes of boot) to fix what was never actually broken.
    this.evalTimeoutMs = o.evalTimeoutMs || 45000;
    this.lastAction = {};   // action key -> timestamp, for the rate limiter
    this.livePos = null;    // {x, z, mv} from the game's own state broadcast
    this.history = [];   // recent exp samples, for throughput reporting
    this.reports = o.reports || null;
  }

  log(msg, level = 'info') { this.reports?.log(this.slot, msg); this.emit(`[slot ${String(this.slot).padStart(2, '0')}] ${msg}`, level); }

  // ---------------------------------------------------------------- identity
  /**
   * Establish this window's identity.
   *
   * With credentials, this is a named account: durable, signable from anywhere, reusable after
   * a reinstall. Without them it falls back to a guest, which only ever exists inside this
   * browser profile. A stored token is always preferred over signing in again, because the
   * server treats a second sign-in as "playing elsewhere" and would kick the other session.
   */
  async ensureAccount() {
    fs.mkdirSync(this.profileDir, { recursive: true });
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(this.accountFile, 'utf8')); } catch { }

    if (this.credentials && this.credentials.username) {
      if (saved && saved.token && saved.username === this.credentials.username) {
        const me = await api.whoami(saved.token).catch(() => null);
        if (me) { this.account = {...saved,id:me.id??saved.id}; return this.account; }
        this.log(`stored token for ${saved.username} was rejected; signing in again`, 'warn');
      }
      const r = await this.signIn(this.credentials.username, this.credentials.password);
      if (!r.ok) {const error=new Error('Registered account authentication failed: HTTP '+r.status);if([400,401,403].includes(r.status))error.code='ASTERIA_AUTH_REQUIRED';throw error;}
      const rec = {
        kind: 'password',
        id:r.account?.id,
        token: r.token,
        username: this.credentials.username,
        password: this.credentials.password,
      };
      fs.writeFileSync(this.accountFile, JSON.stringify(rec, null, 2));
      this.account = rec;
      this.log(`signed in as ${rec.username}`);
      return rec;
    }

    if (saved && saved.token) {
      const me = await api.whoami(saved.token).catch(() => null);
      if (me) { this.account = {...saved,id:me.id??saved.id}; return this.account; }
      const error=new Error('Existing account needs native authentication; saved identity preserved');error.code='ASTERIA_AUTH_REQUIRED';throw error;
    }
    const g = await api.createGuest();
    fs.writeFileSync(this.accountFile, JSON.stringify(g, null, 2));
    this.account = g;
    this.log(`guest account ${g.username}`);
    return g;
  }

  /** Sign in, waiting out the login rate limit (see api.loginRetry). */
  async signIn(username, password) {
    return api.loginRetry(username, password, {
      onWait: (ms, i, n) => this.log(`login rate-limited for ${username}; waiting ${Math.round(ms / 1000)}s (${i}/${n})`, 'warn'),
    });
  }

  async ensureCharacter(name) {
    const data = await api.listChars(this.account.token);
    const want = name || (this.credentials && this.credentials.charName) || null;

    if (data.chars && data.chars.length) {
      const c = require('./registry/identity').selectCharacter(data.chars, {
        charId:this.credentials?.charId, charName:want,
      });
      this.character = c;
      await require('./registry/registry').reconcilePrevious(this);
      require('./registry/registry').bind(this);
      return c;
    }

    if(this.credentials?.charId!=null)throw Error('identity: assigned character is absent; creation is not a replacement');
    // No character yet: this is the one moment the name can be chosen.
    const nm = want || `Bot${Math.random().toString(36).slice(2, 7)}`;
    const c = await api.createChar(this.account.token, nm);
    this.character = c;
    await require('./registry/registry').reconcilePrevious(this);
    require('./registry/registry').bind(this);
    this.log(`created character ${c.name} (id ${c.id})`);
    return c;
  }

  // ---------------------------------------------------------------- browser
  async launch() {
    this.bagSessionStartedAt = Date.now();
    this.reports?.reset(this.slot);
    this.livePos = null;
    fs.mkdirSync(this.profileDir, { recursive: true });   // holds account.json; the browser itself no longer uses this directory
    this.ctx = await this.pool.acquire({ width: this.width, height: this.height },this.actorOwner?{root:this.root,owner:this.actorOwner}:undefined);

    // Answer static assets from the local cache; only /api and the websocket go upstream.
    if (this.cache) await this.cache.install(this.ctx, { origin: api.BASE, log: (m, l) => this.log(m, l) });
    if (this.noDraw) await this.ctx.addInitScript(installResourceMode, { targetFps: this.targetFps, liteTextures:this.liteTextures,sceneSyncMs:this.sceneSyncMs,lowUi:!!this.pool.opts.softwareUi,skipOffscreen:!!this.pool.opts.softwareUi });
    this.resourceProfileApplied=false;
    if((this.buildHash||(this.cache?.dir?path.basename(this.cache.dir):economy.newestBuild(this.root)))==='fc1842a')await this.ctx.addInitScript(require('./boss-reflex').installBossReflex,{lessons:this.outcomes.data.bossLessons||{},skills:this.catalog().world.MONSTER_SKILLS,area:['ground_aoe','stun_aoe','lightning','icefall','cone_freeze','cone_breath','front_sweep','line_strike','spin','volcano','fire_trail','explode_threshold','meteor_phase','lava_phase']});

    await this.ctx.addInitScript(({ token, guest, noDraw, gfx }) => {
      // Rolling frame counter. The game advances its simulation by frame delta, and the
      // delta is capped, so a low frame rate makes the whole game run in slow motion.
      try {
        window.__fps = 0;
        let n = 0, t0 = performance.now(), lastTs = -1;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = cb => raf(ts => {
          if (ts !== lastTs) { n++; lastTs = ts; }
          const now = performance.now();
          if (now - t0 >= 1000) { window.__fps = Math.round(n * 1000 / (now - t0)); window.__fpsAt = Date.now(); n = 0; t0 = now; }
          return cb(ts);
        });
      } catch { }
      try {
        localStorage.setItem('asteria-token-v1', token);
        if (guest) localStorage.setItem('asteria-guest-v1', JSON.stringify(guest));
        if (gfx) localStorage.setItem('asteria.gfx', gfx);   // 'low' = cheaper renderer
        sessionStorage.removeItem('asteria-pick-v1');
      } catch { }
      if (noDraw) {
        // Rendering is pure cost for a bot: the simulation lives in the rAF loop, not in
        // the pixels. Neutralising the draw calls removes the GPU work and most of the
        // per-frame GL command overhead while leaving game logic untouched.
        //
        // The no-op is flag-gated rather than permanent: captureFrame() raises
        // window.__allowDraw for a few frames, so the control panel can show a real
        // picture on demand while every other frame stays cheap. Three.js still walks the
        // scene graph and updates matrices while draws are suppressed, so the frame that
        // does get drawn is correct.
        const kill = P => {
          if (!P) return;
          for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced',
            'drawElementsInstanced', 'drawRangeElements']) {
            const orig = P.prototype[m];
            if (!orig) continue;
            P.prototype[m] = function (...args) {
              if (window.__allowDraw) return orig.apply(this, args);
              return undefined;
            };
          }
        };
        kill(window.WebGLRenderingContext);
        kill(window.WebGL2RenderingContext);
      }
    }, { token: this.account.token, guest: this.account.guest, noDraw: this.noDraw, gfx: 'low' });

    this.page = this.ctx.pages()[0] || await this.ctx.newPage();
    this.cdp = null;         // the old session belonged to the released context; purgeMemory() rebuilds it
    this.page.on('framenavigated', frame => {
      if (this.page && frame === this.page.mainFrame()) { this.reports?.reset(this.slot); if(this.learning) this.learning.prev=null; }
    });

    // A new session's authoritative load reconciles an old uncertain bag request.
    // The previous socket is closed before launch; an unchanged tier can be retried.
    const loadPage=this.page;
    const saveRequests=new WeakMap();
    this.page.on('response', async response => {
      if(this.page!==loadPage)return;
      const loadUrl=new URL(response.url());
      if (loadUrl.origin!==new URL(api.BASE).origin||loadUrl.pathname!=='/api/save'||!response.ok()) return;
      if(response.request().method()==='PUT'){
        try{const accepted=await response.json(),request=saveRequests.get(response.request());if(this.page!==loadPage)return;const proof=require('./observability/save-receipt').accepted(this,request,accepted);if(!proof)return;
          this.acceptedSaveReceipt={state:request.state,proof};this.developmentLedger?.reconcileCraftState(request.state,proof,this.catalog());this.v2?.journal.acknowledgeAcceptedSave(request.state,proof);
          for(const ledger of [this.developmentLedger,this.equipmentLedger])if(ledger?.acknowledgeAcceptedSave(request.state,proof))for(const claim of this.v2?.reservations?.data.claims||[])if(ledger.rows.some(r=>r.id===claim.transactionId&&['server_confirmed','server_no_increase'].includes(r.status)))this.v2.reservations.finish(claim.id,'CONFIRMED');
          this.acceptedSaveObservation={authority:proof.authority,at:proof.at,rev:proof.rev};
          try{this.completionMeasurements ||=new(require('./learning/completion-measurements').CompletionMeasurements)(this.actorStateRoot,this.actorIdentity.actorId);this.completionMeasurements.observe(this,request.state,proof);this.goalCycles ||=new(require('./learning/goal-cycle').GoalCycle)(this.actorStateRoot,this.actorIdentity.actorId);this.goalCycles.observe(this,request.state,proof);request.state.completionEstimates=this.goalCycles.estimates(request.state,proof.build);if(this.lastSave)this.lastSave.completionEstimates=request.state.completionEstimates;}catch{this.completionMeasurementError='Personal completion measurements unavailable; ETA remains unknown';}
        }catch(e){this.nativeReceiptError='Save acknowledgement unreadable; transaction remains unconfirmed';}return;
      }
      if(response.request().method()!=='GET')return;
      try {const body=await response.json(),proof=require('./observability/save-receipt').readback(this,saveRequests.get(response.request()),body);if(this.page!==loadPage||!proof)return;const {save,rev}=body;
        this.serverSaveObservation=proof;this.serverSaveReceipt={state:save,proof};
        const journal=this.v2?.journal||(this.bagJournal ||= new(require('./runtime/action-journal').ActionJournal)(this.root,this.credentials?.username||'slot-'+this.storageSlot));
        journal.reconcileBagLoad(save,{at:Date.now(),sessionStartedAt:this.bagSessionStartedAt,rev});
        journal.reconcilePurchaseLoad(save,{at:Date.now(),sessionStartedAt:this.bagSessionStartedAt,rev});
        require('./runtime/market-load').reconcile(journal,this.v2?.reservations,save,{at:Date.now(),sessionStartedAt:this.bagSessionStartedAt,rev,build:path.basename(this.cache.dir),acceptedPriorBuilds:require('./runtime/market-load').compatiblePriorBuilds(this.root,path.basename(this.cache.dir)),root:this.root,identity:this.credentials?.username||'slot-'+this.slot,actorId:this.actorIdentity?.actorId});
        const ledger=this.developmentLedger ||=new(require('./result-ledger').ResultLedger)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||(this.storageSlot??this.slot));
        const craftObserved=ledger.reconcileCraftState(save,proof,this.catalog()),craftBudgetRebased=ledger.rebaseUncertainCraft(save,proof,this.catalog());
        if(craftObserved||craftBudgetRebased)journal.importLedger(ledger.view(),path.basename(this.cache.dir));
        if(ledger.reconcileRefineState(save,proof,this.catalog())||ledger.reconcileRefineLoad(save,{at:Date.now(),sessionStartedAt:this.bagSessionStartedAt,rev}))journal.importLedger(ledger.view(),path.basename(this.cache.dir));
        const equipment=this.equipmentLedger ||=new(require('./result-ledger').ResultLedger)(this.actorStateRoot||this.root,'equipment-'+(this.actorIdentity?.actorId||(this.storageSlot??this.slot)));
        equipment.reconcileEquipLoad(save,{at:Date.now(),sessionStartedAt:this.bagSessionStartedAt,rev});
      } catch { }
    });
    // Telemetry: outgoing PUT /api/save is observed client state, not a server receipt.
    this.page.on('request', r => {
      if(this.page!==loadPage)return;
      const u=new URL(r.url());if(u.origin!==new URL(api.BASE).origin||u.pathname!=='/api/save')return;
      if(r.method()==='GET'){saveRequests.set(r,require('./observability/save-receipt').context(this,r.headers()));return;}if(r.method()!=='PUT')return;
      try {
        const b = JSON.parse(r.postData() || '{}');
        saveRequests.set(r,require('./observability/save-receipt').capture(this,b,r.headers()));
        this.lastSave = {
          lv: b.lv, exp: b.exp, job: b.job, jobLv: b.jobLv, jobExp: b.jobExp,
          inTown:typeof b.inTown==='boolean'?b.inTown:undefined,
          coins: b.coins, storeTier:Number.isInteger(b.storeTier)?b.storeTier:undefined, storage:{gear:Array.isArray(b.storage?.gear)?b.storage.gear.slice(0,250).map(g=>({id:g.id,up:!!g.up,lk:!!g.lk})):[]}, leaves:b.leaves||0, bagTier:Number.isInteger(b.bagTier)?b.bagTier:undefined, mapId: b.mapId, hp: b.hp, mp: b.mp,
          potions: b.potions, rested:Number.isFinite(b.rested)?b.rested:null, qIndex: b.qIndex, qv:b.qv, qHave:b.qHave, daily:b.daily||null, offBot: b.offBot,
          pos: b.pos || null,
          // Character development: what is still unspent, and what has been bought.
          pts: b.pts || 0, skPts: b.skPts || 0, st: b.st || null, skills: b.skills || null,
          materials: b.materials || null, runeDust: b.runeDust || 0,
          refine: b.refine || null, equip: b.equip || null, bag: b.bag || null,
          weaponOpts: b.weaponOpts || {}, enchPity: b.enchPity || 0, keyItems: b.keyItems || {},
          petOpts:b.petOpts&&typeof b.petOpts==='object'?b.petOpts:{},astral:b.astral&&typeof b.astral==='object'?b.astral:undefined,
          plk:Object.fromEntries(Object.entries(b.plk||{}).filter(([id,v])=>id.length<100&&Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)).slice(0,300)), drill:b.drill||null, sockets: b.sockets || {}, holes: b.holes || {}, stage:b.stage||{}, cards:b.cards||{}, cardAlbum:b.cardAlbum&&typeof b.cardAlbum==='object'?b.cardAlbum:undefined, manualT:Number.isFinite(b.manualT)?b.manualT:null,elixirT:Number.isFinite(b.elixirT)?b.elixirT:null,
          locks:Array.isArray(b.locks)?b.locks.filter(x=>typeof x==='string').slice(0,300):[],
          developmentDefensive:!!this.developmentPriority,
          measuredFocus:this.gearImpact?.view()?.focus||null,
          boardQuest: b.boardQuest || null, tokens: b.tokens || 0,
          consumables: b.consumables || null,
          autoOpt:b.autoOpt||{},
          autoTargets:Array.isArray(b.autoTargets)?[...new Set(b.autoTargets.filter(x=>typeof x==='string'&&x.length<100))].sort():typeof b.autoTarget==='string'?(b.autoTarget==='all'?[]:[b.autoTarget]):null,
          testerAt: b.tester?.s || 0, testerManualAt: b.tester?.m || 0,
          pets:b.pets||{},petActive:typeof b.petActive==='string'?b.petActive:null,
          bestiary: b.bestiary || null,       // kill counts - the director learns from their deltas
        };
        this.lastSave.actorId=this.actorIdentity?.actorId;this.lastSave.acquisitionMeasurements=this.acquisitionMeasurements||{};
        this.lastSaveAt = Date.now();
        this.clientSaveObservation={authority:'outgoing_client_save',at:this.lastSaveAt,sessionStartedAt:this.bagSessionStartedAt,confirmation:false};
        this.observeExpRoute?.();
        this.automationSettings=require('./runtime/automation-settings').observed(this.automationSettings,this.lastSave,this.lastSaveAt);
        const questBuild=path.basename(this.cache.dir);
        if(this.questOutcomes?.build!==questBuild)this.questOutcomes=new(require('./learning/quest-outcomes').QuestOutcomes)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.username||'slot-'+this.slot,questBuild);
        this.questOutcomes.observe(this.lastSave,this.lastSaveAt);
        this.developmentLedger?.observe(this.lastSave,this.lastSaveAt);
        this.gearImpact?.observe(this.lastSave,this.livePos,this.lastSaveAt,this.choresBusy||this.teamControl,this.v2?.learningRevision||path.basename(this.cache.dir));
        try{this.gearPower=require('./gear-value').totals(this.lastSave,this.catalog());}catch{}
        this.reports?.save(this.slot, this.character?.name, b);
        this.noteProgress(b.lv, b.exp, b);
        // Every save is a sample of the character's yield: exp/coins/materials/kill deltas
        // since the previous save are what the map paid in that interval.
        if (this.learning) { try { this.learning.observe({ ...this.lastSave, mapId: this.livePos && Date.now()-this.livePos.at<10000 ? this.livePos.room : null }); this.learning.save(); } catch { } }
      } catch { }
    });
    this.page.on('pageerror', e => { this.errors++; this.log('pageerror: ' + String(e).slice(0, 160), 'warn'); });
    // Optional hook so tooling can watch the game's own state socket.
    if (this.onWebSocket) this.page.on('websocket', ws => this.onWebSocket(ws));
    // Live position from the game's own state broadcast ({t:'state', x, z}) - up to 10 Hz,
    // and far fresher than the save payload. walkTo() steers with this.
    const socialInbox = this.socialInbox = new (require('./runtime/social-inbox').SocialInbox)((this.catalog().world?.MONSTERS||[]).filter(m=>['boss','miniboss'].includes(m.kind)).map(m=>m.id));
    this.page.on('websocket', ws => {
      if (!/\/ws/.test(ws.url())) return;
      const combatObserver=new(require('./runtime/combat-observer').CombatObserver)(this.reports,this.slot,()=>this.character?.name||this.credentials?.charName,{instance:()=>this,lab:()=>this.socialInbox?.buildLab?.session?.active===true||require('./runtime/room-policy').roomPolicy(require('./runtime/room-policy').currentRoom(this)).lab===true});
      socialInbox.bind(ws);
      const generation=socialInbox.generation;
      this.activityEvidence ||=new(require('./observability/activity-evidence').ActivityEvidence)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.username||'slot-'+this.slot);
      ws.on('framereceived', ev => {if(socialInbox.generation!==generation)return;if(this.reports)combatObserver.receive(ev.payload);this.activityEvidence.receive(ev.payload,path.basename(this.cache.dir),this.livePos?.room);this.masteryEvidence={...this.masteryEvidence,...this.activityEvidence.mastery(path.basename(this.cache.dir))};});
      ws.on('framesent', ev => {
        if(socialInbox.generation!==generation)return;
        if(this.reports)combatObserver.sent(ev.payload);
        try {
          const m = JSON.parse(ev.payload);
          if (m.t === 'state' && Number.isFinite(m.x) && Number.isFinite(m.z)) {
            this.livePos = { room: typeof m.room === 'string' ? m.room : null,
              x: m.x, z: m.z, mv: m.mv, dead: m.dead, at: Date.now() };
            this.reports?.position(this.slot, this.character?.name, this.livePos, this.status);
            this.gearImpact?.position(this.livePos);
            if (this.brain.position(this.livePos,Date.now(),this.pendingTravel?.mapId)) {
              this.log(`director: พักโซน/ปลายทางที่ตายซ้ำ ${m.room} -> ${this.pendingTravel?.mapId||m.room}`, 'warn');
              this.goal = null;
              this.teamGoal = null;
              this.pendingTravel = null;
              this.questNavBlockedUntil = Date.now() + 900000;
              this.refreshGoal();
            }
          }
        } catch { }
      });
    });
    this.page.on('close', () => { this.status = 'closed'; });
    this.ctx.on('close', () => { if (this.status !== 'stopping') this.status = 'closed'; });
  }

  noteProgress(lv, exp, save = {}) {
    const key = JSON.stringify([lv, exp, save.job, save.jobLv, save.coins, save.materials, save.bag, save.equip, save.qIndex]);
    if (key !== this.progressKey) {
      this.progressKey = key;
      this.progressAt = Date.now();
      this.stuckCount = 0;
      this.history.push({ at: Date.now(), lv, exp });
      if (this.history.length > 200) this.history.shift();
    }
  }

  /** Snapshot of everything we can see about the client right now. */
  screen() {
    // Raced by the eval() watchdog like every other round trip. A raw page.evaluate here
    // was the silent-zombie bug: when a renderer froze under CPU starvation, screen() hung
    // forever, tick() hung with it, the unresponsive detector never fired (it counts
    // screen() failures), and the window sat dead until a rotation recycle happened to
    // reject the pending evaluate - up to 15 minutes later.
    return this.eval(`(() => { ${H}
      return {
        url: location.href,
        startVisible: vis('#start'),
        inGame: !vis('#start') && !!$('canvas'),
        loading: vis('#loadScr'),
        lgGuest: vis('#lgGuest'),
        srvGo: vis('#srvGo'),
        csGo: vis('#csGo'),
        csGoDisabled: $('#csGo') ? $('#csGo').disabled : null,
        csForm: vis('#csForm'),
        death: vis('#deathScr'),
        startSub: txt('#startSub'),
        authErr: txt('#authErr'),
        lv: txt('#lvBadge'), exp: txt('#expText'), hp: txt('#hpText'), mp:txt('#mpText'), loc: txt('#locName'),
        autoOn: $('#autoBtn') ? $('#autoBtn').getAttribute('aria-pressed') : null,
        questOn: $('#qGo') ? $('#qGo').getAttribute('aria-pressed') : null,
        panelOpen: vis('#panel'), panelName: ($('#pBody') && $('#pBody').dataset.panel) || null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        fps: Date.now()-(window.__fpsAt||0)<3000 && Number.isFinite(window.__fps) ? window.__fps : null,
        fpsMeasuredAt: window.__fpsAt||null,
        chatTail: (($('#chat') && $('#chat').innerText) || '').split('\\n').slice(-4).join(' | '),
      };
    })()`);
  }

  // ---------------------------------------------------------------- boot ladder
  /**
   * Drive whatever screen the client is on until the character is in the world.
   * Screens: login -> server list -> character list -> world.
   */
  async bootToGame(timeoutMs = 240000) {
    this.status = 'booting';
    const deadline = Date.now() + timeoutMs;
    let lastNote = '';
    let lastScreen = null;
    let startStallSince = 0;      // when we first saw the landing screen with nothing to click
    let triedStartReload = false;
    while (Date.now() < deadline) {
      let s;
      try { s = await this.screen(); }
      catch (e) { if(e.code==='ASTERIA_EVAL_FENCED'||/^action (?:contract|cancelled|duration)/.test(e.message))throw e;this.log('screen read failed: ' + e.message, 'warn'); await sleep(1000); continue; }

      lastScreen = s;

      if (s.inGame) {
        this.status = 'playing';
        // Install the server-frame tap as soon as we are in the world, so party/guild/trade
        // replies that arrive early are not missed. A page reload wipes it, which is why the
        // boot ladder - not the constructor - is the right place.
        await this.ensureFrameTap().catch(() => { });
        return true;
      }

      if (s.loading) { await sleep(500); continue; }

      if (s.csForm) {
        // We create characters through the API, so this should not happen; recover by reloading.
        this.log('character-creation form appeared; reloading to pick up the API-created character', 'warn');
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(3000);
        continue;
      }
      if (s.csGo && s.csGoDisabled === false) {
        if (lastNote !== 'cs') { this.log('character list -> entering world'); lastNote = 'cs'; }
        await this.eval(`(() => { ${H} tap('#csGo'); })()`);
        await sleep(1500); continue;
      }
      if (s.srvGo) {
        if (lastNote !== 'srv') { this.log('server list -> choosing Asteria'); lastNote = 'srv'; }
        await this.eval(`(() => { ${H} tap('#srvGo'); })()`);
        await sleep(1200); continue;
      }
      if (s.lgGuest) {
        // Token was not accepted. Fall back to the UI's guest button, then re-mint if needed.
        if (lastNote !== 'lg') { this.log('login screen -> clicking guest play', 'warn'); lastNote = 'lg'; }
        await this.eval(`(() => { ${H} tap('#lgGuest'); })()`);
        await sleep(2000); continue;
      }
      // Landing screen with nothing to click. The client is waiting on its own handshake, and no
      // branch above matches this state, so it would sit here until the timeout. Seen three times
      // on 2026-09-28, each costing the full 240s plus a browser restart by the supervisor. One
      // reload re-runs the boot with the token already in localStorage.
      //
      // Gated on a 60s stall and bounded to once per boot attempt: a healthy boot leaves this
      // screen within seconds, so this cannot fire on the normal path, and a reload loop would be
      // worse than waiting - the supervisor's retry already restarts the whole browser.
      if (s.startVisible && !s.lgGuest) {
        if (!startStallSince) startStallSince = Date.now();
        if (!triedStartReload && Date.now() - startStallSince > 60000) {
          triedStartReload = true;
          this.log('landing screen with no actionable control for 60s -> reloading once', 'warn');
          // As on initial navigation, commit is sufficient. The native screen
          // ladder verifies entry; unrelated DOM-ready work can otherwise
          // exhaust the reload timeout while this character remains offline.
          await this.page.reload({ waitUntil: 'commit', timeout: Math.min(30000, Math.max(1, deadline-Date.now())) });
          await sleep(3000);
          startStallSince = 0;
          continue;
        }
      } else {
        startStallSince = 0;
      }
      await sleep(400);
    }
    // Say *where* it was stuck. Without this the only symptom is "boot timed out" and the
    // screen the client was sitting on - the one fact that identifies the cause - is lost.
    throw new Error(`boot timed out after ${Math.round(timeoutMs / 1000)}s${lastScreen ? ` on ${describeScreen(lastScreen)}` : ' (never managed to read a screen)'}`);
  }

  async gotoAndBoot() {
    this.log(`goto ${api.BASE}/ (${this.width}x${this.height}, noDraw=${this.noDraw})`);
    // 'commit' returns as soon as the navigation starts; the heavy 1.2MB page then parses
    // while we wait for #start below. Waiting for domcontentloaded on a slow link just
    // burns the timeout.
    await this.page.goto(api.BASE + '/', { waitUntil: 'commit', timeout: 120000 });
    await this.page.waitForSelector('#start', { timeout: 180000 });
    return this.bootToGame();
  }

  eval(js) {
    // Every owned round trip is a cooperative cancellation boundary, including
    // NPC search loops that do not call screen(). Health reads have no owner.
    try{this.v2?.scheduler?.checkpoint();}catch(error){return Promise.reject(error);}
    const page=this.page;
    if(!require('./registry/worker').valid(this))return Promise.reject(new Error('Native dispatch rejected: global assignment fenced'));
    if(this.actorOwner&&!this.registryV32?.store.validateOwner(this.actorOwner))return Promise.reject(new Error('Native dispatch rejected: actor owner fence changed'));
    if(page&&this.evalFencedPage===page)return Promise.reject(Object.assign(new Error('Native dispatch rejected: previous evaluation timed out; context must close'),{code:'ASTERIA_EVAL_FENCED'}));
    if(!page)return Promise.reject(new Error('client page unavailable during recycle'));
    // Every evaluate races a watchdog (see the evalTimeoutMs note in the constructor). The
    // timed-out evaluation fences this entire page. No queued action can use it
    // until the supervisor positively closes the old context before replacement.
    let timer,timedOut=false;
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut=true;
        if(this.page===page)this.evalFencedPage=page;
        reject(new Error(`evaluate timed out after ${Math.round(this.evalTimeoutMs / 1000)}s - renderer frozen?`));},
        this.evalTimeoutMs);
    });
    return Promise.race([Promise.resolve().then(()=>page.evaluate(js)), watchdog]).then(value=>{
      if(this.page===page)this.rendererHealth={lastSuccessAt:Date.now(),consecutiveTimeouts:0,firstTimeoutAt:null,lastTimeoutAt:null};
      return value;
    },error=>{
      if(timedOut&&this.page===page){const at=Date.now(),previous=this.rendererHealth||{};
        this.rendererHealth={...previous,consecutiveTimeouts:(previous.consecutiveTimeouts||0)+1,firstTimeoutAt:previous.firstTimeoutAt||at,lastTimeoutAt:at};
      }
      throw error;
    }).finally(() => clearTimeout(timer));
  }

  // ---------------------------------------------------------------- social layer
  //
  // Party / guild / dungeon / trade / pets all ride on window.AsteriaNet.social(kind, data)
  // (see src/social.js for how that was established from the shipped client). These are the
  // controller-side wrappers; none of them need a walk, a raycast or a 3-D NPC.

  /** Install the server-frame tap if this page does not have one yet. Idempotent. */
  ensureFrameTap() {
    return this.eval(`(() => { ${SOCIAL} return !!window.__afTap; })()`);
  }

  /** True while this window's own websocket is open and welcomed. */
  socialOnline() { return api_social.online(this); }

  /** Send one social command. Returns {ok} - never throws on a closed socket. */
  socialSend(kind, data) { return api_social.send(this, kind, data); }
  queryDailyQuotas() { return api_social.dailyQuotas(this); }

  /** Server frames seen since `since` (ms epoch), optionally filtered by type. */
  socialFrames(t, since) {
    if(this.socialInbox?.owns(t))return Promise.resolve(this.socialInbox.frames(t,since));
    return api_social.frames(this,t,since);
  }

  /** The most recent frame of a type, or null. */
  socialLast(t) {
    if(this.socialInbox?.owns(t))return Promise.resolve(this.socialInbox.last(t));
    const row=this.socialInbox?.last(t);return row?Promise.resolve(row):api_social.last(this,t);
  }

  /** Open one of the #menu panels by DOM click and wait until it is really open. */
  openGamePanel(name) { return api_social.openPanel(this, name); }

  closeGamePanel() { return api_social.closePanel(this); }

  panelText() { return api_social.panelText(this); }

  /** The live party as the server last described it: {id, members:[{aid,name,…}], leader}. */
  async partyState() {
    const m = await this.socialLast('party');
    return m && m.id ? m : null;
  }

  async guildState() {
    const m = await this.socialLast('guild');
    return m && m.id ? m : null;
  }

  /** Invite a character (by name) into this window's party. Leader only, server-enforced. */
  partyInvite(name) { return this.socialSend('pinv', { name }); }

  /**
   * Accept the oldest un-accepted party invite sitting in the frame buffer.
   *
   * The client shows these as a card in #invites with ตกลง/ไม่ buttons; answering with
   * `pans {from, ok}` is the same frame that card sends, and it does not depend on the card
   * still being on screen when we get round to it.
   */
  async partyAcceptPending(since) {
    const invites = await this.socialFrames('pinvite', since);
    if (!invites.length) return { ok: false, reason: 'no-invite' };
    const from = invites[invites.length - 1].from;
    if (!from) return { ok: false, reason: 'invite-without-from' };
    const r = await this.socialSend('pans', { from, ok: true });
    return { ...r, from };
  }

  partyLeave() { return this.socialSend('pleave'); }

  guildInvite(name) { return this.socialSend('ginv', { name }); }

  async guildAcceptPending(since) {
    const invites = await this.socialFrames('ginvite', since);
    if (!invites.length) return { ok: false, reason: 'no-invite' };
    const from = invites[invites.length - 1].from;
    if (!from) return { ok: false, reason: 'invite-without-from' };
    const r = await this.socialSend('gans', { from, ok: true });
    return { ...r, from };
  }

  /** Found a guild. The fee is charged by the server, not the client. */
  guildCreate(name) { return this.socialSend('gcreate', { name }); }

  guildLeave() { return this.socialSend('gleave'); }

  /** Ask the server for the boss list / dungeon list / pet list. */
  queryBosses() { return this.eval(`(() => { const n = window.AsteriaNet; if (!n || !n.bosses) return false; n.bosses(); return true; })()`); }

  queryDungeons() { return this.socialSend('dgq'); }

  queryPets() { return this.socialSend('prq'); }

  async dungeonStart() {
    const now=Date.now(),state=await this.socialLast('dg'),fresh=require('./runtime/freshness').fresh;
    if(this.livePos?.room!=='town'||!fresh(this.livePos.at,10000,now)||!fresh(this.lastSaveAt,30000,now)||!state||!fresh(state._receivedAt,45000,now)||state.open!==true||!(state.left>0)||!Number.isInteger(state.minLv)||this.lastSave?.lv<state.minLv||!Number.isInteger(this.lastSave?.lv)||state.run&&!state.run.done)return {ok:false,sent:false,reason:'fresh Eclipse Rift eligibility required'};
    return this.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.fixed||n.kicked||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return {ok:false,sent:false};n.handlers.resave();await n.flush();if(!n.isConnected()||n.pause||n.fixed||n.kicked)return {ok:false,sent:false};n.social('dgstart',{});return {ok:true,sent:true};})()`);
  }

  async dungeonJoin(id,deadline=Date.now()+120000) {
    const now=Date.now(),state=await this.socialLast('dg'),fresh=require('./runtime/freshness').fresh;
    if(now>=deadline||this.livePos?.room!=='town'||!fresh(this.lastSaveAt,30000,now)||!state||!fresh(state._receivedAt,45000,now)||state.run?.id!==id||state.run.done)return {ok:false,sent:false,reason:'fresh matching Rift invitation required'};
    return this.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.fixed||n.kicked||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return {ok:false,sent:false};n.handlers.resave();await n.flush();if(Date.now()>=${Number(deadline)}||!n.isConnected()||n.pause||n.fixed||n.kicked)return {ok:false,sent:false};n.social('dgjoin',{id:${JSON.stringify(id)}});return {ok:true,sent:true};})()`);
  }

  dungeonQuit() { return this.socialSend('dgquit'); }

  /** Buy the next bag page (ขยายกระเป๋า). */
  async bagUpgrade({toMaximum=false}={}) {
    const save=this.lastSave||{},world=this.catalog().world||{},tier=save.bagTier||0,price=world.BAG_PRICES?.[tier],now=Date.now();
    if(!this.lastSaveAt||now-this.lastSaveAt>30000||now-this.lastSaveAt < -5000)return {ok:false,reason:'fresh-save-required'};
    if(require('./runtime/room-policy').roomPolicy(require('./runtime/room-policy').currentRoom(this)).dungeon)return {ok:false,reason:'active dungeon owns this room'};
    if(!Number.isInteger(tier)||tier<0)return {ok:false,sent:false,reason:'bag-price-unverified'};
    if(Array.isArray(world.BAG_PRICES)&&tier===world.BAG_PRICES.length&&Number.isFinite(world.bagCap?.(tier)))return {ok:false,sent:false,reason:'bag-max-tier',capacity:world.bagCap(tier)};
    if(!Number.isFinite(price)||price<=0)return {ok:false,sent:false,reason:'bag-price-unverified'};
    const reserve=toMaximum?Math.max(1000,(save.lv||1)*100):require('./upgrade-reserve').reserve(save,world);
    if(!Number.isFinite(save.coins)||save.coins-price<reserve)return {ok:false,reason:'bag-upgrade-reserve-required'};
    const journal=this.v2?.journal||(this.bagJournal ||= new(require('./runtime/action-journal').ActionJournal)(this.root,this.credentials?.username||'slot-'+this.storageSlot));
    journal.observe(save,this.lastSaveAt);
    if(toMaximum){const legacy=journal.pending('bag-capacity');if(legacy){legacy.status='SUPERSEDED';legacy.supersededAt=now;legacy.reason='New explicit maximum-capacity request supersedes the one-page goal; historical outcome remains unknown';legacy.evidence='new_operator_goal_not_transaction_success';journal.save();}}
    // The user's maximum-capacity authorization is a new bounded intent. Preserve
    // legacy uncertain one-page requests; never replay an uncertain maximum request.
    const row=journal.begin('bag-upgrade',{item:toMaximum?'bag-capacity-to-maximum':'bag-capacity',fromTier:tier,price},save,now,path.basename(this.cache.dir));
    if(!row)return {ok:false,reason:'previous-bag-upgrade-awaiting-confirmation'};
    let ownedPanel=false;
    try {const opened=await this.openGamePanel('bag');ownedPanel=!!opened?.ok;
      const armed=opened.ok&&await this.eval(`(() => {const gear=document.querySelector('#pBody [data-f="gear"]');if(gear)gear.click();const b=document.querySelector('#pBody [data-bagup]');if(!b||b.disabled)return false;b.click();return true;})()`);
      if(armed)await sleep(300);
      const confirmed=armed&&await this.eval(`(() => {const b=document.querySelector('#pBody [data-bagup]');if(!b||b.disabled)return false;b.click();return true;})()`);
      const sent={ok:!!confirmed,reason:confirmed?null:'bag-upgrade-button-unavailable'};journal.sent(row,sent);if(!sent.ok)return sent;
      const until=Date.now()+15000;
      while(Date.now()<until&&row.status!=='CONFIRMED'){await sleep(500);journal.observe(this.lastSave,this.lastSaveAt);}
      return {ok:row.status==='CONFIRMED',sent:true,tier:this.lastSave.bagTier,status:row.status,evidence:row.evidence,reason:row.status==='CONFIRMED'?null:'bag-tier-change-not-yet-observed'};
    }catch(e){row.status='UNCERTAIN';row.reason='Bag command outcome unknown; reconcile before retry';journal.save();throw e;}
  }

  petBuy(id) { return this.socialSend('prbuy', { id }); }

  petWear(id) { return this.socialSend('prwear', { id }); }

  petQuest(data) { return this.socialSend('prquest', data || {}); }

  // ---------------------------------------------------------------- tower
  //
  // Asteria Tower: 100 floors, 1-6 players, OPEN EVERY DAY (unlike Eclipse Rift, which is
  // weekends only). Clear every monster on a floor before the timer runs out and the next door
  // opens. Every 10th floor is a miniboss, floors 25/50/75 a boss, and floor 100 the strongest.
  // First-clear rewards are the reason to run it: Copper 200 x floor, Rune Dust floor/2,
  // Ancient Rune on floors 25/50/75/100 and Celestial Plume on 50/75/100 - and Celestial Plume
  // is the wing material.
  //
  // Both starting and accepting a tower invitation require town.

  /**
   * Open the Tower panel.
   *
   * There is NO `data-p="tower"` menu button - the tower is a tab (`data-dg-tab="tower"`)
   * inside the dungeon panel, and clicking that tab is what calls openPanel('tower'). Going
   * straight at the menu finds nothing and silently leaves the previous panel open, which is
   * exactly what made an early probe report a tower panel that was really the collection book.
   */
  async openTowerPanel() {
    const d = await this.openGamePanel('dungeon');
    if (!d || !d.ok) return d;
    await this.eval(`(() => { const b = document.querySelector('#pBody [data-dg-tab="tower"]'); if (b) b.click(); return true; })()`);
    for (let i = 0; i < 15; i++) {
      await sleep(150);
      if (await api_social.panelName(this) === 'tower') return { ok: true };
    }
    return { ok: false, reason: 'tower-panel-did-not-open', now: await api_social.panelName(this) };
  }

  /** Ask the server for the tower state. It only sends `tw` when asked, never unprompted. */
  towerQuery() { return this.socialSend('twq'); }

    async towerStart(from=1) {
    const now=Date.now(),state=await this.socialLast('tw');
    if(this.livePos?.room!=='town'||!require('./runtime/freshness').fresh(this.livePos.at,10000,now)||!require('./runtime/freshness').fresh(this.lastSaveAt,30000,now)||!state||!require('./runtime/freshness').fresh(state._receivedAt,45000,now)||!(state.left>0)||state.run&&!state.run.done||!(state.starts||[1]).includes(from))return {ok:false,sent:false,reason:'fresh tower start eligibility required'};
    return this.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.fixed||n.kicked||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return {ok:false,sent:false,reason:'tower-save-flush-unavailable'};n.handlers.resave();await n.flush();if(!n.isConnected()||n.pause||n.fixed||n.kicked)return {ok:false,sent:false};n.social('twstart',{from:${Number(from)}});return {ok:true,sent:true};})()`);
  }

  async towerJoin(id,deadline=Date.now()+120000) {
    const now=Date.now(),state=await this.socialLast('tw');
    if(now>=deadline||this.livePos?.room!=='town'||!require('./runtime/freshness').fresh(this.lastSaveAt,30000,now)||!state||!require('./runtime/freshness').fresh(state._receivedAt,45000,now)||state.run?.id!==id||state.run.done)return {ok:false,sent:false,reason:'fresh matching tower join required'};
    return this.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.fixed||n.kicked||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return {ok:false,sent:false};n.handlers.resave();await n.flush();if(Date.now()>=${Number(deadline)}||!n.isConnected()||n.pause||n.fixed||n.kicked)return {ok:false,sent:false};n.social('twjoin',{id:${JSON.stringify(id)}});return {ok:true,sent:true};})()`);
  }
towerQuit() { return this.socialSend('twquit'); }

  // ---------------------------------------------------------------- guild hall & dungeon
  /** Enter the guild hall (map 'gh') from the guild panel. Requires guild membership. */
  async enterGuildHall() {
    if(require('./runtime/room-policy').isGuildHall(this.livePos?.room))return {ok:true};
    const open = await this.openGamePanel('social');
    if (!open || !open.ok) return { ok: false, reason: 'guild-not-open' };
    await this.eval(`(() => { ${H}
      document.querySelector('#pBody [data-soc-tab="guild"]')?.click();
      const btn=document.querySelector('#pBody [data-g="hall"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (require('./runtime/room-policy').isGuildHall(this.livePos?.room)) { await this.closeGamePanel(); this.log('entered the guild hall'); return { ok: true }; }
    }
    await this.closeGamePanel();
    return { ok: false, reason: 'hall-not-entered' };
  }

  /** Guild-dungeon leader: start a run. Only works inside the hall (map 'gh'). */
  async guildDungeonStart() {
    if (!require('./runtime/room-policy').isGuildHall(this.livePos?.room)) return { ok: false, sent:false, reason: 'not-in-hall' };
    const r = await this.eval(`(async () => {const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.fixed||n.kicked||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return {ok:false,sent:false,reason:'guild-save-flush-unavailable'};n.handlers.resave();await n.flush();if(!n.isConnected()||n.pause||n.fixed||n.kicked)return {ok:false,sent:false,reason:'guild-session-changed-before-send'};n.social('gdstart',{});return {ok:true,sent:true};})()`);
    if (r && r.ok) this.log('guild dungeon: started a run (gdstart)');
    return r || { ok: false };
  }

  /** Guild-dungeon member: join the run the server announced. */
  guildDungeonJoin(id) { return this.socialSend('dgjoin', { id }); }


  /** The tower as the server last described it: {best, left, runs, floorSec, livesMax, run}. */
  async towerState() {
    const m = await this.socialLast('tw');
    return m && (m.best !== undefined || m.run) ? m : null;
  }

  // ---------------------------------------------------------------- exchange crafting
  //
  // The exchange merchant is a 3-D town NPC. Its recipes are data-driven (the client's EXCHANGE
  // array) and each row is a `[data-ex="index"]` button that the client itself refuses to fire
  // until `recipeReady` says the cost is met - so clicking a ready row is the whole craft.

  /** Every recipe the merchant currently offers, with its readiness and output name. */
  async readExchange() {
    const open = await this.openTownService('exchange');
    if (!open || !open.ok) return { ok: false, reason: 'exchange-not-open', open };
    await sleep(600);
    const rows = await this.eval(`(() => Array.from(document.querySelectorAll('#pBody [data-ex]')).map(b => {
      const row = b.closest('.shoprow') || b.parentElement;
      return {
        i: b.dataset.ex,
        ready: !b.disabled,
        text: ((row && row.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      };
    }))()`);
    return { ok: true, rows: rows || [] };
  }

  /** Craft one exchange recipe by matching its output name. */
  async craftAtExchange(matchName, category = 'gear') {
    const open = await this.openTownService('exchange');
    if (!open || !open.ok) return { ok: false, reason: open?.reason || 'exchange-not-open' };
    await sleep(600);
    await this.eval(`(() => { const top=document.querySelector('[data-ex-top="ex"]');if(top)top.click();const b=document.querySelector('[data-ex-tab="' + ${JSON.stringify(category)} + '"]'); if(b)b.click(); })()`);
    await sleep(300);
    const check=require('./runtime/paid-actions').preflight(this,'craftAtExchange',[matchName,category]);
    if(!check.allowed||this.livePos?.room!=='town'||!require('./runtime/freshness').decisionGate(this).allowed||this.v2?.sourceCoherence?.matches===false)return {ok:false,reason:check.reason||'craft-state-changed'};
    const select=require('./runtime/exchange-selection').select;
    if(this.activeDevelopmentAttempt?.kind==='craft'&&!this.developmentLedger.markCraftDispatch(this.activeDevelopmentAttempt.id,require('./runtime/craft-scope').target(this,matchName)))throw Error('Craft dispatch ledger boundary changed');
    const quantityRequired=this.catalog().nativeSemanticContracts?.craft?.facts?.singleQuantityRequired===true;
    const r=await this.eval(`(${select.toString()})(document,${JSON.stringify(String(matchName))},${JSON.stringify(check.row.cost)},${quantityRequired})`);
    await sleep(900);
    return r;
  }

  /**
   * Refine what is worn, while the odds are worth it.
   *
   * Refining is the cheapest real power in the game AND it is safe: from the wiki's own rules
   * +0 to +3 succeed 100% of the time, and a failure costs ore and Copper but the item is not
   * destroyed and its level does not drop. That is what makes this automatable where enchanting
   * (gacha, with a pity counter) is a judgement call about the player's resources.
   *
   * The button is keyed on item id, not uid, and the level is tracked per item id in the save.
   */
  async refineEquipped({ maxChanceDrop = 0, dryRun, targetId=null, maxAttempts=1, guaranteedOnly=false, extraReserveCoins=0, reservedMaterials={}, foundation=false } = {}) {
    const { items, world } = this.catalog();
    const wiki = economy.loadWiki(this.root);
    const save = this.lastSave || {};
    if(!reservedMaterials||typeof reservedMaterials!=='object'||Object.values(reservedMaterials).some(n=>!Number.isFinite(n)||n<0))return {refined:0,reason:'invalid protected material reserve'};
    const reserveExtra=Number.isFinite(extraReserveCoins)&&extraReserveCoins>=0?extraReserveCoins:Infinity;
    const makePlan=s=>economy.refinePlan({equip:s.equip||{},refine:s.refine||{},materials:Object.fromEntries(Object.entries(s.materials||{}).map(([name,n])=>[name,Math.max(0,n-(reservedMaterials[name]||0))])),coins:Math.max(0,(s.coins||0)-require('./upgrade-reserve').reserve(s,world)-reserveExtra),items,world,wiki,maxChanceDrop,state:s,foundation:foundation===true&&guaranteedOnly===true&&require('./equipment-goal').policy(this.catalog()).bridgeOwned===true&&s.lv>=20&&s.lv<world.MAX_LV});
    const plan=makePlan(save);
    if(guaranteedOnly)plan.doable=plan.doable.filter(s=>s.guaranteed);
    const basePower=require('./gear-value').totals(save,this.catalog()).score;
    for(const step of plan.doable){const after={...save,refine:{...save.refine,[step.id]:(save.refine?.[step.id]||0)+1}};step.expectedGain=step.valuation?.expectedGain??Math.max(0,require('./gear-value').totals(after,this.catalog()).score-basePower)*step.chancePct/100;step.valuePerCopper=step.expectedGain/Math.max(1,step.coinCost);}
    plan.doable.sort((a,b)=>b.valuePerCopper-a.valuePerCopper);
    this.refineRanking=plan.doable.slice(0,6);
    if (dryRun) return { dryRun: true, doable: plan.doable, blockedByOre: plan.blockedByOre, coinCost: plan.coinCost };
    if (!plan.doable.length) return { refined: 0, attempted: 0, blockedByOre: plan.blockedByOre };

    const open = await this.openTownService('smithShop');
    if (!open || !open.ok) return { refined: 0, reason: 'smith-not-open', open };
    await sleep(700);

    // Opening the NPC can take seconds and another save can change resources.
    // Verify the exact step again before its native payment button is pressed.
    if(this.livePos?.room!=='town'||!require('./runtime/freshness').decisionGate(this).allowed||this.v2?.sourceCoherence?.matches===false||this.teamControl||this.dailyTeamPending||this.dailyWorkStatus?.ownsNavigation||this.v2?.trial?.active()||require('./runtime/team-trade').blocksNavigation(this))return {refined:0,reason:'refine state changed while opening blacksmith'};

    let refined = 0;
    const missed = [];
    let budget = Math.max(0,(save.coins||0)-require('./upgrade-reserve').reserve(save,world));
    for (const s of plan.doable.filter(s=>!targetId||s.id===targetId).slice(0,maxAttempts)) {
      if(s.coinCost>budget) continue;
      const current=makePlan(this.lastSave||{}).doable.find(r=>r.id===s.id&&r.slot===s.slot&&r.from===s.from&&(!guaranteedOnly||r.guaranteed));
      if(!current)continue;
      // Re-read each time: the panel re-renders after every attempt (level, cost and ore all
      // change), so a handle captured up front goes stale exactly like the sell and donate lists.
      const trackedRefine=this.developmentLedger?.rows?.find(r=>r.id===this.activeDevelopmentAttempt?.id);
      if(!require('./runtime/fresh-refine-attempt').dispatch(this,trackedRefine,current))throw Error('Fresh native refinement intent expired before payment');
      if(this.activeDevelopmentAttempt?.kind==='refine'&&!this.developmentLedger.markRefineDispatch(this.activeDevelopmentAttempt.id,current))throw Error('Refine dispatch ledger boundary changed');
      const contract=current.destructive?require('./knowledge/development-source').source(this.root,this.catalog().build,this.catalog(),'refine').contract.facts:null;
      if(current.destructive&&(!current.spare||current.valuation?.eligible!==true||!contract?.twoTap||!contract.confirmation))throw Error('Native destructive risk/spare/confirmation contract changed');
      const click=()=>this.eval(`(() => {
        const stone = document.querySelector('#pBody [data-ref-stone]');
        if (stone?.checked) { if (stone.disabled) return false; stone.click(); }
        if (document.querySelector('#pBody [data-ref-stone]')?.checked) return false;
        const wantedGuard=${JSON.stringify(!!current.guard)},guard=document.querySelector('#pBody [data-ref-guard]');
        if(!!guard?.checked!==wantedGuard){if(!guard||guard.disabled)return false;guard.click();}
        if(!!document.querySelector('#pBody [data-ref-guard]')?.checked!==wantedGuard)return false;
        const b = document.querySelector('#pBody [data-refine="' + ${JSON.stringify(String(s.id))} + '"]');
        if (!b || b.disabled) return false;
        b.click(); return {clicked:true,at:Date.now()};
      })()`);
      const hit=await click();
      if(hit&&current.destructive){
        const window=contract.confirmation;
        await sleep(window.minimumMs+50);
        // The first tap may already have dispatched if an old native arm existed.
        // The WAL is persisted before either tap; native busy plus this exact
        // current-step recheck prevents a second payment in that case.
        const next=makePlan(this.lastSave||{}).doable.find(r=>r.id===current.id&&r.from===current.from&&r.destructive);
        if(next&&Date.now()-hit.at<window.maximumMs&&require('./runtime/freshness').decisionGate(this).allowed&&require('./runtime/fresh-refine-attempt').dispatch(this,trackedRefine,next,Date.now(),true))await click();
      }
      // A clicked arm with an unknown final effect remains an attempted payment,
      // never NOT_SENT and never replayed merely because no receipt arrived.
      if (hit) { refined++; budget-=s.coinCost; await sleep(800); } else missed.push(s.slot);
    }
    return { refined, attempted: plan.doable.length, missed, coinCost: plan.coinCost };
  }

  /** What wing this character is working towards, and what is still missing. */
  async wingPlan() {
    const cat = this.catalog();
    const wings = economy.loadWings(this.root, cat.build);
    const wiki = economy.loadWiki(this.root);
    const b = await this.belongings();
    const mats = (this.lastSave && this.lastSave.materials) || {};
    return economy.wingPlan({
      job: b.job, materials: mats, coins: b.coins, lv: b.lv,
      world: cat.world, items: cat.items, wings,
      recipes: (wiki && wiki.crafting && wiki.crafting.recipes) || [],
      held: economy.ownedNames(b),
    });
  }

  /**
   * Pet state: which monsters are close to unlocking, and which pet is worn.
   *
   * Pets are NOT bought. `PET_UNLOCK` sets the kills needed per monster (boss 50, miniboss 30,
   * normal 500-3000 by monster level), and only once a monster passes its threshold does the
   * collection panel offer that pet at all - which is why an early probe found zero buttons.
   */
  async petState() {
    const open = await this.openGamePanel('collection');
    if (!open || !open.ok) return { ok: false, reason: 'collection-not-open' };
    await this.eval(`(() => { const b = document.querySelector('#pBody [data-col-tab="pets"]'); if (b) b.click(); return true; })()`);
    await sleep(700);
    const r = await this.eval(`(() => {
      const btns = Array.from(document.querySelectorAll('#pBody [data-pet]'));
      return {
        buttons: btns.length,
        pets: btns.map(b => ({ id: b.dataset.pet, disabled: !!b.disabled, text: (b.innerText || '').trim().slice(0, 40) })),
        text: (document.getElementById('pBody') || {}).innerText ? document.getElementById('pBody').innerText.replace(/\\s+/g, ' ').slice(0, 400) : '',
      };
    })()`);
    await this.closeGamePanel();
    return { ok: true, ...r };
  }


  // ---------------------------------------------------------------- economy
  //
  // The decisions live in src/economy.js (computed from the game's own tables); these are the
  // hands. Selling and stashing are DOM actions inside a town-service panel, because those
  // panels are 3-D objects with no socket command behind them.

  /** The catalog for the build this window is actually running. */
  catalog() {
    // AssetCache keeps its namespace as the last path segment (cache/<buildHash>), so the
    // build the window booted from is available even when nothing passed it explicitly.
    const fromCache = (this.cache && this.cache.dir) ? path.basename(this.cache.dir) : '';
    return economy.loadCatalog(this.root, this.buildHash || fromCache);
  }

  /** Everything we can see about this character's belongings, for the planner. */
  async belongings() {
    const save = this.lastSave || {};
    return { bag: save.bag || [], equip: save.equip || {}, coins: save.coins || 0, lv: save.lv || 1, job: save.job || 'novice' };
  }

  /** What the planner would do with this character's bag right now. */
  async planBag(roster) {
    const { world, items } = this.catalog();
    const b = await this.belongings();
    return economy.planBag({
      bag: b.bag, equip: b.equip, job: b.job, lv: b.lv,
      world, items, roster, keepIds: this.keepIds || [], save:this.lastSave,
    });
  }

  /**
   * Read the gear shop's sell list as the DOM actually presents it.
   *
   * The saved bag holds bare item ids, but the sell button is keyed on the client's own numeric
   * `uid` (`data-sell-gear="137"`), which is generated per page load and never appears in a
   * save. So the uid has to come from the DOM, and the item is identified by its name.
   */
  async readSellRows() {
    return this.eval(`(() => {
      const rows = [];
      document.querySelectorAll('#pBody [data-sell-gear]').forEach(b => {
        const row = b.closest('.shoprow') || b.parentElement;
        const nameEl = row && row.querySelector('.iname');
        const metaEl = row && row.querySelector('.imeta');
        const raw = (nameEl && nameEl.innerText || '').replace(/\\s+/g, ' ').trim();
        // The icon is an <img>, so the text is just the name, possibly with a "+7" refine
        // suffix. Do NOT strip a leading word here: after trim() that would turn
        // "Leaf Hood" into "Hood", which matched nothing and looked like an empty bag.
        const name = raw.replace(/\\s*\\+\\d+\\s*$/, '').trim();
        rows.push({
          uid: b.dataset.sellGear,
          name,
          meta: (metaEl && metaEl.innerText || '').replace(/\\s+/g, ' ').trim(),
          unusable: /ใช้ไม่ได้/.test(metaEl && metaEl.innerText || ''),
        });
      });
      return rows;
    })()`);
  }

  /**
   * Sell the items a plan chose, by name.
   *
   * The shop's own per-item button is a two-click confirm (`sellArm`), so each uid is clicked
   * twice with a pause - one click leaves the button armed and nothing sold, which looks like
   * success in a log while the bag never changes.
   */
  async sellItems(wanted) {
    if (!wanted || !wanted.length) return { sold: 0 };
    const open = await this.openTownService('gearShop');
    if (!open || !open.ok) return { sold: 0, reason: 'shop-not-open', open };
    await this.eval(`(() => { const b = document.querySelector('#pBody [data-shop-tab="sell"]'); if (b) b.click(); return true; })()`);
    await sleep(600);

    const rows0 = await this.readSellRows();

    let sold = 0;
    const missed = [];
    for (const want of wanted) {
      if(want.id&&require('./gear-value').compare(this.lastSave||{},this.catalog(),want.id).upgrade){missed.push(want.name||want.id);continue;}
      const name = typeof want === 'string' ? want : (want.name || '');
      // Verify against the shop list rather than counting clicks. Two clicks on a button whose
      // row has been re-rendered mid-sequence does NOT sell, and the old counter reported 8 sold
      // when only 6 items had actually left the bag - a log that lies is worse than no log.
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const rows = await this.readSellRows();
        const row = rows.find(r => r.name === name);
        if (!row) { ok = attempt > 0; break; }        // gone from the list => it sold
        const click = () => this.eval(`(() => {
          const b = document.querySelector('#pBody [data-sell-gear="' + ${JSON.stringify(row.uid)} + '"]');
          if (!b) return false; b.click(); return true;
        })()`);
        await click();
        await sleep(450);
        await click();                                 // second click confirms
        await sleep(700);
        const after = await this.readSellRows();
        ok = !after.some(r => r.name === name);
      }
      if (ok) sold++; else missed.push(name);
    }
    return { sold, missed, rows: rows0.length };
  }

  /**
   * Move gear into personal storage, and optionally all materials.
   *
   * Same uid problem as selling: the stash button is keyed on the client's numeric uid, so the
   * rows are read from the panel and matched by name.
   */
  async stashItems(wanted, materialNames) {
    // Personal storage v2 moves gear by native selection + move button.
    // Craft/wing materials remain on the character; no bulk material move.
    const result=await require('./runtime/personal-storage').move(this,wanted,{side:'bag'});
    return {...result,stashed:result.moved,materials:0};
  }

  /** Buy one item from the gear shop, if the shop stocks it and the purse allows. */
  async buyItem(id) {
    const open = await this.openTownService('gearShop');
    if (!open || !open.ok) return { ok: false, reason: 'shop-not-open' };
    await this.eval(`(() => { const b = document.querySelector('#pBody [data-shop-tab="buy"]'); if (b) b.click(); return true; })()`);
    await sleep(500);
    const r = await this.eval(`(() => {
      const b = document.querySelector('#pBody [data-buy-gear="' + ${JSON.stringify(String(id))} + '"]');
      if (!b) return { ok: false, reason: 'not-stocked' };
      if (b.disabled) return { ok: false, reason: 'disabled (coins or bag full)' };
      b.click();
      return { ok: true };
    })()`);
    await sleep(600);
    return r;
  }

  // ---------------------------------------------------------------- power actions
  //
  // Everything a character needs to actually get strong, driven through the client's own UI.
  // Each of these is idempotent: running it when there is nothing to do is a no-op, so the
  // maintenance loop can call them every town visit without bookkeeping.

  /**
   * Put on gear the plan says is an upgrade.
   *
   * The bag row opens a detail popup, and the popup carries `[data-act="equip"]`. Going through
   * the popup (rather than the double-click shortcut) gives a verifiable intermediate state -
   * if the popup does not open, nothing was equipped and we know it.
   */
  async recoverStoredUpgrades() {
    const storage=require('./runtime/personal-storage');
    if(!storage.allowed(this))return {withdrawn:0,reason:'storage-ownership-or-freshness'};
    let withdrawn=0,equipped=0;
    try{for(let step=0;step<2;step++){
      const view=await storage.read(this,'st');if(view.reason)return {withdrawn,equipped,reason:view.reason};
      const cat=this.catalog(),choices=view.rows.filter(r=>!r.blocked&&!this.lastSave.locks?.includes(r.id)).map(r=>({...r,comparison:require('./gear-value').compare(this.lastSave,cat,r.id)})).filter(r=>r.comparison.upgrade).sort((a,b)=>Number(!this.lastSave.equip?.[b.comparison.slot])-Number(!this.lastSave.equip?.[a.comparison.slot])||require('./equipment-goal').priority(b.comparison)-require('./equipment-goal').priority(a.comparison));
      const pick=choices[0];if(!pick)break;
      const result=await storage.move(this,[{id:pick.id}],{side:'st'});if(!result.moved)return {withdrawn,equipped,reason:result.reason};
      withdrawn+=result.moved;await this.closeGamePanel();
      const plan=await this.planBag(this.roster),equip=await this.equipItems(plan.equip);equipped+=equip.equipped||0;
      if(!equip.equipped)break;
    }return {withdrawn,equipped,evidence:withdrawn?'outgoing_client_save':null};}finally{await this.closeGamePanel();}
  }

  async equipItems(wanted) {
    if (!wanted || !wanted.length) return { equipped: 0 };
    const open = await this.openGamePanel('bag');
    if (!open || !open.ok) return { equipped: 0, reason: 'bag-not-open', open };
    await this.eval(`(() => {const b=document.querySelector('#pBody [data-f="gear"]');if(b)b.click();})()`);

    let equipped = 0;
    const missed = [];
    for (const want of wanted) {
      const name = typeof want === 'string' ? want : (want.name || '');
      if (!name) continue;
      if(want.id&&typeof this.catalog==='function'){
        const comparison=require('./gear-value').compare(this.lastSave,this.catalog(),want.id);
        if(!comparison.upgrade||comparison.slot!==want.slot){missed.push(name+' (plan changed)');continue;}
        if(['acc1','acc2'].includes(want.slot)&&this.lastSave.equip?.acc1&&this.lastSave.equip?.acc2){
          const result=await require('./runtime/accessory-swap').replace(this,want);
          equipped+=result.equipped;if(!result.equipped)missed.push(name+' ('+result.reason+')');
          if(result.reason?.includes('unknown'))break;
          continue;
        }
      }
      const owned=(this.lastSave?.bag||[]).find(x=>typeof x==='object'&&x.id===want.id);
      const uid=Number.isFinite(owned?.uid)?String(owned.uid):null;
      // Open the row's popup.
      const opened = await this.eval(`(() => {
        const btn = Array.from(document.querySelectorAll('#pBody .tile[data-k]'))
          .find(b => /^[0-9]+$/.test(b.dataset.k) && (${JSON.stringify(uid)}!==null?b.dataset.k===${JSON.stringify(uid)}:b.title === ${JSON.stringify(name)}||b.querySelector('.ico[data-tipn]')?.dataset.tipn===${JSON.stringify(name)}))
          || Array.from(document.querySelectorAll('#pBody button'))
          .find(b => ((b.innerText || '').replace(/\\s+/g, ' ').trim()).startsWith(${JSON.stringify(name)}));
        if (!btn) return false;
        btn.click(); return true;
      })()`);
      if (!opened) { missed.push(name); continue; }
      await sleep(450);
      const done = await this.eval(`(() => {
        const pop = document.getElementById('itemPop');
        if (!pop || pop.hidden) return false;
        const b = document.querySelector('#itemPopBody [data-act="equip"]');
        if (!b || b.disabled) return false;
        b.click(); return true;
      })()`);
      await sleep(500);
      if (done && want.id && want.slot) {
        const until=Date.now()+12000;
        while(Date.now()<until&&this.lastSave?.equip?.[want.slot]!==want.id)await sleep(400);
        if(this.lastSave?.equip?.[want.slot]===want.id)equipped++;else missed.push(name+' (awaiting save confirmation)');
      } else if(done)equipped++;else missed.push(name);
    }
    await this.closeGamePanel();
    return { equipped, missed };
  }

  /**
   * Claim every finished daily quest, plus the all-clear bonus.
   *
   * The three tasks are kill 50 monsters / submit 1 board job / kill 1 miniboss or boss, and the
   * fourth button is the all-complete bonus. Rewards scale with `floor((lv-1)/20)`: potions,
   * Guild Tokens, refine ore, and a Battle Manual + Copper.
   */
  async claimDailies() {
    const open = await this.openGamePanel('daily');
    if (!open || !open.ok) return { claimed: 0, reason: 'daily-not-open', open };
    await sleep(500);
    const before = await this.eval(`(() => Array.from(document.querySelectorAll('#pBody [data-daily]')).map(b => b.dataset.daily))()`);
    let claimed = 0;
    for (const i of (before || [])) {
      const hit = await this.eval(`(() => {
        const b = document.querySelector('#pBody [data-daily="' + ${JSON.stringify(String(i))} + '"]');
        if (!b || b.disabled) return false; b.click(); return true;
      })()`);
      if (hit) { claimed++; await sleep(500); }
    }
    await this.closeGamePanel();
    return { claimed, available: (before || []).length };
  }

  /**
   * Donate spare materials to the guild for GP.
   *
   * GP buys runes, and the runes are the single biggest flat power source in the game: ATK/MATK
   * +15%, MaxHP +20%, DEF +30 and −10% damage taken at max level. `matValue` decides what a
   * material is worth, and materials flagged `keep` are used for crafting/refining, so those are
   * left alone.
   */
  async donateToGuild({ dryRun } = {}) {
    return require('./runtime/guild-development').tick(this,{dryRun});
  }

  /**
   * Wear the strongest pet this character has unlocked.
   *
   * Pets are not bought: they unlock from the bestiary at `PET_UNLOCK` kills (boss 50, miniboss
   * 30, normal 500-3000 by monster level), and then fight for 3-8% of the owner's damage. The
   * collection panel lists them with `[data-pet]` buttons.
   */
  async wearBestPet() {
    return require('./runtime/active-pet').equip(this);
  }

  /**
   * Everything a town visit is for, in one pass: claim dailies, wear a pet, feed the guild, put
   * on upgrades, then sell / stash / buy.
   *
   * Each piece is wrapped so one failing step cannot stop the rest - a broken daily panel must
   * not cost the character its shop run.
   */
  async runTownChores() {
    if(GameInstance.maintenanceOwner && GameInstance.maintenanceOwner!==this)return [];
    GameInstance.maintenanceOwner=this;
    // choresBusy must cover the WHOLE pass - dailies through economy - so the recycler
    // defers a window that is mid-chores anywhere in it. The economy step is exactly
    // where a recycle hurt in the logs: it is several panel round trips of sell /
    // stash / buy, and losing it mid-flight wastes the pass and can leave a panel
    // stuck open. The clear lives in a finally so no failure path can leave the
    // window permanently exempt from recycling.
    this.choresBusy = true;
    try { return await this.choresPass(); } finally { this.choresBusy = false; if(GameInstance.maintenanceOwner===this)GameInstance.maintenanceOwner=null; }
  }

  async choresPass() {
    const did = [];
    const step = async (label, fn) => {
      try { const r = await fn(); if (r) did.push(r); }
      catch (e) { this.log(`${label} failed: ${e.message}`, 'warn'); }
    };

    await this.expeditionAuto(false);
    await step('tester', async () => { const r=await this.claimTester(); return r.length?'รับของทดสอบ: '+r.join(', '):null; });
    if(!require('./planning/capped-campaign').plan(this).active)await step('premium', async () => { const r=await this.managePremium();return r.length?'พรีเมียม: '+r.join(', '):null; });

    await step('daily', async () => {
      const d = await this.claimDailies();
      return d.claimed ? `daily x${d.claimed}` : null;
    });
    await step('pet', async () => {
      const p = await this.wearBestPet();
      return p.worn ? `pet ${p.pet}` : null;
    });
    let guildKeep = [];
    await step('equipment',async()=>{await this.recoverStoredUpgrades();const upgrades=await this.planBag(this.roster);if(upgrades.equip.length){const result=await this.equipItems(upgrades.equip);this.log('equipment upgrade: '+JSON.stringify(result));}});
    this.investmentPlan=require('./investment-plan').choose(this.lastSave||{},this.catalog(),economy.loadWiki(this.root),{campaignComplete:require('./planning/capped-campaign').plan(this).phase==='complete',reserved:require('./runtime/paid-actions').heldResources(this),...require('./runtime/craft-scope').investmentOptions(this)});
    const investment=this.investmentPlan.selected;
    this.onBrainReport?.('ลงทุนอุปกรณ์: '+(investment?investment.kind+' '+investment.name+' · ':'')+this.investmentPlan.reason);
    await step('craft', async () => {
      if(investment?.kind!=='craft')return null;
      const p = characterBrain.profile(this.lastSave || {}, this.catalog(), economy.loadWiki(this.root),{reserved:require('./runtime/paid-actions').heldResources(this),...require('./runtime/craft-scope').profileOptions(this)});
      if (!p.craft?.ready||p.craft.id!==investment.id) return null;
      const result = await this.craftAtExchange(p.craft.name,p.craft.type);
      this.equipmentMaintenanceStatus={at:Date.now(),kind:'craft',id:p.craft.id,name:p.craft.name,status:result.ok?'awaiting_outcome':'not_sent',reason:result.reason||'native craft dispatched; awaiting receipt'};
      await this.closeGamePanel();
      const observed=this.developmentLedger?.view().find(r=>r.kind==='craft'&&r.target?.name===p.craft.name&&['change_observed','server_confirmed'].includes(r.status)&&Date.now()-r.finishedAt<30000);
      if(observed){const upgrades=await this.planBag(this.roster);if(upgrades.equip.length)await this.equipItems(upgrades.equip);}
      return result.ok ? (observed?'craft change observed: ':'craft requested; awaiting evidence: ')+p.craft.name : null;
    });
    await step('refine', async () => {
      if(investment?.kind!=='refine')return null;
      const upgrades = await this.planBag(this.roster);
      if(upgrades.equip.length) await this.equipItems(upgrades.equip);
      const current=require('./investment-plan').choose(this.lastSave||{},this.catalog(),economy.loadWiki(this.root),{campaignComplete:require('./planning/capped-campaign').plan(this).phase==='complete',reserved:require('./runtime/paid-actions').heldResources(this),...require('./runtime/craft-scope').investmentOptions(this)}).selected;
      if(current?.kind!=='refine'||current.id!==investment.id)return null;
      const r = await this.refineEquipped({targetId:current.id,maxAttempts:1,extraReserveCoins:current.extraReserveCoins,reservedMaterials:current.reservedMaterials});
      return r.refined ? `refine attempted ${r.refined} time(s)` : null;
    });
    if(investment?.kind==='enchant')await step('enchant', async () => this.enchantWeapon());
    await step('guild', async () => {
      if(this.endgameCampaign?.phase&&this.endgameCampaign.phase!=='complete')return null;
      const g = await this.donateToGuild();
      guildKeep = g.keep || [];
      return g.donated ? `guild +${g.donated} material stack(s)` : null;
    });

    await step('economy', async () => {
      const plan = await this.planBag(this.roster);
      if (plan.equip.length) {
        const eq = await this.equipItems(plan.equip);
        if (eq.equipped) did.push(`equipped ${eq.equipped} upgrade(s)`);
      }
      // Donate first, then stash only the materials the guild refused (the crafting ones).
      // Stashing everything first is what starved the guild: stored materials never reach it.
      const ec = await this.runEconomy({ roster: this.roster, stashMaterials: [] });
      if (ec.sell && ec.sell.sold) did.push(`sold ${ec.sell.sold}`);
      if (ec.stash && (ec.stash.stashed || ec.stash.materials)) {
        did.push(`stashed ${ec.stash.stashed} gear + ${ec.stash.materials} material stack(s)`);
      }
      if (ec.buy && ec.buy.ok) did.push('bought a shop upgrade');
      if (ec.bagup && ec.bagup.ok) did.push('bag page bought');
      return null;
    });

    return did;
  }

  async enchantWeapon() {
    const policy=require('./enchant-plan'),cat=this.catalog();
    let p=policy.plan(this.lastSave||{},cat.items,cat.world,economy.loadWiki(this.root));
    this.enchantStatus={at:Date.now(),...p};
    if(!p.ready){this.onBrainReport?.('ออฟอาวุธ: '+p.reason);return null;}
    const opened=await this.openTownService('enchanter');if(!opened?.ok)return 'ออฟ: ยังเดินถึง NPC ไม่สำเร็จ';
    p=policy.plan(this.lastSave||{},cat.items,cat.world,economy.loadWiki(this.root));
    if(!p.ready||Date.now()-this.lastSaveAt>30000)return 'ออฟ: รอข้อมูลและงบล่าสุด';
    await this.eval(`(() => {const tab=document.querySelector('[data-en-tab="roll"]');if(tab)tab.click();const id=${JSON.stringify(p.id)};const b=Array.from(document.querySelectorAll('[data-en-w]')).find(b=>b.dataset.enW===id);if(b&&!b.classList.contains('on'))b.click();})()`);
    const prepared=await this.eval(`(() => {
      const locks=${JSON.stringify(p.locks)},expected=${JSON.stringify(p.expected)},id=${JSON.stringify(p.id)};
      const norm=s=>s.replace(/\u005cs/g,'');
      const rows=Array.from(document.querySelectorAll('#pBody .en-line .val'));
      if(document.querySelector('[data-en-w].on')?.dataset.enW!==id||rows.length!==3||rows.some((r,n)=>!norm(r.textContent).startsWith(norm(expected[n]))))return false;
      for(let n=0;n<3;n++){const b=document.querySelector('[data-en-lock="'+n+'"]');if(!b)return false;if(b.classList.contains('on')!==locks[n]){if(b.disabled)return false;b.click();}}
      const rune=document.querySelector('[data-en-rune]');if(${p.rune}&&!rune)return false;if(rune&&rune.checked!==${p.rune}){if(rune.disabled&&${p.rune})return false;rune.click();}
      return true;
    })()`);
    if(!prepared)return 'ออฟ: ข้อมูลหรือการล็อกไม่ตรงแผน หยุดก่อนสุ่ม';
    const before=this.lastSave,at=Date.now();
    const hit=await this.eval(`(() => {
      if(document.querySelector('[data-en-w].on')?.dataset.enW!==${JSON.stringify(p.id)})return false;
      const locks=${JSON.stringify(p.locks)};if(locks.some((v,n)=>document.querySelector('[data-en-lock="'+n+'"]')?.classList.contains('on')!==v))return false;
      const expected=${JSON.stringify(p.expected)},rows=Array.from(document.querySelectorAll('#pBody .en-line .val'));
      const norm=s=>s.replace(/\u005cs/g,'');if(rows.length!==3||rows.some((r,n)=>!norm(r.textContent).startsWith(norm(expected[n]))))return false;
      const balances=Array.from(document.querySelector('#pBody .ex-head')?.children||[]).map(e=>Number(e.textContent.replace(/[^0-9]/g,'')));
      const cost=${JSON.stringify(p.cost)};if(balances.length!==3||balances[0]<cost.dust||balances[1]<cost.tokens||cost.coins>Math.min(balances[2]-${p.reserve},Math.floor(balances[2]*.1)))return false;
      if(!!document.querySelector('[data-en-rune]')?.checked!==${p.rune})return false;
      const b=document.querySelector('[data-en-go]');if(!b||b.disabled||b.textContent.includes('ยืนยัน'))return false;b.click();return true;
    })()`);
    if(!hit)return 'ออฟ: ปุ่มไม่พร้อม ไม่ใช้ทรัพยากร';
    for(let n=0;n<20&&this.lastSaveAt<=at;n++)await sleep(500);
    const after=this.lastSave,confirmed=this.lastSaveAt>at&&after.equip?.weapon===p.id&&after.runeDust<=before.runeDust-p.cost.dust;
    const kept=confirmed&&p.locks.every((locked,n)=>!locked||JSON.stringify(after.weaponOpts?.[p.id]?.[n])===JSON.stringify(p.lines[n]));
    const reason=confirmed?(kept?'เกมบันทึกออฟใหม่ และแถวที่ล็อกยังอยู่ครบ':'ข้อมูลแถวที่ล็อกไม่ตรง หยุดตรวจสอบ'):'ส่งคำสั่งแล้ว ยังไม่พบเซฟยืนยัน จบรอบโดยไม่สุ่มซ้ำ';
    this.enchantStatus={at:Date.now(),weapon:p.name,reason,locks:p.locks,cost:p.cost,lines:confirmed?after.weaponOpts?.[p.id]:p.lines};
    this.onBrainReport?.('ออฟ '+p.name+': '+reason+(confirmed?' · '+(after.weaponOpts?.[p.id]||[]).map(policy.text).join(' / '):''));
    await this.closeGamePanel();return 'ออฟ: '+reason;
  }

  async prepareDungeon() {
    if(GameInstance.maintenanceOwner&&GameInstance.maintenanceOwner!==this)return {ready:false,reasons:['รอคิวเตรียมตัว']};
    GameInstance.maintenanceOwner=this;
    try {
      await this.expeditionAuto(false);
      await this.claimTester();
      let r=require('./team-readiness').check(this,await this.screen());
      if(r.hpPots<10)await this.restockPotions();
      if(r.mpPots<10)await this.restockPotions('Blue Potion',10);
      await this.manageMana(await this.screen(),true);
      const bag=await this.planBag(this.roster);if(bag.equip.length)await this.equipItems(bag.equip);
      await this.closeGamePanel();
      this.readiness=require('./team-readiness').check(this,await this.screen());
      this.onBrainReport?.('เตรียมลงดัน: '+(this.readiness.ready?'พร้อม':this.readiness.reasons.join(' · ')));
      return this.readiness;
    }finally{if(GameInstance.maintenanceOwner===this)GameInstance.maintenanceOwner=null;}
  }

  async teamDungeonTick() {
    if(!this.teamPeers||!this.canDo('teamTactics',5000))return;
    const decision=require('./team-readiness').tactics(this,this.teamPeers());
    if(this.outcomes&&!this.outcomes.allowed(decision.action))return;
    this.combatDecision={...decision,at:Date.now()};
    if(decision.action==='support'){
      const bar=require('./build').HOTBAR[this.lastSave?.job]||[];
      const choices=decision.skills.filter(id=>(this.lastSave?.skills?.[id]||0)>0&&bar.includes(id)).map(id=>({id,key:String(bar.indexOf(id)+1)}));
      const sent=await this.eval(`(() => {const options=${JSON.stringify(choices)};for(const o of options){const b=Array.from(document.querySelectorAll('#hotbar .slot')).find(b=>b.querySelector('.k')?.textContent===o.key);if(b&&!b.hidden&&!b.disabled&&!b.querySelector('.cdn')?.textContent.trim()&&Number(b.style.opacity||1)>=1){b.click();return o.id;}}return null;})()`);
      if(sent){const ally=this.teamPeers().find(i=>i.slot===decision.ally);this.outcomes?.begin('support',{hp:ally?.vitals?.hp},{slot:decision.ally,room:this.livePos?.room});}
      this.combatDecision.skill=sent;this.combatDecision.evidence=sent?'กดสกิลผ่านปุ่มเกม รอผล':'สกิลไม่พร้อม/ติดคูลดาวน์';
    }else if(decision.action==='retreat'){
      await this.expeditionAuto(false);
      await this.walkTo(decision.x,decision.z,{timeoutMs:1200,tolerance:6});
      this.teamRetreating=true;
      this.onBrainReport?.('ถอนตัวจากการโจมตี: '+decision.reason);
    }else if(decision.action==='regroup'){
      this.outcomes?.begin('regroup',{}, {x:decision.x,z:decision.z,room:this.livePos?.room});
      await this.expeditionAuto(false);await this.walkTo(decision.x,decision.z,{timeoutMs:1200,tolerance:6});await this.expeditionAuto(true);
    }else if(decision.action==='focus'&&this.canDo('teamTarget',30000)){
      if(this.teamRetreating){if(!(this.vitals?.hp>=.5))return;this.teamRetreating=false;await this.expeditionAuto(true);}
      await this.eval(`(() => {const toggle=document.getElementById('huntTargetBtn');if(!toggle)return false;toggle.click();const b=document.querySelector('[data-hunt-target="elite"]');if(b)b.click();else toggle.click();return !!b;})()`);
    }
    if(decision.action==='support'||decision.action==='regroup')this.onBrainReport?.('ร่วมต่อสู้: '+decision.reason+' · '+(this.combatDecision.evidence||'ขยับกลับเข้าระยะทีม'));
  }

  async claimTester() {
    const open=await this.openTownService('tester');if(!open?.ok)return [];
    const results=[];
    for(const action of ['supply','manual','heal']) {
      const hit=await this.eval(`(() => {const b=document.querySelector('#pBody [data-ts="${action}"]');if(!b||b.disabled)return false;b.click();return true;})()`);
      if(hit){results.push(action);await sleep(400);}
    }
    await this.closeGamePanel();
    this.onBrainReport?.('ผู้สนับสนุนเซิร์ฟทดสอบ: '+(results.join(', ')||'ยังไม่ถึงเวลารับ'));
    return results;
  }

  async manageMana(screen,preparing=false){
    if(!this.outcomes||screen.death||screen.panelOpen||!this.lastSaveAt||Date.now()-this.lastSaveAt>30000)return;
    const mp=require('./team-readiness').ratio(screen.mp);if(mp===null)return;
    const low=mp<((preparing||this.manaConserve)?0.6:0.3),s=this.lastSave;
    const mpSupply=require('./runtime/supply-recovery');
    for(const name of ['Blue Potion','Sapphire Potion','Starlight Potion'])mpSupply.manaBatch(this,name);
    this.manaStatus={at:Date.now(),mp,reason:low?'MP ต่ำ ตรวจยาและกันสกิลช่วยชีวิต':'MP เพียงพอ'};
    if(!low&&!this.manaConserve)return;
    if(!this.canDo('manaPolicy',30000))return;
    const items=[['Blue Potion',80,1],['Sapphire Potion',250,40],['Starlight Potion',600,70]].filter(([name,,lv])=>s.lv>=lv&&(s.consumables?.[name]||0)>0);
    const support=/priest|lumenoracle|seraph|inquisitor/.test(s.job||'');
    // Preserve the user's original disabled skills; modify only known damage skills temporarily.
    const skills=Object.keys(s.skills||{}).filter(id=>['holy_light','magnus','lumen_ray','choir_of_light','arcane_burst','fire_bolt','cold_bolt','thunderstorm','comet_spear','starfall_cascade','prism_nova'].includes(id));
    const conserve=low&&support;
    if((conserve||this.manaConserve)&&await this.openGamePanel('settings').then(r=>r.ok)){
      const disabled=this.manaDisabled ||= [];
      const result=await this.eval('('+require('./runtime/automation-settings').manaSkills.toString()+')('+JSON.stringify({conserve,skills,held:disabled})+')');
      this.manaDisabled=result.held;
      this.outcomes.data.manaDisabled=this.manaDisabled;this.outcomes.save();
      this.manaConserve=conserve||this.manaDisabled.length>0;await this.closeGamePanel();
    }
    if(!low)return;
    if(items.length&&this.outcomes.allowed('mana')){
      const max=Number(String(screen.mp).replace(/,/g,'').split('/')[1])||0,missing=max*(1-mp);
      const item=(items.find(([,amount])=>amount>=missing*.7)||items.at(-1))[0];
      const r=this.outcomes.begin('mana',{mp:s.mp,count:s.consumables[item]},{item});
      try{
        const open=await this.openGamePanel('bag');
        const sent=open.ok&&await this.eval(`(() => {const f=document.querySelector('#pBody [data-f="use"]');if(f)f.click();const tile=Array.from(document.querySelectorAll('#pBody .tile[data-k]')).find(b=>b.dataset.k===${JSON.stringify('c:'+item)});if(!tile)return false;tile.click();const use=document.querySelector('#itemPopBody [data-act="use"]');if(!use||use.disabled)return false;use.click();return true;})()`);
        if(!sent)this.outcomes.finish(r,'not_sent','ไม่พบปุ่มใช้ยาที่พร้อม');
        this.manaStatus.reason=sent?'ใช้ '+item+' · รอตรวจ MP และจำนวนยา':'รอปุ่มใช้ยา';
      }finally{await this.closeGamePanel();}
    }else if(!items.length){
      this.manaStatus.reason='ยา MP หมด · กันสกิลโจมตีของผู้สนับสนุน และเติมเมื่อกลับเมือง';
      const supply=require('./runtime/supply-recovery').manaChoice(this);
      if(!supply){this.manaStatus.reason='ยา MP หมด · ไม่มีรายการที่ซื้อได้โดยรักษาเงินสำรองหรือรายการเดิมยังไม่ชัด';return true;}
      if(/town/i.test(screen.loc||'')&&this.canDo('mpRestock',120000)){const batch=mpSupply.manaBatch(this,supply.name),result=await this.restockPotions(supply.name,batch.limit,{observedManaStock:batch.measured});this.manaStatus.supply={item:supply.name,batch,result};}
      else if(!preparing&&!/^(tw|dx)/.test(this.livePos?.room||s.mapId||'')&&!this.pendingTravel&&!this.teamControl&&!GameInstance.maintenanceOwner&&this.canDo('mpSupplyTrip',600000)){
        this.choresBusy=true;GameInstance.maintenanceOwner=this;
        try{await this.expeditionAuto(false);const home=await this.returnToTown();if(home.ok){const next=mpSupply.manaChoice(this);if(next){const batch=mpSupply.manaBatch(this,next.name),result=await this.restockPotions(next.name,batch.limit,{observedManaStock:batch.measured});this.manaStatus.supply={item:next.name,batch,result};this.manaStatus.reason=result.ok?'ยา MP '+next.name+' ยืนยันจำนวนแล้ว':'เติมยา MP ยังไม่สำเร็จ: '+(result.reason||result.skip||'รอผลเซฟ');}}}
        finally{await this.closeGamePanel().catch(()=>{});this.choresBusy=false;if(GameInstance.maintenanceOwner===this)GameInstance.maintenanceOwner=null;}
      }
    }
    return true;
  }

  async managePremium() {
    const notes=[];
    const fresh=async()=>{const at=Date.now();await this.socialSend('prq');await sleep(1000);const s=await this.socialLast('prem');return s?._receivedAt>=at?s:null;};
    let state=await fresh();if(!state||state.guest)return notes;
    for(const [key,cmd] of [['gift','prgift'],['quest','prquest']]){
      if(key==='gift'?state.gift>0:state.quest===2){
        const before=state.coins;await this.socialSend(cmd);const after=await fresh();
        if(!after)return notes;if(after.coins>before)notes.push('รับเหรียญ '+(after.coins-before));state=after;
      }
    }
    const {world}=this.catalog(),catalog=world?.PREMIUM||[];
    // Spend only the existing in-game wallet; no top-up or payment flow exists here.
    for(let n=0;n<4;n++){
      const role=this.lastSave?.job==='novice'?this.credentials?.job:this.lastSave?.job;
      const plan=require('./power-plan').premiumPlan(catalog,state,role,world);
      const item=plan.items[0];if(!item)break;
      if(!(state.owned||[]).includes(item.id)){
        if(item.cost>state.coins)break;
        await this.socialSend('prbuy',{id:item.id});state=await fresh();
        if(!state||!state.owned?.includes(item.id)){notes.push('ยังไม่ยืนยันการซื้อ '+item.name);break;}
      }
      await this.socialSend('prwear',{slot:item.slot,id:item.id});state=await fresh();
      if(!state||state.worn?.[item.slot]!==item.id){notes.push('ยังไม่ยืนยันการสวม '+item.name);break;}
      notes.push('สวม '+item.name);
    }
    this.powerStatus={at:Date.now(),premium:state?{coins:state.coins,worn:state.worn}:null,notes};
    if(notes.length)this.onBrainReport?.('พัฒนาอุปกรณ์พรีเมียม: '+notes.join(' · '));
    await this.closeGamePanel();return notes;
  }

  /**
   * One economy pass: sell what this class cannot use, stash what is worth keeping, buy the
   * best affordable upgrade, and buy a bag page when the bag is full.
   *
   * Only ever runs in town, because the shop and the storage are 3-D town services.
   */
  async runEconomy({ roster, dryRun, stashMaterials } = {}) {
    const { world, items } = this.catalog();
    const b = await this.belongings();
    const plan = await this.planBag(roster);
    const out = { plan: { equip: plan.equip.length, give: plan.give.length, store: plan.store.length, sell: plan.sell.length, sellCoins: plan.sellCoins } };

    if (dryRun) return { ...out, dryRun: true };

    if (plan.sell.length) {
      out.sell = await this.sellItems(plan.sell);
      this.log(`economy: sold ${out.sell.sold} item(s) for ~${plan.sellCoins.toLocaleString()} Copper`);
    }

    // Stash keepsakes once, and all raw materials - they have no use in the field and they are
    // what the guild runs on (matValue) and what the exchange merchant wants.
    // Which material stacks to put away. Default is all of them, but the caller can narrow it -
    // the guild wants everything it can turn into GP, and a material that has already been
    // stashed cannot be donated (personal storage is not the guild's list).
    const allMats = Object.keys(this.lastSave && this.lastSave.materials || {});
    const matNames = stashMaterials === undefined ? allMats : stashMaterials;
    if (plan.store.length || matNames.length) {
      out.stash = await this.stashItems(plan.store, matNames);
      this.log(`economy: stashed ${out.stash.stashed} gear + ${out.stash.materials} material stack(s)`);
    }

    // Bag full? A page is cheaper than losing loot.
    const tier=this.lastSave?.bagTier||0;
    const cap = world?.bagCap ? world.bagCap(tier) : null;
    const page = economy.nextBagPage(world, tier);
    if (page && Number.isFinite(cap) && b.bag.length >= cap - 2 && b.coins >= page.price) {
      out.bagup = await this.bagUpgrade();
      this.log(`economy: bag upgrade -> page ${page.page} (${page.price.toLocaleString()} Copper)`);
    }

    const fresh = await this.belongings();
    const personal = characterBrain.profile(this.lastSave || {}, {world,items}, economy.loadWiki(this.root));
    const ups = economy.shopUpgrades({ job: fresh.job, lv: fresh.lv, coins: Math.max(0,fresh.coins-personal.reserve), world, items })
      .filter(it => !personal.held.includes(it.id) && require('./gear-value').compare(this.lastSave||{},{world,items},it.id).upgrade);
    if (ups.length) {
      const best = ups[0];
      out.buy = await this.buyItem(best.id);
      this.log(`economy: best shop upgrade ${best.name} (${best.slot}, ${best.price.toLocaleString()} Copper, score ${best.score}) -> ${JSON.stringify(out.buy)}`);
    }
    return out;
  }



  // ---------------------------------------------------------------- automation config
  /**
   * Push the character's AUTO settings to values suited to unattended play, using the
   * game's own settings UI. These live in the server-side save, so this is a one-off
   * per character, not per boot.
   */
  async configureAutomation({recovery=false}={}) {
    const steps = [];
    const open = await this.eval(`(() => { ${H} return { opened: tap('#menu button[data-p="menu"]') }; })()`);
    await sleep(700);
    const applied = open.opened?await this.eval('('+require('./runtime/automation-settings').configure.toString()+')('+JSON.stringify({radius:this.roamRadius,potPct:recovery?90:this.potPct,potHand:true,offlineBot:this.offlineBot})+')'):{status:'settings_panel_not_open',expected:{}};
    this.automationSettings={at:Date.now(),...applied,confirmed:false};
    await sleep(400);
    await this.eval(`(() => { ${H} tap('#pClose'); })()`);
    await sleep(400);
    steps.push({ open, applied });
    this.log(`auto settings: radius=${this.roamRadius} potPct=${this.potPct} -> ${JSON.stringify(applied)}`);
    return steps;
  }

  huntAutoAllowed() {
    const room=require('./runtime/room-policy').currentRoom(this);
    // Town dummies are not farming targets, even during party gathering or
    // a recovery boot. Unknown room evidence cannot authorize combat either.
    if(!room||room==='town'||require('./runtime/room-policy').isGuildHall(room))return false;
    if(this.classBossProbeExitPending)return false;
    if(this.goal?.firstClear)return require('./runtime/class-boss-probe').combatAllowed(this);
    // Team/dungeon combat owns its own readiness and retreat policy.
    if(this.teamControl||require('./runtime/room-policy').roomPolicy(this.livePos?.room).dungeon)return true;
    if(Number.isFinite(this.vitals?.hp)&&this.vitals.hp<require('./runtime/survival').criticalHpRatio(this))return false;
    if(this.goal?.kind==='craft-wait'||this.survivalRecovery)return false;
    if(!this.teamControl&&!require('./runtime/room-policy').roomPolicy(this.livePos?.room).dungeon){
      if(!this.goal&&this.lastSave?.lv>=this.catalog().world?.MAX_LV)return false;
      if(this.goal?.kind!=='survival'&&require('./runtime/survival').recentDeaths(this).length)return false;
    }
    if(['craft-work','development-side','card-collection','campaign-side'].includes(this.goal?.kind)){
      const key=[this.catalog().build,this.goal.mapId,this.goal.monsterId].join(':');
      return !!this.goal.monsterId&&this.livePos?.room===this.goal.mapId&&this.managedHuntReady===key;
    }
    if(this.goal?.kind!=='survival')return true;
    const key=[this.catalog().build,this.goal.mapId,this.goal.monsterId].join(':');
    return this.goal.monsterKind==='normal'&&!!this.goal.monsterId&&this.livePos?.room===this.goal.mapId
      &&require('./runtime/freshness').fresh(this.livePos?.at,10000)
      // Entry is verified at 85% by survival.tick. Keep an established hunt
      // through ordinary damage; its 35% retreat gate owns recovery hysteresis.
      &&require('./runtime/freshness').fresh(this.vitals?.at,15000)&&this.vitals.hp>=.35
      &&require('./runtime/freshness').fresh(this.lastSaveAt,30000)&&this.survivalHuntReady===key;
  }

  /** Turn the client's own automation on: AUTO hunt + auto-quest. */
  async expeditionAuto(fight) {
    fight=!!fight&&this.huntAutoAllowed();
    return this.eval(`(() => {
      const p=document.getElementById('panel');if(p)p.hidden=true;
      const q=document.getElementById('qGo');if(q?.getAttribute('aria-pressed')==='true')q.click();
      const a=document.getElementById('autoBtn');if(a&&(a.getAttribute('aria-pressed')==='true')!==${!!fight})a.click();
      return true;
    })()`);
  }

  async enableAuto() {
    if(!this.huntAutoAllowed())return this.expeditionAuto(false);
    const questAllowed=!this.goal?.mapId&&!this.pendingTravel&&Date.now()>=(this.questNavBlockedUntil||0);
    const r = await this.eval(`(() => { ${H}
      const out = {};
      const ab = document.getElementById('autoBtn');
      if (ab) { if (ab.getAttribute('aria-pressed') !== 'true') ab.click(); out.auto = ab.getAttribute('aria-pressed'); }
      const q = document.getElementById('qGo');
      if (q) { if ((q.getAttribute('aria-pressed') === 'true') !== ${questAllowed}) q.click(); out.quest = q.getAttribute('aria-pressed'); }
      return out;
    })()`);
    return r;
  }

  /** Claim the 30-day login reward if it is available. */
  async claimLogin() {
    try {
      await this.eval(`(() => { ${H} tap('#menu button[data-p="login"]'); })()`);
      await sleep(800);
      const r = await this.eval(`(() => { ${H}
        const b = document.getElementById('loginClaim');
        if (!b) return 'no-button';
        if (b.disabled) return 'already-claimed';
        b.click(); return 'claimed';
      })()`);
      await sleep(700);
      // Closing is important: the client re-opens this panel on entry while the reward is
      // unclaimed, and a modal left open blocks the #qGo button's own close-and-toggle.
      await this.eval(`(() => { ${H} const p = document.getElementById('panel'); if (p) p.hidden = true; })()`);
      this.log(`login reward: ${r}`);
      return r;
    } catch (e) { return 'error: ' + e.message; }
  }

  /**
   * Travel to a hunting map using the game's own world map.
   *
   * This exists because the client's auto-quest can strand the character: the job-change
   * quest needs Job Lv 10, and when it cannot resolve a town gate to the hunting map it
   * calls setQuestNav(false) and gives up. The character then stands in town, where there
   * are no monsters, and earns nothing. The world map is the player-facing way out.
   *
   * Cards are rendered per selected region, so the map's pin is clicked first to switch
   * the region before looking for its "เดินทาง" (travel) button.
   */
  /**
   * Walk to a non-gate map the reliable way: hop by hop through the field gates, using the
   * keyboard walker. The world map's own travel ("GO") never actually moves the character out
   * of town (see walkTo's note), so every distant goal used to fail its confirm window, get
   * blocked for 30 minutes, and drop the character back on the training dummy. The map chain
   * (town -> w1 -> w2 -> ... ) with its gate coordinates is in the map catalog, so BFS it and
   * walk the gates. Falls back to whatever map the walk reached - the next attempt resumes
   * from there.
   */
  townGates() { return require('./runtime/native-gates').load(this); }

  async chainWalkTo(mapId, { assistanceKey = null } = {}) {
    const observed=require('./runtime/observed-routes'),identity=this.v2?.loadedSourceIdentity;
    if(!identity||this.v2?.sourceCoherence?.matches!==true)return false;
    const facts=observed.loadedRoutes(this.root,identity.build,identity),start=this.livePos?.room;
    if(!start||this.livePos.dead||!require('./runtime/gate-walk').freshRoom(this,start))return false;
    const path=observed.route(start,mapId,facts);
    if (!path) return false;
    const groupKey=assistanceKey||this.assistanceReservation?.assignment?.key;
    const groupContinues=(enteringBoss=false)=>{
      if(!groupKey)return true;
      const held=require('./runtime/assistance-reservation').state(this);
      return held?.assignment?.key===groupKey&&(!enteringBoss||!held.waiting);
    };

    this.log(`chain walk: ${start} -> ${mapId} via ${path.map(g=>g.target).join(' -> ')}`);
    let room = start;
    for (const gate of path) {
      const hop=gate.target;
      if(!groupContinues(hop===mapId))return false;
      if(groupKey&&!await require('./runtime/assistance-transit').check(this,groupKey))return false;
      if(this.v2?.loadedSourceIdentity!==identity||this.v2?.sourceCoherence?.matches!==true||this.livePos?.dead||!require('./runtime/gate-walk').freshRoom(this,room))return false;
      const r = await require('./runtime/gate-walk').cross(this,gate,{
        from:room,to:hop,timeoutMs: 150000,
        abort: async () => this.livePos?.room === hop && Date.now() - this.livePos.at < 8000 || !!groupKey&&(!groupContinues(hop===mapId)||!await require('./runtime/assistance-transit').check(this,groupKey)),
      });
      if(r?.reason==='dead'||r?.reason==='campaign-deadline')return false;
      await sleep(2500);
      room = require('./runtime/gate-walk').freshRoom(this,this.livePos?.room) ? this.livePos.room : room;
      if (room !== hop) { this.log(`chain walk: stalled at ${room}, expected ${hop}; reason=${r?.reason||'arrival-not-confirmed'}; gate=(${gate.x},${gate.z})`, 'warn'); return room === mapId; }
    }
    const ok = room === mapId && groupContinues(true) && this.v2?.loadedSourceIdentity===identity && this.v2?.sourceCoherence?.matches===true && !this.livePos?.dead && require('./runtime/gate-walk').freshRoom(this,mapId);
    if (ok) { this.brain.arrived(mapId); await this.enableAuto(); }
    return ok;
  }

  async travelTo(mapId) {
    await this.eval(`(() => { ${H} tap('#menu button[data-p="map"]'); })()`);
    await sleep(900);
    const pin = await this.eval(`(() => { ${H}
      const p = document.querySelector('[data-wm-pin="${mapId}"]');
      if (p) p.click();
      return !!p;
    })()`);
    await sleep(900);
    const res = await this.eval(`(() => { ${H}
      const go = document.querySelector('[data-wm-go="${mapId}"]');
      if (!go) return { ok: false, cards: $$('[data-wm-card]').map(c => c.dataset.wmCard) };
      go.click();
      return { ok: true };
    })()`);
    await sleep(600);
    await this.eval(`(() => { ${H} const p = document.getElementById('panel'); if (p) p.hidden = true; })()`);
    this.log(`travel -> ${mapId}: ${JSON.stringify({ pin, ...res })}`, res.ok ? 'info' : 'warn');
    return res.ok;
  }

  /**
   * Steer the character to a world coordinate by holding the game's own movement keys.
   *
   * Why not use the game's travel walker? It exists (`travelStep`), the world map offers it,
   * and it reports success - but in practice it never moves the character out of town, so
   * the town becomes a trap that ends all progress. Keyboard movement is the one mechanism
   * that is demonstrably reliable, so the controller drives it directly.
   *
   * The client swallows all keys while a panel is open, so panels are closed first.
   */
  async walkTo(tx, tz, { timeoutMs = 120000, tolerance = 1.5, label = '', abort = null } = {}) {
    await this.eval(`(() => { ${H}
      const p = document.getElementById('panel'); if (p) p.hidden = true;
      const a = document.activeElement; if (a && a.blur) a.blur();
      if(window.__afBoss)window.__afBoss.enabled=false;
    })()`);

    const deadline = Date.now() + timeoutMs;
    const movement = require('./runtime/movement-keys');
    const keys = movement.movementKeys(movement.pageMovementKeyboard(this));
    const set = (key, want) => keys.set(key, want);
    const releaseAll = () => keys.release();

    let best = Infinity, lastGain = Date.now(), sideUntil = 0, sideKey = null, iterations = 0;
    let abortAt = 0, newsAt = 0;
    try {
      while (Date.now() < deadline) {
        this.v2?.scheduler?.yieldOptionalNavigation?.();
        if(Date.now()>=newsAt){newsAt=Date.now()+3000;await require('./runtime/startup-news').dismissStartupNews(this);}
        if(await require('./runtime/capped-campaign').routeExpired(this)){await releaseAll();return {ok:false,reason:'campaign-deadline',pos:this.livePos,iterations};}
        // A gate warp can move the character somewhere else entirely; let the caller stop us
        // the moment the objective is met, instead of walking on toward a stale coordinate.
        if (abort && Date.now() >= abortAt) {
          abortAt = Date.now() + 1500;
          try { if (await abort()) { await releaseAll(); return { ok: true, reason: 'aborted', pos: this.livePos, iterations }; } } catch { }
        }
        const p = this.livePos;
        if (!p || Date.now() - p.at > 6000) { await sleep(500); continue; }
        if (p.dead) { await releaseAll(); return { ok:false, reason:'dead', pos:p, iterations }; }
        const dx = tx - p.x, dz = tz - p.z;
        const d = Math.hypot(dx, dz);
        iterations++;
        if (d <= tolerance) { await releaseAll(); return { ok: true, d, pos: p, iterations }; }

        if (d < best - 0.5) { best = d; lastGain = Date.now(); }
        else if (Date.now() - lastGain > 3000 && Date.now() > sideUntil) {
          // No progress: something is in the way. Sidestep perpendicular for a moment.
          sideKey = (sideKey === (Math.abs(dx) > Math.abs(dz) ? 'w' : 'a')) ? (Math.abs(dx) > Math.abs(dz) ? 's' : 'd')
            : (Math.abs(dx) > Math.abs(dz) ? 'w' : 'a');
          sideUntil = Date.now() + 1600;
          lastGain = Date.now();
          await releaseAll();
          await set(sideKey, true);
          await sleep(1600);
          await releaseAll();
          continue;
        }

        if (Date.now() < sideUntil) { await sleep(300); continue; }
        await set('a', dx < -1.0);
        await set('d', dx > 1.0);
        await set('w', dz < -1.0);
        await set('s', dz > 1.0);
        await sleep(400);
      }
      return { ok: false, reason: 'timeout', d: best, pos: this.livePos, iterations };
    } finally {
      await releaseAll();
    }
  }

  /**
   * Leave Asteria Town through the gate that leads to the hunting map.
   *
   * The gate coordinates are constants in the client (TOWN = {cx:160, cz:0}; each world-map
   * gate sits at a fixed offset). Walking within 1.6 units makes the game's own gateStep()
   * fire useGate(), which warps the character to the field.
   */
  async escapeTown() {
    const TOWN_GATES=this.townGates();
    // Follow the current goal through a reachable, non-blocked region gate.
    const lv = (this.lastSave && this.lastSave.lv) || 1;
    const lastField = this.lastSave && this.lastSave.mapId;
    const choice = chooseGate(TOWN_GATES, lv, this.goal?.mapId, this.brain.blocked());
    if (!choice) return false;
    const [key, gate] = choice;
    this.log(`walking out of town to the ${key} gate (${gate.label}) at (${gate.x}, ${gate.z}) `
      + `from ${JSON.stringify(this.livePos)} (lv ${lv}, was farming ${lastField || '?'})`);
    const r = await require('./runtime/gate-walk').cross(this,gate,{
      from:'town',to:key,timeoutMs: 150000,
      // Stop as soon as the gate fires and the location is no longer the town.
      abort: () => require('./runtime/gate-walk').freshRoom(this,key),
    });
    await sleep(2500);
    const s = await this.screen();
    const out = !/town/i.test(s.loc);
    this.log(`walk result: ${JSON.stringify(r)} -> loc=${s.loc} ${out ? '(left town)' : '(still in town)'}`, out ? 'info' : 'warn');
    if (out) await this.enableAuto();
    return out;
  }

  /**
   * Walk back into Asteria Town through the field's own "กลับเมือง Asteria" gate.
   *
   * Every field has that gate at `FIELD_GATES.home = (0, 40)` (read out of the client), and the
   * game's own gateStep() warps the character on arrival - the same mechanism escapeTown() uses
   * in reverse.
   *
   * This was a real gap: with no way back in, selling, storing, buying and the dungeon (dgstart
   * only works in town) could only ever happen when a death or a quest happened to deliver the
   * character to town. Everything the economy needs hangs off this one walk.
   */
  async returnToTown({ timeoutMs = 150000 } = {}) {
    const s0 = await this.screen();
    if (/town/i.test(s0.loc)) return { ok: true, already: true, loc: s0.loc };
    if (require('./runtime/room-policy').isGuildHall(this.livePos?.room)) {
      await this.closeGamePanel();
      await this.walkTo(-10, 17.5, { timeoutMs, tolerance: 1,
        abort: () => require('./runtime/gate-walk').freshRoom(this,'town') });
      await sleep(2500);
      const s = await this.screen();
      return { ok: /town/i.test(s.loc), loc: s.loc, route: 'guild-hall-exit' };
    }
    this.log(`walking back to town through the home gate at (0, 40) from ${JSON.stringify(this.livePos)}`);
    const r = await require('./runtime/gate-walk').cross(this,{x:0,z:40},{
      from:this.livePos?.room,to:'town',timeoutMs,
      abort: () => require('./runtime/gate-walk').freshRoom(this,'town'),
    });
    await sleep(2500);
    const s = await this.screen();
    const ok = /town/i.test(s.loc);
    this.log(`return-to-town: ${JSON.stringify(r)} -> loc=${s.loc} ${ok ? '(in town)' : '(still in the field)'}`, ok ? 'info' : 'warn');
    return { ok, loc: s.loc };
  }

  /**
   * Complete the class-change hand-off.
   *
   * Auto-quest deliberately walks to the Job Master at Job Lv 10, switches itself off and
   * opens the class picker, expecting a human. Left alone, every character parks there
   * forever. The picker is a two-step confirm: pick a class, then "เปลี่ยนเป็น X", then
   * "ยืนยัน" in the confirmation box.
   *
   * Default preference favours ranged classes: they kill from a distance, so an unattended
   * character takes far less damage and dies less often.
   */
  async chooseJob(prefsOverride) {
    const step1 = await this.eval(`(() => { ${H}
      // Do NOT require the jobMaster panel. The Lv-10 class change lives there, but the tier-2
      // PROMOTION is rendered inside the SKILLS panel (the #toJobs button sets showJobs and
      // re-renders skills), and it uses the very same .jc-pick / #jobGo / #jobYes controls.
      // Requiring 'jobMaster' is what made every promotion attempt return panel-not-open.
      if (!document.getElementById('pBody')) return { skip: 'no-panel' };
      const prefs = ${JSON.stringify(prefsOverride || this.jobPreference)};
      const avail = $$('.jc-pick').map(b => b.dataset.job);
      if (!avail.length) return { skip: 'no-picks' };
      const pick = prefs.find(j => avail.includes(j)) || avail[0];
      tap('.jc-pick[data-job="' + pick + '"]');
      return { pick, avail };
    })()`);
    if (step1.skip) return step1;
    await sleep(800);

    const step2 = await this.eval(`(() => { ${H}
      const b = document.getElementById('jobGo');
      if (!b) return 'no-go-button';
      if (b.disabled) return 'go-disabled';
      b.click(); return 'clicked';
    })()`);
    await sleep(800);

    const step3 = await this.eval(`(() => { ${H}
      const b = document.getElementById('jobYes');
      if (!b) return 'no-confirm-button';
      b.click(); return 'confirmed';
    })()`);
    await sleep(1000);
    await this.eval(`(() => { ${H} const p = document.getElementById('panel'); if (p) p.hidden = true; })()`);
    this.log(`class change: picked ${step1.pick} (available ${step1.avail.join(',')}) -> ${step2} -> ${step3}`);
    return { ...step1, go: step2, confirm: step3 };
  }

  /**
   * Advance the job to its tier-2 class (Vanguard -> Dawnwarden, and so on).
   *
   * This is NOT the same thing as the Lv 10 class change, and it is not reached by walking to the
   * Job Master: the client puts a "เลื่อนขั้น" button INSIDE the skills panel (`#toJobs`), shown
   * only when `canPromote()` is true - which the client defines as the class having a tier-2
   * form, jobLv at max (50) and level >= 60. The button then opens the job-master panel, whose
   * confirm is the same two-step flow chooseJob already drives.
   *
   * Every character in the team is Lv 72-80 at jobLv 50, so they are all eligible and were all
   * sitting on it: promotion is what unlocks the rest of the skill tree.
   */
  async advanceJob(prefOverride) {
    const job = (this.lastSave && this.lastSave.job) || 'novice';
    if(!require('./planning/progression-priority').assess(this.lastSave,this.catalog()).pet)return {ok:false,reason:'active-owned-pet-required'};
    const world = this.catalog().world || {};
    const promoted = prefOverride || economy.nextPromotion(job, world);
    if(!promoted)return {ok:false,reason:'no-next-class'};
    const high=!!world.HIGH_CLASSES?.[promoted];
    if(!this.lastSaveAt||Date.now()-this.lastSaveAt>30000||Date.now()-this.lastSaveAt < -5000)return {ok:false,reason:'fresh-save-required'};
    if(!high&&(this.lastSave.lv<60||this.lastSave.jobLv<50))return {ok:false,reason:'class-requirements-missing'};
    if(high){const a=world.ASCEND||{};const save=this.lastSave||{};
      if(!a.open||save.lv<a.lv||save.jobLv<a.jobLv||save.coins<a.coins
          ||Object.entries(a.items||{}).some(([name,n])=>(save.materials?.[name]||0)<n))return {ok:false,reason:'high-class-requirements-missing'};}
    const capacity=world.bagCap?.(this.lastSave.bagTier||0);
    if(Number.isFinite(capacity)&&Array.isArray(this.lastSave.bag)&&capacity-this.lastSave.bag.length<2)return {ok:false,reason:'promotion-bag-space-required',free:capacity-this.lastSave.bag.length,want:2};

    const open = await this.openGamePanel('skills');
    if (!open || !open.ok) return { ok: false, reason: 'skills-not-open', open };
    await sleep(700);
    const btn = await this.eval(`(() => {
      const b = document.getElementById('toJobs');
      if (!b) return { found: false };
      return { found: true, text: (b.innerText || '').trim(), ready:!!b.closest('.jobcta'), disabled:!!b.disabled };
    })()`);
    if (!btn.found) { await this.closeGamePanel(); return { ok: false, reason: 'no-toJobs-button', job }; }
    // The client puts ready actions inside .jobcta; translated button labels
    // are not readiness evidence. Preview-only actions are in .skmeta.
    if (!btn.ready || btn.disabled) {
      await this.closeGamePanel();
      return { ok: false, reason: 'not-ready', job, button: btn.text };
    }

    await this.eval(`(() => { const b = document.getElementById('toJobs'); if (b) b.click(); return true; })()`);
    await sleep(1400);
    let r;
    if(high){r=await this.eval(`(() => {const pick=document.querySelector('[data-hc="'+${JSON.stringify(promoted)}+'"]');if(!pick||pick.disabled)return {skip:'high-class-button-not-ready'};pick.click();const yes=document.getElementById('jobYes');if(!yes||yes.disabled)return {skip:'high-class-confirm-not-ready'};yes.click();return {sent:true};})()`);}
    else r=await this.chooseJob([promoted]);
    const until=Date.now()+12000;
    if(!r.skip)while(Date.now()<until&&this.lastSave?.job!==promoted)await sleep(400);
    this.log(`job advance: ${job} -> ${promoted || '?'} :: ${JSON.stringify(r)}`);
    return { ok: this.lastSave?.job===promoted, from: job, to: promoted, ...r };
  }

  /** Discover the server's chat command list (the game has a /cmd channel). */  async discoverCommands() {
    try {
      const r = await this.eval(`(() => { ${H}
        const inp = document.getElementById('sayInput');
        if (!inp) return 'no-input';
        inp.value = '/help';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const btn = document.getElementById('sayBtn');
        if (btn) { btn.click(); return 'sent'; }
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return 'enter';
      })()`);
      await sleep(1500);
      const s = await this.screen();
      return { sent: r, chatTail: s.chatTail };
    } catch (e) { return { error: e.message }; }
  }

  // ---------------------------------------------------------------- controller
  /**
   * Rate limiter. The game manages itself; the controller must only nudge it. Without a
   * cooldown, a corrective action that the game immediately undoes turns into a tight
   * loop that burns CPU and stalls progress.
   */
  canDo(key, ms) {
    const t = this.lastAction[key] || 0;
    if (Date.now() - t < ms) return false;
    this.lastAction[key] = Date.now();
    return true;
  }

  /**
   * One maintenance pass.
   *
   * Design rule: interfere as little as possible. The game already runs auto-hunt and
   * auto-quest; auto-quest legitimately switches AUTO hunt off while travelling and stops
   * itself at NPC hand-offs. A controller that "corrects" those states every few seconds
   * fights the game and makes things worse. So: act only on unambiguous failures (death,
   * out of game) and on genuine stalls, and never repeat an action inside its cooldown.
   */
  async tick() {
    let s;
    try {
      s = await this.screen();
      this.unresponsive = 0;
      this.lastFps = s.fps;          // frame rate is throughput: below 20 the game slows down
      this.lastHeapMB = s.heapMB;
    } catch (e) {
      this.unresponsive = (this.unresponsive || 0) + 1;
      this.status = 'unresponsive';
      if (this.unresponsive >= 3) {
        // The renderer froze. Throwing here would burn one of the slot's five spawn attempts
        // - on a machine that freezes a renderer every few minutes, five freezes killed the
        // slot for good (seen 12:55). A recycle re-launches the same window in place: no
        // re-login, no attempt consumed, and it works even while the renderer is hard-frozen
        // because the new context never touches the old one. If even the recycle fails, the
        // error still reaches spawn() and the old bounded-retry path takes over.
        this.unresponsive = 0;
        this.log('client unresponsive for 3 ticks -> recycling in place', 'warn');
        await this.recycle('renderer unresponsive').catch(err => {
          throw new Error('recycle after freeze failed: ' + err.message);
        });
        return 'recycled after freeze';
      }
      return 'unresponsive';
    }

    if (!s.inGame) {
      // A kick, an expired session or a dead page all land here.
      this.log(`out of game (startVisible=${s.startVisible}) -> reloading`, 'warn');
      await this.hardReload('out_of_game: landing screen or session disconnected');
      return 'recovered';
    }
    this.status = 'playing';
    await require('./registry/worker').settled(this);
    require('./observability/server-rankings').refreshRankings(this).catch(()=>{});
    if(s.panelOpen&&s.panelName==='news'&&await require('./runtime/startup-news').dismissStartupNews(this)){
      s.panelOpen=false;s.panelName=null;
    }
    if(require('./runtime/room-policy').currentRoom(this)==='town'&&s.autoOn==='true'){
      await this.expeditionAuto(false);s.autoOn='false';s.questOn='false';
      this.townCombatStatus={at:Date.now(),state:'suppressed',reason:'town dummy is not a farm target; retain verified departure plan'};
    }
    this.vitals=require('./team-readiness').vitals(s);
    this.readiness=require('./team-readiness').check(this,s);
    require('./runtime/ai-command').expire(this);
    if(this.runtimeV2 && require('./runtime/room-policy').roomPolicy(require('./runtime/room-policy').currentRoom(this)).dungeon){
      if(!this.teamRetreating&&(s.questOn==='true'||(!s.death&&s.autoOn!=='true')))await this.expeditionAuto(!s.death);
      if(!s.death)await this.teamDungeonTick();
      return s.death?'waiting for dungeon revive':'team dungeon combat';
    }
    this.outcomes?.observe({saveAt:this.lastSaveAt,mp:this.lastSave?.mp,consumables:this.lastSave?.consumables,pos:this.livePos,peers:this.teamPeers?.().map(i=>({slot:i.slot,hp:i.vitals?.hp,at:i.vitals?.at,room:i.livePos?.room}))});
    // AI commands are consumed inside this tick, never concurrently with game actions.
    if (this.aiPending && !s.panelOpen) {
      const command = this.aiPending;
      const aiGate=require('./runtime/ai-command');
      if(Object.hasOwn(characterBrain.FOCUSES,command.action)&&aiGate.ownerBusy(this)&&!aiGate.accept(command,this)){
        this.aiControl={id:command.id,actorId:this.actorIdentity?.actorId,build:this.catalog().build,action:command.action,at:Date.now(),expiresAt:command.expiresAt,state:'deferred',status:'วางแผนไว้แล้ว รอเจ้าของงานปัจจุบันจบก่อนตรวจและใช้',evidence:'intent_queued_owner_preserved_not_upgrade'};
      }else{
      this.aiPending = null;
      const rejected = aiGate.eligible(command, this);
      this.aiControl = { id: command.id, actorId:this.actorIdentity?.actorId, build:this.catalog().build, action: command.action, at: Date.now(), state:rejected?'rejected':'applying', status: rejected || 'กำลังดำเนินการ' };
      if (!rejected) {
        try {
          if (Object.hasOwn(characterBrain.FOCUSES,command.action)) {
            const p = characterBrain.profile(this.lastSave, this.catalog(), economy.loadWiki(this.root),{reserved:require('./runtime/paid-actions').heldResources(this),...require('./runtime/craft-scope').profileOptions(this)});
            if (!p.availableFocuses.includes(command.action)) throw Error('strategy no longer available');
            this.brain.setStrategy(command.action,command.reason,Date.now(),command.proposal?.stopRule?.maxActiveMs||900000,command.proposal||null,command.proposal?{mode:'operational',uncertainBaseline:require('./learning/strategy-scope').uncertainty(this)}:{});
          }
          this.teamGoal = null;
          this.goal = null;
          this.refreshGoal();
          if (command.action === 'recover') await require('./runtime/progression-actions').recover(this,s);
          this.aiActionAt = Date.now();
          this.aiControl.state='applied';
          this.aiControl.evidence='native_controller_strategy_applied_not_upgrade';
          this.aiControl.goal=this.goal?.label||null;
          this.aiControl.status = (characterBrain.FOCUSES[command.action] || 'ทบทวนเป้าหมายแล้ว') + (command.action === 'recover' ? ' และตรวจ AUTO' : '');
          this.log('AI: ' + this.aiControl.status);
          this.onBrainReport?.(this.aiControl.status + ' · ' + (this.goal?.label || 'รอเป้าหมาย'));
          return this.aiControl.status;
        } catch (e) { this.aiControl.state='failed';this.aiControl.status = 'ดำเนินการไม่สำเร็จ ใช้ระบบเดิมต่อ'; }
      }
      }
    }

    const progressionAction=await this.progressionTick?.(s);if(progressionAction)return progressionAction;
    const tradeAction=await require('./runtime/team-trade').tick(this,s);if(tradeAction)return tradeAction;

    if(!this.v3?.controller&&await this.farmGuardTick?.(s))return 'farm watchdog: ตรวจและแก้การฟาร์มเฉพาะตัว';
    require('./runtime/work-continuity').reconcileTravel(this);
    const townRepair=await require('./runtime/town-position-recovery').tick(this,s);if(townRepair)return townRepair;
    const priorityClass=await require('./runtime/promotion-priority').tick(this,s);if(priorityClass)return priorityClass;
    await require('./runtime/market-research').tick(this,s);
    const sale=await require('./runtime/market-sell').tick(this);if(sale)return 'bounded market: '+sale.status;
    const optionTrial=await require('./runtime/option-trials').tick(this);if(optionTrial)return 'bounded option trial: '+optionTrial.status;
    // Inventory maintenance and mana/town visits also precede the ordinary
    // campaign tick. Reserve here so a helper cannot start them mid-rendezvous.
    if(!s.death&&!this.teamControl&&!this.dailyTeamPending&&!this.dailyWorkStatus?.ownsNavigation&&!this.recycling&&!this.choresBusy&&!this.v2?.trial?.active()){
      const held=require('./runtime/assistance-reservation').state(this);
      if(held||require('./runtime/milestone-assistance').plan(this)?.due){
        const emergency=await require('./runtime/survival').tick(this,s);
        if(emergency){require('./runtime/assistance-reservation').release(this,'survival owns navigation');return emergency;}
        const reserved=await require('./runtime/milestone-assistance').tick(this,s);if(reserved)return reserved;
      }
    }
    // Preparing a real same-party class group also owns optional maintenance
    // while its tank/healer earns cash or refills. Discovery grants no boss
    // departure: survival handles only verified town supplies/safe normals.
    if(!s.death&&!s.panelOpen&&!this.teamControl&&!this.dailyTeamPending&&!this.dailyWorkStatus?.ownsNavigation&&!this.recycling&&!this.choresBusy&&!this.v2?.trial?.active()){
      const preparation=await require('./runtime/milestone-assistance').prepareTick(this,s);if(preparation)return preparation;
    }
    // Empty-slot inventory maintenance must not starve behind repeated mana trips.
    if(!s.death&&!s.panelOpen){const headroom=await require('./runtime/equipment-headroom').tick(this);if(headroom)return headroom;}
    if(this.outcomes&&!s.death){
      this.bossStatus=await this.eval(`(() => {const b=window.__afBoss;if(!b)return null;b.enabled=true;return {until:b.until,events:b.events.slice(0,5),lessons:b.lessons};})()`);
      if(this.bossStatus&&JSON.stringify(this.outcomes.data.bossLessons||{})!==JSON.stringify(this.bossStatus.lessons)){this.outcomes.data.bossLessons=this.bossStatus.lessons;this.outcomes.save();}
      if(this.bossStatus?.until>Date.now())return 'evading boss area';
      if(await this.manageMana(s)){
        s=await this.screen(); // A supply trip can change room, HP and ownership.
        this.vitals=require('./team-readiness').vitals(s);
        this.readiness=require('./team-readiness').check(this,s);
      }
    }

    // Guild dungeon: when a run is announced ('gd' frame) and nobody here is inside one,
    // join it - the whole team shares the guild, so this fires on every member machine.
    if (!this.activityAutomationPaused && !this.dailyActivitiesRequired && !this.endgameCampaign?.active && this.canDo('gdcheck', 30000)) {
      try {
        const gd = await this.socialLast('gd');
        if (gd && gd.run && gd.run.id && !/^(gd|tw|dx)/.test(this.livePos?.room || '')
            && !this.choresBusy && !this.recycling && !this.teamControl) {
          this.log(`guild dungeon: joining run ${gd.run.id}`);
          await this.guildDungeonJoin(gd.run.id);
        }
      } catch { }
    }

    // Instance combat/respawns belong to the game. Ordinary quest, travel, town
    // recovery and AI retargeting must not pull a character out of a team run.
    const instanceRoom = this.livePos && Date.now()-this.livePos.at<10000 ? this.livePos.room : this.lastSave?.mapId;
    if (/^(tw|dx|gd)/.test(instanceRoom || '')) {
      if (!this.teamRetreating && (s.questOn === 'true' || (!s.death && s.autoOn !== 'true'))) await this.expeditionAuto(!s.death);
      if(!s.death)await this.teamDungeonTick();
      return s.death ? 'waiting for dungeon revive' : 'team dungeon combat';
    }

    if(this.teamControl)return 'daily team activity owns navigation; waiting for coordinator';
    if(this.dailyTeamPending){
      // Required daily work reserves the actor before the six-member workflow starts.
      // Keep it available instead of starting another long farming/quest route.
      if(this.teamTradeIntent?.offer&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(this.teamTradeIntent.phase))return 'waiting for existing team trade before daily staging';
      await this.expeditionAuto(false);
      if(require('./runtime/room-policy').isGuildHall(this.livePos?.room))return 'daily quota pending; holding guild hall for six-member readiness';
      if(this.livePos?.room!=='town'){
        const home=await this.returnToTown();return home.ok?'daily staging: town confirmed':'daily staging: waiting for town';
      }
      if(this.canDo('dailyStagingPreparation',30000))await this.prepareDungeon();
      return 'daily quota pending; prepared in town while waiting for all six';
    }
    if(require('./runtime/room-policy').isGuildHall(this.livePos?.room)){await this.expeditionAuto(false);if(this.canDo('guildHallExit',30000)){const home=await this.returnToTown();return home.ok?'guild hall exit: town confirmed':'guild hall exit: waiting for town';}return 'waiting for guild hall exit';}

    // Scheduled renderer purge (see purgeMemory). Skipped while anything the recycler or the
    // team brain cares about is in flight - the purge itself is invisible to the game, but a
    // GC pause landing inside a chores pass would muddy exactly the evidence those passes log.
    if (this.purgeEveryMs > 0 && Date.now() >= (this.nextPurgeAt || 0)
        && !this.choresBusy && !this.recycling && !this.teamControl) {
      this.nextPurgeAt = Date.now() + this.purgeEveryMs;
      await this.purgeMemory('scheduled');
    }

    // 1. Death is unambiguous and cheap to fix.
    if (s.death) {
      if (!this.autoRespawn) return 'dead (autoRespawn off)';
      if (this.canDo('respawn', 4000)) {
        await this.eval(`(() => { ${H} tap('#respawnBtn'); })()`);
        this.pendingTravel = null;
        this.progressAt = Date.now();
        this.stuckCount = 0;
        this.log('died -> respawned in town', 'warn');
        return 'respawned';
      }
      return 'waiting to respawn';
    }

    // Shared assistance is checked before optional gear/pet/point/town chores.
    // Survival can always preempt it; a reservation never grants combat.
    const survivalAction=await require('./runtime/survival').tick(this,s);
    if(survivalAction){require('./runtime/assistance-reservation').release(this,'survival owns navigation');return survivalAction;}
    const assistanceAction=await require('./runtime/milestone-assistance').tick(this,s);
    if(assistanceAction)return assistanceAction;
    const firstClassAction=await require('./runtime/first-class').tick(this,s);
    if(firstClassAction)return firstClassAction;
    const bagAction=await require('./runtime/max-bag').tick(this,s);
    if(bagAction)return bagAction;
    // 4. Banked points are free power sitting unused. Spend them when no panel is in the way
    //    (the game re-renders these panels in place, so we drive them one at a time).
    if (this.autoBuild && !s.panelOpen && !this.pendingTravel && this.lastSave && this.vitals.hp>=.85 && this.v2?.sourceCoherence?.matches!==false && require('./runtime/freshness').decisionGate(this).allowed) {
      if (this.lastSave.pts > 0 && this.canDo('statPoints', 45000)) {
        const r = await this.spendStatPoints();
        if (!r.skip) return `raised ${r.raised} status point(s)`;
      }
      if (this.lastSave.skPts > 0 && this.canDo('skillPoints', 45000)) {
        const r = await this.spendSkillPoints();
        if (!r.skip) return `learned ${r.learned} skill level(s)`;
      }
    }

    const classProbeExit=await require('./runtime/class-boss-probe').exitTick(this);if(classProbeExit)return classProbeExit;
    const ownedGearAction=!GameInstance.maintenanceOwner?await require('./runtime/owned-gear').tick(this,s):null;
    if(ownedGearAction)return ownedGearAction;
    const petAction=this.vitals.hp>=.95&&require('./runtime/freshness').decisionGate(this).allowed?await require('./runtime/active-pet').tick(this,s):null;
    if(petAction)return petAction;
    // 2b. Job advancement (tier 2). The client only offers it from the SKILLS panel, and only
    //     once jobLv is at max and level >= 60 - so poll for that exact condition rather than
    //     guess. It is the gate on the rest of the skill tree, which is why it is checked every
    //     tick rather than on a town visit.
    const jb = this.lastSave && this.lastSave.job;
    // Tier-2 promotes at Lv 60; the hyper tier (2026-09-29 update) needs Lv 99 + Job 50.
    const world = this.catalog().world || {};
    const promoted = jb ? economy.nextPromotion(jb, world) : null;
    const needLv = jb && economy.BASE_TO_PROMOTED[jb] ? 60 : 99;
    const canPromote = promoted && (this.lastSave.jobLv || 0) >= 50 && (this.lastSave.lv || 0) >= needLv;
    if (require('./planning/progression-priority').assess(this.lastSave,this.catalog()).pet && canPromote && !s.panelOpen && this.vitals.hp>=.85 && this.v2?.sourceCoherence?.matches!==false && require('./runtime/freshness').decisionGate(this).allowed && !this.pendingTravel && this.autoAdvanceJob && this.canDo('advance', 120000)) {
      const r = await this.advanceJob();
      if (r.ok) return `job advanced ${r.from} -> ${r.to}`;
      if(r.reason==='promotion-bag-space-required'){
        const home=this.livePos?.room==='town'?{ok:true}:await this.returnToTown();
        const space=home.ok?await require('./runtime/wing-inventory').prepare(this,{minimum:2}):{ok:false,reason:'awaiting-town-for-promotion-space'};
        this.log('promotion bag preflight: '+JSON.stringify(space));
        if(space.ok){const retried=await this.advanceJob();if(retried.ok)return `job advanced ${retried.from} -> ${retried.to}`;}
        return 'job advance: preparing confirmed bag space';
      }
      if (r.reason && r.reason !== 'not-ready') return `job advance: ${r.reason}`;
    }

    const campaignAction=await require('./runtime/capped-campaign').tick(this,s);
    if(campaignAction)return campaignAction;
    // Fresh class/wing planning remains first; executable foundation upgrades
    // must not wait behind peer inspections and speculative gear ceilings.
    const nightTraining=require('./planning/night-training').view(this).active;
    const developmentAction=await require('./runtime/development-progress').tick(this,s,{townOnly:nightTraining});
    if(developmentAction)return developmentAction;
    const competitiveAction=nightTraining?null:await require('./observability/competitive-gear').tick(this,s);
    if(competitiveAction)return competitiveAction;
    const equipmentAction=nightTraining?null:await require('./runtime/equipment-ceiling').tick(this,s);
    if(equipmentAction)return equipmentAction;
    const mainQuestAction=nightTraining?null:await require('./runtime/main-quest').tick(this,s);
    if(mainQuestAction)return mainQuestAction;
    // Visit the free test supporter periodically, even when farming never returns to town.
    if(!nightTraining && this.autoChores && (!this.endgameCampaign?.active||this.endgameCampaign.phase==='complete') && !this.teamControl && !this.pendingTravel && !GameInstance.maintenanceOwner && this.lastSaveAt &&
       Date.now()-(this.lastSave?.testerManualAt||0)>=1800000 && this.canDo('powerVisit',900000)) {
      this.choresBusy=true;GameInstance.maintenanceOwner=this;
      try {
        await this.expeditionAuto(false);
        const home=await this.returnToTown();
        if(home.ok){const did=await this.choresPass();this.lastChore={at:new Date().toISOString(),did};return 'power progression: '+did.join(', ');}
      } finally {this.choresBusy=false;if(GameInstance.maintenanceOwner===this)GameInstance.maintenanceOwner=null;}
    }

    // 2. The class picker is a required human decision; make it for them.
    if (s.panelName === 'jobMaster' && s.panelOpen && this.canDo('job', 20000)) {
      const r = await this.chooseJob();
      if (!r.skip) return 'class chosen';
    }

    // 3. Auto-quest is the preferred driver, but ONLY toggle it when no panel is open:
    //    clicking #qGo with a panel open closes the panel *and* flips the toggle, which
    //    would switch auto-quest off when it was already on.
    //
    //    Auto-quest can also give up on its own: when it cannot find a route to the current
    //    objective it calls setQuestNav(false) and prints "ยังเดินทางไปที่หมายไม่ได้". It
    //    switches AUTO hunt off on the way, so the character is left standing still with
    //    nothing on. Re-enabling it blindly just loops. So: if it dies shortly after we
    //    enable it, stop trusting it for a while and hunt with plain AUTO instead.
    const boostAction=await require('./runtime/exp-boost').tick(this,s);
    if(boostAction)return boostAction;
    const trainingAction=await require('./runtime/level-training').tick(this,s);
    if(trainingAction)return trainingAction;
    const directorOwnsNavigation=!!(this.pendingTravel||this.goal?.mapId);
    if(directorOwnsNavigation&&s.questOn==='true'&&!s.panelOpen){await this.expeditionAuto(!this.pendingTravel&&!['survival','craft-wait'].includes(this.goal?.kind));return 'director owns navigation; stopped competing auto-quest';}
    if(directorOwnsNavigation&&!['survival','craft-wait'].includes(this.goal?.kind)&&!this.pendingTravel&&s.autoOn!=='true'&&!s.panelOpen&&this.huntAutoAllowed()&&this.canDo('auto',15000)){await this.expeditionAuto(true);return 'director AUTO hunt';}
    if (!directorOwnsNavigation&&s.questOn !== 'true' && this.questEnabledAt
      && Date.now() - this.questEnabledAt < 25000 && Date.now() >= this.questNavBlockedUntil) {
      this.questNavBlockedUntil = Date.now() + this.questNavBlockCooldown;
      this.log(`auto-quest gave up ${Math.round((Date.now() - this.questEnabledAt) / 1000)}s after being `
        + `enabled (cannot route to its objective) -> hunting with AUTO for `
        + `${Math.round(this.questNavBlockCooldown / 60000)} min`, 'warn');
    }

    if (!directorOwnsNavigation&&s.questOn === 'true' && Date.now() < this.questNavBlockedUntil && !s.panelOpen) {
      await this.eval(`(() => { ${H} tap('#qGo'); })()`);
      return 'พัก auto-quest ชั่วคราวตามข้อจำกัดการเดินทาง/ความปลอดภัย';
    }
    if (!directorOwnsNavigation&&s.questOn !== 'true' && !s.panelOpen) {
      if (Date.now() < this.questNavBlockedUntil) {
        if (s.autoOn !== 'true' && this.huntAutoAllowed() && this.canDo('auto', 15000)) {
          await this.expeditionAuto(true);
          return 'AUTO hunt (auto-quest cannot route)';
        }
      } else if (this.canDo('quest', 12000)) {
        await this.eval(`(() => { ${H} tap('#qGo'); })()`);
        this.questEnabledAt = Date.now();
        this.log(`auto-quest was off -> enabled (${s.lv}, ${s.loc})`);
        return 'auto-quest on';
      }
    }

    // 5. In town with a thin potion supply: top up before heading back out. The character
    //    passes through town often (deaths, quests), so this is where restocking belongs.
    const inTownNow = /town/i.test(s.loc);
    const restockAction=await require('./runtime/supply-recovery').townRestock(this,s);
    if(restockAction)return restockAction;

    // 6. Quest board: contracts complete themselves while hunting, so topping one up on a town
    //    visit is close to free income. Claim first (that is the payout), then accept the next.
    if (inTownNow && !s.panelOpen && this.autoQuestBoard && require('./runtime/work-continuity').optionalTownWorkAllowed(this) && this.canDo('board', 120000)) {
      const bq = this.lastSave && this.lastSave.boardQuest;
      const ready = bq && bq.goal > 0 && bq.count >= bq.goal;
      // A contract only counts kills on its own mapId, so one taken for a map the character
      // is no longer farming would sit at 0/8 forever. Drop it and take a fresh one.
      const wrongMap = bq && bq.mapId && this.goal?.mapId && bq.mapId !== this.goal.mapId;
      if (wrongMap && !ready) {
        const r = await this.workQuestBoard({ cancel: true });
        if (r.action === 'cancelled') return 'quest board: dropped a contract for the wrong map';
      } else if (ready || !bq) {
        const r = await this.workQuestBoard();
        if (!r.skip && r.action !== 'in-progress' && r.action !== 'no-contracts') {
          return `quest board: ${r.action}`;
        }
      }
    }

    // 7. Town chores: everything that needs a town service or a panel, done as ONE pass and
    //    throttled hard, because each of these opens a panel and some of them walk to an NPC.
    //    Every piece is idempotent, so doing it again when there is nothing to do costs a click.
    if (inTownNow && require('./runtime/work-continuity').optionalTownWorkAllowed(this) && (!this.endgameCampaign?.active||this.endgameCampaign.phase==='complete') && !s.panelOpen && this.autoChores && !GameInstance.maintenanceOwner && (this.canDo('chores', this.choresEveryMs)||(this.developmentProgress?.stage==='craft'&&Date.now()-this.developmentProgress.at<30000&&this.canDo('developmentCraftChores',120000)))) {
      const did = await this.runTownChores();
      this.lastChore = { at: new Date().toISOString(), did };
      if (did.length) return 'chores: ' + did.join(', ');
    }

    // 7b. The director: recompute what this character should hunt and why (refine ore, a
    //     near-unlock pet, wing materials, a reachable gear drop, or the frontier EXP map).
    //     In town with nothing queued, walk out to the goal map now instead of idling there.
    if (this.canDo('goal', this.goalEveryMs)) {
      try { this.refreshGoal(); } catch (e) { this.log('director: ' + e.message, 'warn'); }
    }
    if (this.pendingTravel) return 'director: waiting for travel confirmation';
    if (inTownNow && !s.panelOpen && this.goal?.mapId && !this.pendingTravel
      && this.canDo('travel', 45000)) {
      const target = this.goal.mapId;
      const TOWN_GATES=this.townGates();
      this.pendingTravel = { mapId: target, until: Date.now() + 180000 };
      // Direct region gates use the game's normal walking/warp mechanism.
      try {
        if (TOWN_GATES[target]) await this.escapeTown();
        else {const walked=await this.chainWalkTo(target);if(!walked&&!this.livePos?.dead&&!await require('./runtime/capped-campaign').routeExpired(this))await this.travelTo(target);}
      } finally {
        if (this.pendingTravel) this.pendingTravel.until = Date.now() +
          // A direct gate is one walk away - 45s is generous. A world-map destination hands
          // the character to the game's own multi-region walker, which needs minutes.
          (TOWN_GATES[target] ? 45000 : 180000);
      }
      return `director: travel requested -> ${target}`;
    }

    // 8. Stall ladder. Only reached when nothing has changed for a long time.
    //    In town there are no monsters at all, so "nothing will happen" is knowable much
    //    sooner - use a shorter threshold there and get the character back to a field.
    const inTown = inTownNow;
    const stallMs = inTown ? Math.min(this.stuckMs, this.townStuckMs) : this.stuckMs;
    if (this.progressAt && Date.now() - this.progressAt > stallMs) {
      const secs = Math.round(stallMs / 1000);
      const detail = `lv=${s.lv} ${s.loc} panel=${s.panelName || 'none'} qIdx=${this.lastSave ? this.lastSave.qIndex : '?'} questOn=${s.questOn} autoOn=${s.autoOn}`;
      this.stuckCount++;
      this.progressAt = Date.now();

      if (s.panelOpen && this.canDo('panel', 15000)) {
        // The game leaves a window open at quest hand-offs; closing it lets the walker resume.
        await this.eval(`(() => { ${H} tap('#pClose'); })()`);
        this.log(`no EXP for ${secs}s, closing panel (${s.panelName}) [${detail}]`, 'warn');
        return 'closed panel';
      }
      // Stranded in town: no monsters there, so nothing can progress. Walk out through the
      // world gate, then hand control back to the game's automation.
      if (inTown && this.canDo('travel', 45000)) {
        const out = await this.escapeTown();
        if (out) {
          this.log(`no EXP for ${secs}s stranded in town -> walked out to ${this.huntMap} [${detail}]`, 'warn');
          return 'escaped town';
        }
      }
      if (s.autoOn !== 'true' && this.canDo('auto', 20000)) {
        // Auto-quest is idle (quest line finished, or it cannot path): hunt instead.
        if(!this.huntAutoAllowed())return 'waiting for verified hunt target before AUTO fallback';
        await this.expeditionAuto(true);
        this.log(`no EXP for ${secs}s with AUTO off -> enabling AUTO hunt [${detail}]`, 'warn');
        return 'auto hunt fallback';
      }
      // Town has no EXP targets. Failed routing is not a disconnected client.
      if (inTown) {
        await this.expeditionAuto(false);
        this.stuckCount = 0;
        return 'town route blocked: waiting for a verified exit';
      }
      if (this.stuckCount >= 3 && this.canDo('yieldReplan', 300000)) {
        const map = this.livePos?.room || this.lastSave?.mapId;
        this.brain.block(map, 'ไม่มีผลตอบแทนหลังแก้การล่า 3 ครั้ง', 900000);
        this.goal = null;
        this.teamGoal = null;
        this.refreshGoal();
        this.continuityReason = {at:Date.now(),action:'replan',reason:'no yield; session recovery requires independent health evidence',map};
        this.log(`no yield after ${this.stuckCount} attempts -> replan without reloading [${detail}]`, 'warn');
        this.stuckCount = 0;
        await this.expeditionAuto(false);
        const home = await this.returnToTown();
        return home?.ok ? 'yield replan: returned to town' : 'yield replan: waiting for verified home route';
      }
      return 'stalled';
    }
    return 'ok';
  }

  /**
   * Close the browser and open a fresh one, then boot back into the world.
   *
   * A window's memory grows the longer it runs - the GPU process in particular was measured at
   * 200 MB on a fresh window and over 2.7 GB after a couple of minutes. Reloading the page does
   * not help (the browser process keeps its allocations); only closing the context releases
   * them. So a long unattended run needs to recycle windows, not just restart pages.
   */
  async recycle(reason = 'memory pressure') {
    if (this.recycling) return false;
    // Farm-wide spacing: a boot ladder is the heaviest CPU burst this farm produces, and
    // simultaneous ones reproduce the stall that caused them - three windows froze under
    // one global stall, all recycled at once, and three boot ladders invited the next
    // freeze. One ladder at a time and >=40s since the last one started, bounded so a
    // stuck recycle cannot block the queue forever.
    const waitUntil = Date.now() + 120000;
    while ((GameInstance.recyclingNow || Date.now() - (GameInstance.lastRecycleStartAt || 0) < 40000)
        && Date.now() < waitUntil) {
      await sleep(2000);
    }
    if(GameInstance.recyclingNow)return false;
    GameInstance.recyclingNow = true;
    GameInstance.lastRecycleStartAt = Date.now();
    this.recycling = true;
    this.log(`recycling this window (${reason})`);
    this.status = 'recycling';
    const ctx = this.ctx;
    this.page = null;
    try {
      if (ctx) await this.pool.release(ctx);
      this.ctx = null;
      await sleep(1000);                     // start only after old owned context closed
      await this.launch();
      await this.gotoAndBoot();
      await this.expeditionAuto(false); // Fresh tick owns target selection after recovery.
      this.status = 'playing';
      this.recycles = (this.recycles || 0) + 1;
      this.log(`recycled and back in the world (recycle #${this.recycles})`);
      return true;
    } catch (e) {
      this.log(`recycle failed: ${e.message}`, 'error');
      throw e;
    } finally {
      this.recycling = false;
      GameInstance.recyclingNow = false;
      // A recycled window comes back as a fresh context, so any chores pass that was
      // mid-flight is void. Clear the flag here too: evaluate() has no timeout, so a
      // pass hung on a frozen page would otherwise keep choresBusy true forever and
      // make this window permanently exempt from recycling.
      this.choresBusy = false;
    }
  }

  async hardReload(reason = 'client recovery') {
    this.lastReloadReason=reason;
    this.status = 'reloading';
    try {
      await this.page.reload({ waitUntil: 'commit', timeout: 120000 });
      await sleep(3000);
      await this.bootToGame(240000);
      await this.expeditionAuto(false); // Fresh tick owns target selection after reload.
      this.status = 'playing';
      this.log('recovered into the world');
    } catch (e) {
      this.log('reload failed: ' + e.message, 'error');
      throw e;
    }
  }

  /**
   * Quest board: accept a contract, or claim one that is finished.
   *
   * Contracts are kill/collect missions on the map the character is currently hunting, so the
   * client's own auto-hunt completes them as a side effect of normal farming — the board is
   * nearly free EXP, Job EXP, Copper and Guild Tokens. The board only counts progress on its
   * own mapId, so a contract accepted while the character is about to move on would stall;
   * `boardMap` resolves to the last field the character was on, which is where it returns.
   */
  async workQuestBoard({ cancel = false } = {}) {
    const r = await this.openTownService('questBoard');
    if (!r.ok) return { skip: 'could not reach the board: ' + r.reason };
    // Start the outcome window at dispatch, after walking to the NPC.
    if(this.lastSaveAt&&Date.now()-this.lastSaveAt<30000)this.questOutcomes?.begin(this.lastSave);

    const res = await this.eval(`(() => { ${H}
      const claim = document.querySelector('[data-claim-board]');
      if (claim && !claim.disabled) { claim.click(); return {action:'claimed'}; }
      if (${cancel ? 'true' : 'false'}) {
        const c = document.querySelector('[data-cancel-board]');
        if (c) { c.click(); return { action: 'cancelled' }; }
        return { action: 'nothing-to-cancel' };
      }
      if (claim) {
        if (claim.disabled) {
          const txt = ($('#pBody') && $('#pBody').innerText || '').split('\\n')[1] || '';
          return { action: 'in-progress', detail: txt.trim().slice(0, 60) };
        }
        claim.click();
        return { action: 'claimed' };
      }
      const acc = document.querySelectorAll('[data-accept-contract]');
      if (!acc.length) return { action: 'no-contracts' };
      // Mission 0 is the plain "kill x8 of a normal monster" contract: the auto-hunt clears it
      // without any change in behaviour, unlike the miniboss or material-collection variants.
      const labels = acc[0].closest('.shoprow').querySelector('.iname').textContent.trim();
      acc[0].click();
      return { action: 'accepted', label: labels };
    })()`);
    await sleep(700);
    await this.closePanel();
    if (res.action !== 'in-progress' && res.action !== 'no-contracts' && res.action !== 'nothing-to-cancel') {
      this.log(`quest board: ${JSON.stringify(res)}`);
    }
    return res;
  }

  // ---------------------------------------------------------------- town services
  /**
   * Open a town service panel (shop, storage, smith, quest board...) by walking to its NPC.
   *
   * These NPCs are 3-D objects: the client opens their panel when a pointerdown lands within
   * 58 px of the NPC's projected screen position, and only while the player is within 50 world
   * units of it. There is no DOM button for them.
   *
   * The camera sits at a fixed offset behind the player (13 units back, 11 up, fov 42°) and
   * looks at the player, so an NPC standing a couple of units *north* of the player projects
   * onto the screen's centre column, a little above centre. So: walk to just south of the NPC,
   * then scan a short vertical strip down the centre column until the expected panel appears.
   * Clicks that miss fall through to click-to-move, which is why the walk is re-anchored before
   * every attempt.
   */
  async openTownService(key) {
    const svc = TOWN_SERVICES[key];
    if (!svc) return { ok: false, reason: 'unknown service ' + key };
    const budget=require('./runtime/town-service-budget').townServiceBudget(this,key,svc);
    const entry=budget.check({position:false});if(!entry.ok)return entry;

    const already = await this.panelName();
    if (already === svc.panel) {const ready=budget.check();if(!ready.ok)return ready;await sleep(600);budget.opened();return { ok: true, panel: svc.panel, cached: true };}

    const anchor = { x: svc.x, z: svc.z + 2.6 };     // stand south of the NPC
    // Eight attempts must cover vertical positions, rather than exhausting the
    // budget on the first two scan rows. Keep the same bounded click count.
    const points = [[0,.34],[0,.42],[0,.26],[0,.50],[-26,.34],[26,.34],[0,.18],[0,.58]];

    for (let round = 0; round < 1; round++) {
      const available=budget.check({position:false});if(!available.ok)return available;
      const mapped=await require('./runtime/town-map-walk').walk(this,anchor.x,anchor.z,{timeoutMs:45000,tolerance:4});
      if(mapped&&!mapped.ok)return budget.fail(mapped.reason,true);
      if(!mapped)await this.walkTo(anchor.x, anchor.z, { timeoutMs: 20000, tolerance: 1.4 });
      const ready=budget.check();if(!ready.ok)return ready;
      await sleep(600);
      const projectionReady=budget.check();if(!projectionReady.ok)return projectionReady;
      const exact=await this.eval(`(() => {
        const point=window.__farmProjectPoint?.(${svc.x},${svc.y},${svc.z}),c=document.querySelector('canvas');
        if(!c||!point?.vis||![point.x,point.y].every(Number.isFinite)||point.x<0||point.y<0||point.x>innerWidth||point.y>innerHeight)return null;
        const opts={clientX:point.x,clientY:point.y,bubbles:true,cancelable:true,pointerType:'mouse',isPrimary:true,button:0,buttons:1};
        c.dispatchEvent(new PointerEvent('pointerdown',opts));c.dispatchEvent(new PointerEvent('pointerup',{...opts,buttons:0}));
        const p=document.getElementById('panel'),b=document.getElementById('pBody');return {open:!!p&&!p.hidden,panel:b?.dataset?.panel};
      })()`);
      if(exact?.open&&exact.panel===svc.panel){await sleep(600);budget.opened();return {ok:true,panel:svc.panel,projection:true};}
      if(exact?.open)await this.closePanel();
      for (const [dx,fy] of points) {
          const candidate=budget.check({click:true});if(!candidate.ok)return candidate;
          const r = await this.eval(`(() => { ${H}
            const c = document.querySelector('canvas');
            if (!c) return { panel: null };
            const W = innerWidth, H = innerHeight;
            const x = Math.round(W / 2 + ${dx}), y = Math.round(H * ${fy});
            const opts = { clientX: x, clientY: y, bubbles: true, cancelable: true,
                           pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
            c.dispatchEvent(new PointerEvent('pointerdown', opts));
            c.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
            const b = document.getElementById('pBody');
            const p = document.getElementById('panel');
            return { panel: (b && b.dataset) ? b.dataset.panel : null, open: !!(p && !p.hidden) };
          })()`);
          if (r.open) {
            if (r.panel === svc.panel) {
              this.log(`opened ${svc.label} (${svc.panel}) at ${dx},${fy.toFixed(2)}`);
              await sleep(600); // client capture guard ignores button clicks for 450ms after opening
              budget.opened();
              return { ok: true, panel: r.panel, at: { dx, fy } };
            }
            // Something else opened (a different NPC or a gate prompt): close it and keep looking.
            await this.eval(`(() => { ${H} const p = document.getElementById('panel'); if (p) p.hidden = true; })()`);
            await sleep(150);
          }
      }
      this.log(`could not open ${svc.label} in round ${round + 1}; re-anchoring`, 'warn');
    }
    return budget.fail('NPC acquisition click budget exceeded',true);
  }

  async panelName() {
    try {
      return await this.eval(`(() => {
        const b = document.getElementById('pBody'), p = document.getElementById('panel');
        return (p && !p.hidden && b && b.dataset) ? b.dataset.panel : null;
      })()`);
    } catch { return null; }
  }

  async closePanel() {
    try { await this.eval(`(() => { const p = document.getElementById('panel'); if (p) p.hidden = true; })()`); } catch { }
  }

  /**
   * Restock potions at the general store.
   *
   * Red Potions are the character's HP potions (auto-hunt drinks them with the R key) and the
   * one thing that reliably runs out: quests hand them out, but a long hunt drains them and a
   * character with none dies repeatedly. The shop's "สูงสุด" (max) button fills the quantity to
   * everything the purse can afford, then one click buys it.
   */
  async restockPotions(item='Red Potion',limit=20,options={}) {
    this.potionPurchaseDispatchAt=0;
    const before = (this.lastSave && this.lastSave.potions) || 0;
    const r = await this.openTownService('potionShop');
    if (!r.ok) return { skip: 'could not reach the shop: ' + r.reason };

    if(this.activePotionPurchase){
      await this.expeditionAuto(false);
      const flushAt=Date.now();
      const flushed=await this.eval('(async()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.kicked||n.fixed)return false;n.handlers.resave();await n.flush();return true;})()');
      if(!flushed)return {ok:false,reason:'native shop wallet flush unavailable'};
      for(let n=0;n<20&&this.lastSaveAt<=flushAt;n++)await sleep(250);
      if(this.lastSaveAt<=flushAt||this.livePos?.room!=='town')return {ok:false,reason:'fresh shop inventory baseline required'};
      if(this.activePotionPurchase.independentRestock){limit=Math.min(limit,Math.max(0,this.activePotionPurchase.independentRestock.minimum-require('./runtime/survival').hpPots(this.lastSave)));if(limit<1)return {ok:false,reason:'independent stock deficit already filled'};}
      this.v2.journal.purchaseDispatch(this.activePotionPurchase,this.lastSave,Date.now());
    }
    this.potionPurchaseDispatchAt=Date.now();
    const purchaseReserve=Math.max(Number.isFinite(options.reserveCoins)?options.reserveCoins:0,options.observedStock===true?require('./upgrade-reserve').reserve(this.lastSave||{},this.catalog().world):options.essential===true?1000:Math.max(1000,(this.lastSave?.lv||1)*100));
    const bought = await this.eval(`(() => { ${H}
      const row = Array.from(document.querySelectorAll('[data-row]')).find(r=>r.dataset.row===${JSON.stringify(item)});
      if (!row) return { skip: 'no Red Potion row' };
      const price=Number((row.querySelector('.imeta')?.textContent||'').match(/([0-9,]+) Copper/)?.[1]?.replace(/,/g,''));
      const budget=(${require('./runtime/potion-budget').potionBudget.toString()})({...${JSON.stringify({coins:this.lastSave?.coins||0,limit,reserve:purchaseReserve,observedStock:options.observedStock===true&&options.essential===true&&['Red Potion','Orange Potion','Yellow Potion','White Potion'].includes(item),observedManaStock:options.observedManaStock===true&&['Blue Potion','Sapphire Potion','Starlight Potion'].includes(item),essential:options.essential===true&&['Red Potion','Orange Potion','Yellow Potion','White Potion'].includes(item),have:require('./runtime/survival').hpPots(this.lastSave||{}),minimum:options.minimum??10})},price});
      if(!budget.qty)return {skip:budget.reason};
      const qty=budget.qty,input=row.querySelector('input');
      if(!input)return {skip:'no quantity input'};input.value=String(qty);input.dispatchEvent(new Event('input',{bubbles:true}));
      const btn = row.querySelector('[data-buy-consumable]');
      if (!btn) return { skip: 'no buy button' };
      if (btn.disabled) return { skip: 'cannot afford any' };
      const label = btn.textContent;
      btn.click();
      return { ok: true, label, quantity:qty, price, emergencySupply:budget.emergency };
    })()`);
    await sleep(500);
    await this.closePanel();
    this.log(`potion restock: ${JSON.stringify(bought)} (had ${before})`);
    return bought;
  }

  // ---------------------------------------------------------------- character build
  /**
   * Spend banked status points along the class's own recommended build.
   *
   * The weights come from the client's JOBS[job].bonus table (see scripts/gen-build.js), so
   * the allocation follows the game's design rather than a guess. Points are held while the
   * character is still a Wayfarer: a class change does NOT refund stats (only a paid reset
   * does), so spending before the class is chosen throws the build away.
   *
   * The clicks happen inside a single page.evaluate: raiseStat() -> paintStatus() updates the
   * buttons synchronously, so the whole loop runs without a round trip per point.
   */
  async spendStatPoints() {
    const job = this.lastSave && this.lastSave.job;
    const pts = (this.lastSave && this.lastSave.pts) || 0;
    if (pts <= 0) return { skip: 'no points' };
    const plan = require('./class-build').statPlan(this, job, pts, { ignoreNovice: this.holdPointsAsNovice });
    if (!plan.length) {
      return { skip: job === 'novice' ? 'banking points until a class is chosen' : `no weights for job ${job}` };
    }

    await this.eval(`(() => { ${H} tap('#menu button[data-p="character"]'); })()`);
    await sleep(700);
    const r = await this.eval('('+require('./runtime/free-points').stats.toString()+')('+JSON.stringify(plan)+')');
    await this.eval(`(() => { ${H} const p = document.getElementById('panel'); if (p) p.hidden = true; })()`);
    if (r.skip) return r;
    if (!r.raised) {
      // Points exist but nothing is affordable yet (stat costs step up every 20 points).
      // Stay quiet instead of logging a no-op every cooldown.
      return { skip: `nothing affordable (${r.left} point(s) banked)` };
    }
    this.log(`status points: raised ${r.raised} (${job}, ${r.left} left) -> ${JSON.stringify(this.catalog().jobs?.[job]?.bonus || {})}`);
    return r;
  }

  /**
   * Spend banked skill points along the class's learnable list.
   *
   * The list order is the client's own JOBS[job].skills order, which satisfies the skill
   * prerequisite graph (canLearn() also checks req, so a click can never break the build).
   * renderSkills() re-renders the whole panel after every learn, so the loop re-queries the
   * buttons each iteration and stops when nothing is learnable.
   */
  async spendSkillPoints() {
    const job = this.lastSave && this.lastSave.job;
    const skPts = (this.lastSave && this.lastSave.skPts) || 0;
    if (skPts <= 0) return { skip: 'no skill points' };
    const plan = require('./class-build').skillPlan(this, job, { preferHotbar: this.preferHotbarSkills });
    if (!plan.length) return { skip: `no skill list for job ${job}` };

    await this.eval(`(() => { ${H} tap('#menu button[data-p="skills"]'); })()`);
    await sleep(800);
    const r = await this.eval('('+require('./runtime/free-points').skills.toString()+')('+JSON.stringify(plan)+')');
    await this.eval(`(() => { ${H} const p = document.getElementById('panel'); if (p) p.hidden = true; })()`);
    if (r.skip) return r;
    if (!r.learned) return { skip: `nothing learnable yet (${r.left} point(s) banked)` };
    this.log(`skill points: learned ${r.learned} level(s) (${job}, ${r.left} left) -> ${JSON.stringify(r.got)}`);
    return r;
  }

  // ---------------------------------------------------------------- live preview
  /**
   * Grab one JPEG of this window, for the control panel's live tiles.
   *
   * In --nodraw mode the draw calls are suppressed, so we raise window.__allowDraw for a
   * few frames first: the canvas then holds a real, current image (the scene graph is
   * always up to date) and the cost is paid only for the frames around the capture.
   * The write is atomic so the panel never reads a half-written file.
   */
  async captureFrame(force = false) {
    if (!this.framesDir || !this.page || this.status === 'stopping') return false;
    const now = Date.now();
    if (!force && now - (this.frameAt || 0) < this.frameEveryMs) return false;
    this.frameAt = now;
    try {
      if (this.noDraw) {
        await this.eval('window.__allowDraw = true').catch(() => { });
        await sleep(220);                       // let a couple of frames actually draw
      }
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 62, timeout: 10000 });
      const file = path.join(this.framesDir, `slot-${String(this.slot).padStart(2, '0')}.jpg`);
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
      return true;
    } catch {
      return false;                             // busy or closing: skip this frame
    } finally {
      if (this.noDraw && this.page) {
        this.eval('window.__allowDraw = false').catch(() => { });
      }
    }
  }

  // ---------------------------------------------------------------- renderer memory
  /**
   * Force this renderer to hand back what it can (CDP).
   *
   * The game's JS heap stays small for the life of a window, so `performance.memory` cannot
   * explain the measured 1.6 -> 2.1GB per-window growth. That growth lives outside V8 - in
   * Blink caches and whatever the session accumulates - and this is the only lever available
   * from outside: collect unreachable objects and trim old chat nodes.
   * Avoid OOM intervention, which can discard the live game context.
   *
   * Either way the metrics before/after land in the farm log - if heap or DOM node counts
   * grow between purges, that names the leak; if they stay flat while the process still
   * grows, the growth is Blink-level and rotation remains the only reclaim.
   *
   * Returns the post-purge metrics, or null when nothing could be done (no page, dead
   * session). The supervisor also runs this farm-wide BEFORE an emergency recycle, because
   * a purge costs seconds where a recycle costs minutes and interrupts the window.
   */
  async purgeMemory(reason = 'scheduled', level = 'critical') {
    if (!this.ctx || !this.page || this.status !== 'playing') return null;
    // Every CDP send waits on the renderer's main thread - exactly what a frozen or
    // CPU-starved renderer cannot serve. Unlike evaluate(), which races the eval watchdog,
    // a raw cdp.send has NO timeout: a purge due while the machine is at its worst used to
    // wedge the control loop forever (slot 0, 11:58 - the window went silently dead). 20s
    // is many times any honest GC pause; past that the purge is a lost cause anyway.
    const bounded = (p, what) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${what} timed out`)), 20000);
      Promise.resolve(p).then(
        v => { clearTimeout(t); resolve(v); },
        e => { clearTimeout(t); reject(e); });
    });
    try {
      // Take a LOCAL handle. stop() and recycle() null this.cdp, and during boot churn they
      // can run mid-purge - reading this.cdp again after each await was a race that surfaced
      // as "purge failed: Cannot read properties of null". The session object itself stays
      // valid for as long as this page target lives; if the target died, the sends below
      // throw "Target closed", which is the honest failure.
      const cdp = this.cdp || await bounded(this.ctx.newCDPSession(this.page), 'newCDPSession');
      // getMetrics counters stay at zero until collection is turned on for this session.
      await bounded(cdp.send('Performance.enable'), 'Performance.enable').catch(() => { });
      if (!this.cdp) this.cdp = cdp;
      const read = async () => {
        const { metrics } = await bounded(cdp.send('Performance.getMetrics'), 'Performance.getMetrics');
        const m = {};
        for (const { name, value } of metrics) m[name] = value;
        return {
          heapMB: Math.round((m.JSHeapUsedSize || 0) / 1048576),
          committedMB: Math.round((m.JSHeapTotalSize || 0) / 1048576),
          nodes: m.Nodes || 0, listeners: m.JSEventListeners || 0,
        };
      };
      const before = await read();
      await bounded(cdp.send('HeapProfiler.collectGarbage'), 'collectGarbage').catch(() => { });
      // OOM intervention can destroy the live execution context. Collect only
      // unreachable objects; preserve the socket, world state and game workers.
      // The chat log only ever grows; keep the last screenful so the panel's chatTail read
      // still works. DOM nodes are V8 objects, so this mostly guards the heap, not Blink.
      await this.eval(`(() => { const c = document.getElementById('chat'); if (!c) return 0; let n = 0; while (c.children.length > 60) { c.removeChild(c.children[0]); n++; } return n; })()`).catch(() => 0);
      await sleep(1500);                       // pressure handling runs asynchronously
      const after = await read();
      this.lastPurge = { at: Date.now(), reason, level, mode: 'non-destructive-gc', ...after };
      this.log(`purge (${reason}): heap ${before.heapMB}->${after.heapMB}MB, committed ${before.committedMB}->${after.committedMB}MB, nodes ${before.nodes}->${after.nodes}`);
      return after;
    } catch (e) {
      this.cdp = null;                         // page gone or session dead - rebuild next time
      this.log(`purge failed: ${e.message}`, 'warn');
      return null;
    }
  }

  // ---------------------------------------------------------------- lifecycle
  async start() {
    this.startedAt = Date.now();
    await this.ensureAccount();
    await this.ensureCharacter();
    await require('./registry/worker').claim(this);
    await this.launch();
    await this.gotoAndBoot();
    await this.configureAutomation();
    await this.claimLogin();
    await this.expeditionAuto(false); // Fresh tick owns target selection after startup.
    this.status = 'playing';
    // First purge is due one full interval out, offset per slot so a six-window farm never
    // purges (and logs, and pauses for GC) all at the same minute.
    this.nextPurgeAt = Date.now() + this.purgeEveryMs + (this.slot % 10) * 45000;
    const s = await this.screen();
    this.log(`in world: ${s.lv} ${s.loc} | heap ${s.heapMB}MB`);
    return s;
  }

  /** Full unattended run: maintenance loop until stopped or unrecoverable. */
  async run({ tickMs = 5000, onStatus } = {}) {
    let next = 0;
    while (this.status !== 'stopping' && this.status !== 'stopped') {
      try {
        require('./runtime/work-continuity').inspect(this);
        await require('./runtime/paid-outcome-recovery').tick(this);
        if(this.pendingTravel)require('./runtime/work-continuity').travelMoving(this.pendingTravel,this.livePos);
        if(this.pendingResourceProfile&&!this.recycling&&this.status==='playing'&&!this.teamControl&&!this.fleetActivityBusy){
          const profile=this.pendingResourceProfile;this.pendingResourceProfile=null;
          try{this.resourceProfileApplied=await this.eval(`window.__setFarmResourceProfile?.({sceneSyncMs:${profile.sceneSyncMs},targetFps:${profile.targetFps}})===true`);}catch{this.resourceProfileApplied=false;}
        }
        if (!this.teamControl && Date.now() >= next) {
          next = Date.now() + (/^(tw|dx)/.test(this.livePos?.room||'')?tickMs:(this.adaptiveTickMs||tickMs));
          this.tickBusy = true;
          try { const r = await this.tick(); if (onStatus) onStatus(this, r); } finally { this.tickBusy = false; }
        }
        await this.captureFrame();
      } catch (e) {
        if(this.status==='stopping'||this.status==='stopped')return;
        // A freshness deadline expiring mid-route is not a crashed browser.
        // The rejected action has unwound; next tick's session watchdog owns
        // any sustained outage. Never clear pending payment evidence here.
        if(e.code==='ASTERIA_STALE_PRECONDITION'&&['fresh_save_required','fresh_position_required'].includes(e.reason)){
          this.continuityReason=e.reason;
          if(onStatus)onStatus(this,'awaiting fresh evidence: '+e.reason);
          next=Date.now()+tickMs;
          await sleep(1000);
          continue;
        }
        if(e.message==='optional navigation yielded to mandatory team activity'){
          this.log('optional route yielded; queued team activity owns navigation');
          next=Date.now()+tickMs;
          continue;
        }
        // A recycle closes the context out from under this loop, so an evaluate fails
        // mid-flight. That is the recycler working, not a dead slot: wait out the recycle
        // and keep going on the fresh browser. Re-throwing here made the supervisor respawn
        // the slot while the recycler was still relaunching it - two browsers on one
        // account, each kicking the other's session (the 6-window collapse on 2026-09-29).
        if (this.recycling) {
          this.log(`paused for recycle (${e.message})`, 'warn');
          while (this.recycling && this.status !== 'stopping') await sleep(1000);
          if (this.status === 'stopping') return;
          if (this.status !== 'playing') throw e;   // the recycle itself failed - let spawn handle it
          next = 0;                                 // tick at once on the fresh context
          continue;
        }
        this.log('controller error: ' + e.message, 'error');
        throw e;
      }
      await sleep(1000);
    }
  }

  /**
   * Recompute the hunting goal from the planners and the wiki, and aim the hunter at it.
   *
   * Runs on the tick's own rate limiter (goalEveryMs, 3 min). The planners are the SAME ones
   * the dashboard renders, so the hunter acts on exactly the numbers the player sees. The
   * chosen goal also re-aims this.huntMap, which the stranded-in-town recovery walks to.
   */
  refreshGoal() {
    const save = this.lastSave;
    if (!save || !save.lv) return;
    if(this.campaignGoal&&this.lastSaveAt&&Date.now()-this.lastSaveAt<30000){this.goal=this.campaignGoal;this.huntMap=this.goal.mapId;this.teamGoal=null;return;}
    // A team assignment (supervisor.assignTeamGoals) wins over this window's own preference:
    // 6 slots are 6 classes, and the team brain has already deduplicated their goals.
    const wiki = economy.loadWiki(this.root);
    if (!wiki || !wiki.maps) return;
    const survival=require('./runtime/survival').goal(this,wiki);
    this.survivalStatus=survival;
    if(survival?.goal){this.teamGoal=null;this.goal=survival.goal;this.huntMap=survival.goal.mapId;return;}
    const buildHash = this.buildHash || (this.cache?.dir?path.basename(this.cache.dir):economy.newestBuild(this.root));
    const cat = economy.loadCatalog(this.root, buildHash) || {};
    const reserved=require('./runtime/paid-actions').heldResources(this);
    const personal = characterBrain.profile(save, cat, wiki,{reserved,...require('./runtime/craft-scope').profileOptions(this)});
    personal.nightTraining=require('./planning/night-training').view(this);
    const nightGoal=require('./planning/night-training').select(this,wiki);
    if(nightGoal){this.personalBrain={milestones:personal.milestones,role:personal.role,progression:personal.progression,nightTraining:personal.nightTraining};this.goal=nightGoal;this.huntMap=nightGoal.mapId;this.teamGoal=null;return;}
    this.personalBrain = { milestones:personal.milestones, combatObjective:personal.combatObjective, role: personal.role, progression:personal.progression, reserve: personal.reserve, coins: personal.coins, lowFunds: personal.lowFunds, craft: personal.craft, gearTargets: personal.gear.slice(0,3), availableFocuses: personal.availableFocuses, strategy: this.brain.strategy(), recentDecisions: (this.brain.data.decisions || []).slice(0,3) };
    if (!personal.nightTraining.active && personal.milestones.equipmentAllowed && !(personal.progression.capped&&this.teamGoal?.kind==='exp') && !this.brain.strategy() && this.teamGoal && this.brain.allows(this.teamGoal.mapId) && Date.now() - (this.teamGoalAt || 0) < 360000) {
      const g = this.teamGoal;
      const changed = !this.goal || this.goal.label !== g.label || this.goal.mapId !== g.mapId;
      this.goal = g;
      if (g.mapId) this.huntMap = g.mapId;
      if (changed) this.log(`director: ${g.label} — ${g.reason}`);
      return;
    }
    let refine = null, wing = null, pets = [], gear = [];
    try {
      refine = economy.refinePlan({ equip: save.equip || [], refine: save.refine || {},
        materials: Object.fromEntries(Object.entries(save.materials||{}).map(([k,n])=>[k,Math.max(0,n-(reserved[k]||0))])), coins: Math.max(0,(save.coins||0)-(reserved.Copper||0)), items: cat.items || {}, world:cat.world, wiki });
      wing = economy.wingPlan({ job: save.job, materials: save.materials || {}, coins: save.coins || 0,
        lv: save.lv, world: cat.world, items: cat.items || {},
        wings: economy.loadWings(this.root, buildHash), recipes: wiki.crafting.recipes,
        held: economy.ownedNames(save) });
      pets = economy.petPlan({ bestiary: save.bestiary || {}, wiki });
      gear = personal.gear;
    } catch (e) { this.log('director planners: ' + e.message, 'warn'); }
    const g = (() => {
      // All goal types share the same per-map safety memory.
      const cands = director.goalCandidates(
        { lv: save.lv, job: save.job, coins: save.coins || 0, materials: save.materials || {},
          bestiary: save.bestiary || {}, mapId: save.mapId, equip: save.equip || [], refine: save.refine || {} },
        { wiki, catalog:cat, personal, ...require('./planning/progression-work').context(this), contextRecommendation: this.contextRecommendation?.(wiki), farmEvidence: this.v2?.farmEvidence, learningBuild: this.v2?.learningRevision, currentSave: save, focus: this.brain.strategy()?.action, learned: this.learning, blockedMaps: this.brain.blocked(), refinePlan: refine, pets, wingPlan: wing, gear });
      return cands[0] || null;
    })();
    if (!g) { this.goal = null; return; }
    const changed = !this.goal || this.goal.kind !== g.kind || this.goal.mapId !== g.mapId
      || this.goal.material !== g.material || this.goal.label !== g.label;
    this.goal = g;
    if (g.mapId) this.huntMap = g.mapId;
    if (changed) this.log(`director: ${g.label} — ${g.reason}`);
  }

  snapshot() {
    const s = this.lastSave || {};
    const snapshotAt=Date.now();
    if(s.equip&&this.lastSaveAt&&snapshotAt>=this.lastSaveAt&&snapshotAt-this.lastSaveAt<30000){
      const cat=this.catalog();
      if(!this.equipmentCeiling||snapshotAt-this.equipmentCeiling.at>=30000)this.equipmentCeiling=require('./planning/equipment-ceiling').assess(s,cat,economy.loadWiki(this.root));
      // Equipment-ceiling refreshes elsewhere must not starve the AI profile.
      const p=this.developmentProgress;
      if(!p||!p.personalBrain||!Number.isFinite(p.at)||snapshotAt<p.at||snapshotAt-p.at>=30000||p.build!==cat.build||p.personalBrain.actorId!==(this.actorIdentity?.actorId||null))this.developmentProgress=require('./planning/development-progress').view(this,snapshotAt);
    }
    return {
      slot: this.slot,
      researchPoll:this.researchPollStatus||null,buildLab:this.socialInbox?.buildLab?.view()||null,marketObservation:this.socialInbox?.market?.view()||null,marketResearch:this.marketResearchStatus||null,marketSell:this.marketSellStatus||null,optionTrial:this.optionTrialStatus||null,marketShadow:this.marketShadow?{...this.marketShadow,fresh:Number.isFinite(this.marketShadow.boardAt)&&Date.now()-this.marketShadow.boardAt>=0&&Date.now()-this.marketShadow.boardAt<=30000}:null,
      astral:this.socialInbox?.astral?.view()||null,astralObjective:this.astralObjective||null,astralQueryStatus:this.astralQueryStatus||null,
      observations:{clientSave:this.clientSaveObservation||null,serverReadback:this.serverSaveObservation||null,power:this.socialInbox?.power?.view()||null},
      identity:this.registryV32?.public(this.actorIdentity)||null,
      stageProfile:this.v2?.scheduler?.profiler?.view()||null,wholeCycle:this.wholeCycle||null,
      nativeBotConsole:{...this.nativeBotConsole,active:require('./runtime/native-bot-console').observedActive(this),readiness:require('./runtime/native-bot-console').readiness(this)},
      capabilityCoverage:this.v2?.capabilityRegistry||null,capabilityOutcomes:this.actorIdentity?require('./runtime/capability-evidence').outcomes(this):[],
      legacyMonetaryQuarantine:this.legacyMonetaryQuarantine||null,
      activityState:require('./planning/fleet-activity').publicActivity(this),
      workflowAck:this.workflowAck||null,
      activityDispatchResult:require('./planning/fleet-activity').publicDispatch(this),
      activityResult:this.activityEvidence?.data.rows.find(r=>r.runId&&(!this.fleetActivityIntent?.runId||r.runId===this.fleetActivityIntent.runId)&&['twreward','dgreward'].includes(r.type))||null,
      performance:{fps:this.lastFps??null,at:this.lastFpsAt||null},
      status: this.status,
      rendererHealth: this.rendererHealth||null,
      aiControl: this.aiControl || null,
      aiStrategyScope: {at:Date.now(),actorId:this.actorIdentity?.actorId||null,build:this.catalog().build,independent:require('./runtime/storage-payment-scope').independent(this,{action:'combat-gather'}),paymentAuthority:false},
      personalBrain: this.developmentProgress?.personalBrain || this.personalBrain || null,
      personalRouteMemory:this.actorIdentity?{actorId:this.actorIdentity.actorId,blocked:this.brain?.blocked()||{}}:null,
      outcomes:this.outcomes?.view()||null,manaStatus:this.manaStatus||null,bossStatus:this.bossStatus||null,classBossProbeStatus:this.classBossProbeStatus||null,promotionPriorityStatus:this.promotionPriorityStatus||null,assistanceTransitStatus:this.assistanceTransitStatus||null,milestoneAssistStatus:this.milestoneAssistStatus||null,milestonePreparationStatus:this.milestonePreparationStatus||null,gearImpact:this.gearImpact?.view()||null,
      developmentProgress:this.developmentProgress||null,equipmentCeiling:this.equipmentCeiling||null,investmentPlan:this.investmentPlan||null,questOutcomes:this.questOutcomes?.view()||null,
      readiness:this.readiness||null,combatDecision:this.combatDecision||null,
      survivalStatus:this.survivalStatus||null,
      survivalSupply:this.survivalSupply||null,
      townPositionRecovery:this.townPositionRecovery||null,
      hpPotions:require('./runtime/survival').hpPots(s),
      huntTargets:s.autoTargets??null,
      levelProgress:(this.levelProgress ||= new(require('./observability/level-progress').LevelProgress)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials.charName)).observe(this),
      levelTrainingStatus:this.levelTrainingStatus||null,
      expBoostStatus:this.expBoostStatus||null,
      bagDevelopment:this.bagDevelopment||null,
      storeTier:s.storeTier,storageUsed:Array.isArray(s.storage?.gear)?s.storage.gear.length:null,storageCapacity:this.catalog().world.storeCap?.(s.storeTier),
      equipmentMaintenanceStatus:this.equipmentMaintenanceStatus||null,
      serverRankings:this.serverRankings?.view()||null,
      competitiveGear:this.competitiveGear||null,activePetStatus:require('./runtime/active-pet').view(this),activePetPlan:this.activePetPlan||null,pets:s.pets||{},petActive:s.petActive||null,
      endgameCampaign:this.endgameCampaign?{...this.endgameCampaign,bossFeed:require('./runtime/boss-feed').view(this)}:null,mainQuest:this.mainQuest||null,
      teamTradeStatus:this.teamTradeStatus||null,
      development:this.developmentLedger?.view()||[],
      gearPower:this.gearPower||null,
      developmentPriority:this.developmentPriority||null,
      account: this.account ? this.account.username : null,
      char: this.character ? this.character.name : null,
      lv: s.lv, exp: s.exp, coins: s.coins, mapId: s.mapId,
      hp: s.hp, potions: s.potions,
      job: s.job, jobLv: s.jobLv,
      pts: s.pts, skPts: s.skPts,
      boardQuest: s.boardQuest ? `${s.boardQuest.count || 0}/${s.boardQuest.goal}` : null,
      tokens: s.tokens, runeDust: s.runeDust,
      st: s.st || null, skills: s.skills || null,
      lastSaveAgo: this.lastSaveAt ? Math.round((Date.now() - this.lastSaveAt) / 1000) : null,
      noProgressFor: this.progressAt ? Math.round((Date.now() - this.progressAt) / 1000) : null,
      fps: this.lastFps || 0,
      heapMB: this.lastHeapMB || 0,
      lastPurge: this.lastPurge || null,
      frameAt: this.frameAt || 0,
      stuck: this.stuckCount, errors: this.errors, recycles: this.recycles,
      choresBusy: !!this.choresBusy,           // the recycler defers this window while true
      powerStatus: this.powerStatus || null,
      freeRewards: this.freeRewards || null,
      automationSettings: this.automationSettings || null,
      enchantStatus: this.enchantStatus || null,
      lastRecycleAt: this.lastRecycleAt || null,
      upMin: this.startedAt ? +((Date.now() - this.startedAt) / 60000).toFixed(1) : 0,
      // What the game brain decided and what it has learned (for the dashboard).
      goal: this.goal ? { kind: this.goal.kind, mapId: this.goal.mapId, mapName: this.goal.mapName,monsterId:this.goal.monsterId,monsterKind:this.goal.monsterKind,nightTraining:!!this.goal.nightTraining,
        label: this.goal.label, reason: this.goal.reason } : null,
      learned: this.learning ? this.learning.summary() : null,
      // What the dashboard needs to compute this character's plan. Kept to the fields the
      // planners actually read so status.json does not balloon with the whole save.
      equip: s.equip || null,
      bag: s.bag || null,
      bagTier:s.bagTier||0,
      bagCapacity:this.catalog().world?.bagCap?.(s.bagTier||0)??null,
      refine: s.refine || null, stage:s.stage||null,plk:s.plk||null, holes:s.holes||null,sockets:s.sockets||null,cards:s.cards||null,weaponOpts:s.weaponOpts||null,drill:s.drill||null,
      materials: s.materials || null,
      bestiary: s.bestiary || null,
      lastChore: this.lastChore || null,
    };
  }

  async stop() {
    this.status = 'stopping';
    if (this.learning) { try { this.learning.save(true); } catch { } }
    if (this.cdp) { const s = this.cdp; this.cdp = null; try { await require('./runtime/bounded-close').boundedClose(()=>s.detach(),2000); } catch { } }
    const ctx = this.ctx;
    this.page = null;
    if (ctx) await this.pool.release(ctx);
    this.ctx = null;
    if(this.registryV32&&this.actorOwner)this.registryV32.store.stopOwner(this.actorOwner,{closed:true});
    await require('./registry/worker').close(this);
    this.status = 'stopped';
  }
}

require('./actions/advanced-adapters').installAdvancedAdapters(GameInstance);
module.exports = { GameInstance };

// Journal before invoking an action. A timeout leaves a durable pending entry;
// later saves reconcile it before another equipment-changing operation can run.
for(const [method,kind] of Object.entries({craftAtExchange:'craft',refineEquipped:'refine',equipItems:'equip',enchantWeapon:'enchant'})){
  const original=GameInstance.prototype[method];
  GameInstance.prototype[method]=async function(...args){
    if(!Number.isInteger(this.slot)||args[0]?.dryRun){if(this.activeResourceClaim?.tracked)this.v2.reservations.markDispatch(this.activeResourceClaim.id);return original.apply(this,args);}
    if(!this.lastSave||Date.now()-this.lastSaveAt>30000)return kind==='equip'?{equipped:0}:kind==='refine'?{refined:0,reservationNotSent:true}:kind==='craft'?{ok:false,reservationNotSent:true}:{reservationNotSent:true};
    const milestones=require('./planning/progression-priority').assess(this.lastSave,this.catalog());
    const prep=kind==='refine'&&args[0]?.guaranteedOnly===true?require('./runtime/development-progress').refineOpportunity(this):null;
    const milestonePrep=(prep?.classPreparation||prep?.wingPreparation)&&prep.guaranteed&&prep.id===args[0]?.targetId&&Object.entries(prep.reservedMaterials).every(([k,n])=>args[0]?.reservedMaterials?.[k]>=n)&&(!prep.wingPreparation||args[0]?.extraReserveCoins>=prep.extraReserveCoins);
    if(kind!=='equip'&&!milestonePrep&&!milestones.equipmentAllowed&&(kind!=='craft'||milestones.stage!=='wing'||this.catalog().items[Object.keys(this.catalog().items).find(id=>this.catalog().items[id].name===args[0])]?.slot!=='wing'))return {ok:false,refined:0,reservationNotSent:true,reason:milestones.reason};
    if(kind==='equip'){
      // One final swap per ledger entry. Recompute against the live loadout;
      // a bag-order plan can contain several intermediate swaps for one slot.
      const history=this.equipmentLedger ||=new(require('./result-ledger').ResultLedger)(this.actorStateRoot||this.root,'equipment-'+(this.actorIdentity?.actorId||(this.storageSlot??this.slot)));
      const cat=this.catalog(),choices=(args[0]||[]).filter(x=>x.id&&x.slot).map(x=>{const comparison=require('./gear-value').compare(this.lastSave,cat,x.id);return {want:{...x,slot:comparison.slot},comparison};}).filter(x=>x.comparison.upgrade&&(x.comparison.goalPromotion||!require('./runtime/accessory-swap').reversesRecentSwap(history,x.want.slot,x.want.id))).sort((a,b)=>require('./equipment-goal').priority(b.comparison)-require('./equipment-goal').priority(a.comparison));
      if(!choices.length)return {equipped:0,reason:'no fresh positive equipment swap'};
      args[0]=[choices[0].want];
    }
    // Free equipment swaps must not be blocked by an unresolved paid craft/enchant.
    // Paid attempts retain their own no-replay ledger and are never silently cleared.
    const ledger=kind==='equip'
      ? (this.equipmentLedger ||= new (require('./result-ledger').ResultLedger)(this.actorStateRoot||this.root,'equipment-'+(this.actorIdentity?.actorId||(this.storageSlot??this.slot))))
      : (this.developmentLedger ||= new (require('./result-ledger').ResultLedger)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||(this.storageSlot??this.slot)));
    const legacyTarget=kind==='craft'?require('./runtime/craft-scope').target(this,args[0]):args[0]?.targetId;
    const legacyUnknown=this.v2?.journal?.rows?.find(r=>r.externalOwner==='development-ledger'&&r.legacyIdentityUnknown&&r.kind===kind&&['STARTED','WAITING_CONFIRMATION','OBSERVED','UNCERTAIN'].includes(r.status)&&!require('./runtime/closed-gear-scope').independent(this,r,legacyTarget,kind));
    if(legacyUnknown&&kind!=='equip')return {ok:false,reservationNotSent:true,reason:'Legacy monetary outcome needs identity reconciliation; never replayed'};
    if(kind==='refine'&&args[0]?.targetId&&require('./runtime/refine-scope').blocks(this,args[0].targetId))return {ok:false,refined:0,reservationNotSent:true,reason:'Unknown refinement step or journal outcome; never replayed'};
    ledger.observe(this.lastSave,this.lastSaveAt);
    ledger.context={actorId:this.actorIdentity?.actorId,sessionStartedAt:this.bagSessionStartedAt,generation:this.socialInbox?.generation,build:this.catalog().build,baselineRev:this.acceptedSaveObservation?.rev??this.serverSaveObservation?.rev,loadoutSignature:require('./learning/completion-measurements').context(this.lastSave||{})};
    ledger.costCatalog=this.catalog();
    ledger.expectedCost=this.activeResourceClaim?this.v2?.reservations?.data.claims.find(c=>c.id===this.activeResourceClaim.id)?.cost:null;
    const target=kind==='enchant'?{id:this.lastSave.equip?.weapon}:kind==='craft'?{id:Object.values(this.catalog().items).find(i=>i.name===args[0])?.id,name:args[0]}:kind==='refine'?{id:args[0]?.targetId}:{equip:Object.fromEntries((args[0]||[]).filter(x=>x.id&&x.slot).map(x=>[x.slot,x.id]))};
    const freshRefineIntent=kind==='refine'?require('./runtime/fresh-refine-attempt').evidence(this,target.id):null;
    const attempt=ledger.begin(kind,target,this.lastSave,Date.now(),true,['refine','craft'].includes(kind));
    if(!attempt){this.onBrainReport?.('รอตรวจผลคำสั่งอุปกรณ์ก่อนหน้า ไม่ทำซ้ำ');return kind==='equip'?{equipped:0}:kind==='refine'?{refined:0,reservationNotSent:true}:kind==='craft'?{ok:false,reservationNotSent:true,reason:'previous craft outcome unresolved; no replay'}:{reservationNotSent:true};}
    if(freshRefineIntent){attempt.freshNativeIntent=freshRefineIntent;ledger.save();}
    const previousAttempt=this.activeDevelopmentAttempt;this.activeDevelopmentAttempt={id:attempt.id,kind};
    try{
      // Persist the exact ledger link before any native mutation. Restart can
      // reconcile this claim even if the adapter throws after sending.
      if(kind!=='equip'&&this.activeResourceClaim)this.v2.reservations.link(this.activeResourceClaim.id,attempt.id);
      if(kind!=='equip'&&this.activeResourceClaim?.tracked)this.v2.reservations.markDispatch(this.activeResourceClaim.id);
      const result=await original.apply(this,args);
      ledger.observe(this.lastSave,this.lastSaveAt);
      ledger.seal(attempt.id);
      const sent=kind==='craft'?result?.ok:kind==='refine'?result?.refined>0:kind==='equip'?result?.equipped>0:typeof result==='string'&&(result.includes('เกมบันทึก')||result.includes('ส่งคำสั่งแล้ว')||result.includes('แถวที่ล็อกไม่ตรง'));
      const unknownEquip=kind==='equip'&&result?.missed?.some(x=>x.includes('outcome-unknown'));
      const knownCraftNotSent=kind!=='craft'||result?.ok===false&&['exchange-not-open','craft-state-changed','exact-recipe-name-and-cost-not-listed','ambiguous-exact-recipe','native-recipe-disabled','insufficient unreserved resources','original craft outcome fenced; no replay'].includes(result.reason)||kind==='craft'&&attempt.dispatchTracking?.state==='preparing';
      if(!sent&&!unknownEquip&&knownCraftNotSent)ledger.cancel(attempt.id,result?.reason||(kind==='equip'?'No confirmed final upgrade; plan skipped or previous equipment restored':'ไม่มีคำสั่งเปลี่ยนอุปกรณ์ที่ยืนยันว่าส่ง'));
      if(ledger.pending(kind))for(let n=0;n<10&&ledger.pending(kind);n++){await sleep(500);ledger.observe(this.lastSave,this.lastSaveAt);}
      this.onBrainReport?.('ผลอุปกรณ์ '+kind+': '+attempt.status+' · หลักฐาน '+attempt.evidence);
      return result;
    }catch(e){ledger.cancelBeforeCraftDispatch(attempt.id,'Craft failed before the native payment evaluation');ledger.cancelBeforeRefineDispatch(attempt.id,'Refinement failed before the native payment evaluation');ledger.seal(attempt.id);this.onBrainReport?.('ผลอุปกรณ์ '+attempt.status+' · ไม่ส่งรายการผลไม่ชัดซ้ำ');throw e;}finally{this.activeDevelopmentAttempt=previousAttempt;}
  };
  GameInstance.prototype[method].paidDispatchTracked=true;
}
