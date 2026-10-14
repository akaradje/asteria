// run.js - CLI entry point for the farm.
//
//   node scripts/run.js --n=4                 run 4 windows
//   node scripts/run.js --n=6 --nodraw        skip WebGL draw calls (cheapest per window)
//   node scripts/run.js --n=2 --headed        watch them in real windows
//   node scripts/run.js --probe               boot one window, print state, exit
'use strict';

const path = require('path');
const fs = require('fs');
const { Supervisor } = require('../src/supervisor');
const { GameInstance } = require('../src/instance');
const { AssetCache } = require('../src/assetcache');
const { Team } = require('../src/team');
const api = require('../src/api');

const argv = require('../src/machine-config').loadMachineArgs();

const ROOT = path.resolve(__dirname, '..');
if(argv.federation&&!['windows','tum'].includes(argv.machine))throw Error('Federated run requires a known machine assignment');
if (argv.machine === 'tum') require('../machines/tum/runtime').installTumRuntime(GameInstance);
if (argv.machine === 'windows' && argv['runtime-v2']) require('../machines/windows/runtime').installWindowsRuntime(GameInstance);
if (argv['runtime-v2']) require('../src/runtime/v2-instance').installRuntimeV2(GameInstance);

// --h is the viewport HEIGHT, not a help alias. Treating it as one meant a farm sized
// with --h= printed this help and exited 0, which the panel saw as a crash-loop.
const wantsHelp = argv.help === true || (argv.h !== undefined && !/^\d+$/.test(String(argv.h)));
if (wantsHelp) {
  console.log(`
Asteria Online - autonomous multi-window player

  node scripts/run.js --probe [--secs=90]        one window, report, exit
  node scripts/run.js --n=4 [--nodraw]           run 4 windows unattended
  node scripts/run.js --n=2 --headed             watch them in real windows

  --n=            number of windows                    (default 1)
  --w= --h=       viewport                             (default 480x270)
                  --h is height, not help; use --help for this text
  --headed        show real windows
  --nodraw        skip WebGL draw calls - keeps FPS >= 20, recommended
  --no-audio      abort sound files before they are downloaded or decoded - a bot
                  has no ears, and decoded audio is a few hundred MB per window.
                  Opt-in: try it with a single-window probe first (a page whose
                  boot waited for a sound could stall).
  --keep-gpu      do not disable the GPU even with --nodraw
  --fps=          software-rendered frame cap per window   (default 30; 20 for a
                  6-window farm on a 4-core box - below 20 the game slows down)
  --full-chrome   use the full Chromium build instead of the headless shell
  --split-browsers  one browser (and GPU process) per window instead of one shared.
                  Costs ~350MB more per window, but stops six windows from queueing
                  behind a single saturated software GPU process.
  --recyclebelow= recycle a window when free RAM drops below this MB (default 1200)
  --no-frames     turn off the live preview frames the panel shows
  --frames        opt into preview images with --nodraw (uses more resources)
  --frameevery=   ms between preview frames per window   (default 1200)
  --radius=       AUTO hunt radius 8|16|28|120         (default 120)
  --potpct=       potion threshold 25|35|50|70         (default 50)
  --job=          class preference at the Job Lv 10 hand-off
  --no-build      do not spend status / skill points automatically
  --spend-novice  also spend points while still a Wayfarer (default: bank them)
  --hotbar-first  learn the action-bar skills before the rest of the list
  --no-restock    do not buy potions at the town shop when running low
  --restockbelow= buy when potions drop below this    (default 20)
  --team          require named accounts from team.json (error out if none exist)
  --huntmap=      field to walk to when stranded       (default w1)
  --stuck=        seconds without EXP in a field       (default 180)
  --townstuck=    seconds without EXP in town          (default 30)
  --minfree=      MB free needed to launch a window    (default 700)
  --windowcost=   MB one window is expected to cost    (default 1900)
  --criticalfree= MB free at which a window is shed    (default 350)
  --stagger=      seconds between launches             (default 12)
  --recyclegap=   seconds between recycles of one window (default 600)
  --rotate=       minutes between calm-time recycles of the oldest window
                  (default 20, 0 = off; god mode 15) — keeps windows from
                  ageing into their ~2.1GB steady state all at once
  --purge=        minutes between renderer memory purges per window (default 10,
                  0 = off). A purge makes Chromium hand back purgable caches
                  (decoded images, audio, layout scratch) without interrupting
                  the game; the RAM governor also purges farm-wide before it
                  will recycle or shed a window.
  --status=       seconds between status tables        (default 30)
  --god           the 6-window recycling preset (see PLAN-SOCIAL.md section 7)
  --no-party      do not put the live windows into one party
  --no-chores     do not run town chores (dailies, pets, guild, equip, sell/store/buy)
  --no-tower      do not open the Asteria Tower
  --choresevery=  seconds between town-chore passes   (default 600)
  --partyevery=   seconds between party re-checks      (default 45)
  --secs=         probe duration in seconds            (default 90)

Diagnostics:
  node scripts/probe-travel.js   trace the town-exit walk
  node scripts/probe-move.js     live movement trace off the state socket
`);
  process.exit(0);
}

const opts = {
  runtimeV2: !!argv['runtime-v2'],
  gameKnowledge: !!argv['game-knowledge'],
  root: ROOT,
  machine: argv.machine || null,
  fairRotation: !!argv['fair-rotation'],
  federation: !!argv.federation,
  gpuMemoryMb: +(argv['gpu-memory-mb']||0),
  softwareUi: !!argv['software-ui'],
  liteTextures: !!argv['lite-textures'],
  sceneSyncMs: +(argv['scene-sync-ms']||250),
  liteWorldArt: !!argv['lite-world-art'],
  serialBoot: !!argv['serial-boot'],
  activityAutomationPaused: !!argv['no-team-activities'],
  sharedGuild: argv['shared-guild'] ? require('../machines/expansion.json').guild : null,
  count: +(argv.n || argv.count || 1),
  width: +(argv.w || 480),
  height: +(argv.h || 270),
  headless: !argv.headed,
  noDraw: !!argv.nodraw,
  noGpu: !argv['keep-gpu'],
  noAudio: !!argv['no-audio'],
  targetFps: +(argv.fps || 30),
  splitBrowsers: !!argv['split-browsers'],
  fullChrome: !!argv['full-chrome'],
  roamRadius: +(argv.radius || 120),
  potPct: +(argv.potpct || 50),
  stuckMs: +(argv.stuck || 180) * 1000,
  townStuckMs: +(argv.townstuck || 30) * 1000,
  huntMap: argv.huntmap || 'w1',
  jobPreference: argv.job ? String(argv.job).split(',') : null,
  autoBuild: !argv['no-build'],
  holdPointsAsNovice: !argv['spend-novice'],
  preferHotbarSkills: !!argv['hotbar-first'],
  autoRestock: !argv['no-restock'],
  restockBelow: +(argv.restockbelow || 20),
  teamCredentials: {},
  frames: !argv['no-frames'] && (!argv.nodraw || !!argv.frames),
  frameEveryMs: +(argv.frameevery || 1200),
  minFreeMb: +(argv.minfree || 700),
  criticalFreeMb: +(argv.criticalfree || 350),
  windowCostMb: +(argv.windowcost || 1900),
  recycleBelowMb: +(argv.recyclebelow || 1200),
  // How long a window must wait before it may be recycled again. The 10-minute default is
  // fine for 3-4 windows; with 6 on a 16 GB box the cap has to bite far more often.
  recycleMinGapMs: +(argv.recyclegap || 600) * 1000,
  // Calm-time rotation (see supervisor.js). --rotate=0 turns it off.
  rotateEveryMs: argv.rotate === undefined ? 1200000 : Math.round(+(argv.rotate) * 60000),
  // Scheduled renderer purge (see instance.purgeMemory). --purge=0 turns it off.
  purgeEveryMs: argv.purge === undefined ? 600000 : Math.round(+(argv.purge) * 60000),
  launchStaggerMs: +(argv.stagger || 12) * 1000,
  statusEveryMs: +(argv.status || 30) * 1000,
  // Put every live window into one party (see PLAN-SOCIAL.md). A dungeon run needs it, and so
  // does shared EXP, so it is on by default and off with --no-party.
  party: !argv['no-party'],
  autoChores: !argv['no-chores'],
  tower: !argv['no-tower'],
  choresEveryMs: +(argv.choresevery || 600) * 1000,
  partyEveryMs: +(argv.partyevery || 45) * 1000,
};

// The saved fleet assignment is authoritative after a capacity migration,
// including when an older panel still has its original window count in memory.
const hostTeam=require('../src/planning/host-team-scope').team(ROOT,opts.machine);
if(hostTeam){opts.count=hostTeam.members.length;opts.federation=true;}
else if(opts.federation && opts.machine){
 const fleet=require('../src/federation').validate(JSON.parse(require('fs').readFileSync(require('path').join(ROOT,'machines/fleet.json'),'utf8')));
 opts.count=fleet.members.filter(m=>m.machine===opts.machine).length;
}

// --god: the six-window configuration that was measured to fit this machine. Six windows only
// work as a RECYCLING configuration - they fit at boot (~1.6GB each) but grow to ~2.1GB, which
// does not fit. Every value here is from the measurement in PLAN-SOCIAL.md section 7.
// It still needs WorkBuddy, browsers and the edge webviews closed to have the memory at all.
if (argv.god) {
  opts.noDraw = true;
  opts.frames = false;                    // the capture forces real WebGL draws under --nodraw
  opts.recycleBelowMb = +(argv.recyclebelow || 2600);
  opts.recycleMinGapMs = +(argv.recyclegap || 240) * 1000;   // 10 min default is far too slow
  // Six windows only hold if none of them grows old: rotate the oldest every 15 min.
  opts.rotateEveryMs = argv.rotate === undefined ? 900000 : opts.rotateEveryMs;
  opts.windowCostMb = +(argv.windowcost || 1500);
  opts.minFreeMb = +(argv.minfree || 400);
  if (!argv.n) opts.count = 6;
}

(async () => {
  const h = await api.health().catch(() => null);
  console.log(`server: ${h ? `ok, ${h.online} players online, build ${h.build}` : 'unreachable'}`);
  const release = await require('../src/runtime/fleet-client-release').prepare(ROOT,{health:h,log:message=>console.log(message)});
  const build = release?.build || (h && h.build) || 'unversioned';

  // A named team gives durable accounts that survive a reinstall and can be signed into by
  // hand. Without team.json the farm falls back to guests, which only live in a browser profile.
  const team = new Team(ROOT);
  if (team.members.length) {
    opts.teamCredentials = team.credentials();
    // Roster for item hand-offs: a drop this class cannot use may be exactly what a teammate
    // needs, and selling it for 20 Copper is the worst of the three options.
    opts.roster = team.members.map(m => ({ charName: m.charName, job: m.job }));
    if(opts.federation)opts.roster=(hostTeam||JSON.parse(fs.readFileSync(path.join(ROOT,'machines/fleet.json')))).members.map(m=>({charName:m.charName,job:m.baseJob}));
    console.log(`team: ${team.members.length} named account(s) from team.json`);
  } else if (argv.team) {
    console.error('--team was given but team.json has no members.');
    console.error('Create them first:  node scripts/make-team.js --n=6');
    process.exit(1);
  } else {
    console.log('team: none - using guest accounts (they live in the browser profile only)');
    console.log('      to make durable accounts:  node scripts/make-team.js --n=6');
  }

  if (argv.probe) {
    // Single-window probe: prove boot + automation + progression, then exit.
    const cache = new AssetCache(ROOT, build, { blockAudio: opts.noAudio, liteWorldArt:opts.liteWorldArt && opts.noDraw });
    const inst = new GameInstance({
      slot: 0, root: ROOT, width: opts.width, height: opts.height,
      headless: opts.headless, noDraw: opts.noDraw,
      roamRadius: opts.roamRadius, potPct: opts.potPct, huntMap: opts.huntMap,
      stuckMs: opts.stuckMs, townStuckMs: opts.townStuckMs,
      jobPreference: opts.jobPreference,
      credentials: opts.teamCredentials[0] || null,
      autoBuild: opts.autoBuild,
      holdPointsAsNovice: opts.holdPointsAsNovice,
      preferHotbarSkills: opts.preferHotbarSkills,
      autoRestock: opts.autoRestock,
      restockBelow: opts.restockBelow,
      framesDir: opts.frames ? path.join(ROOT, 'logs', 'frames') : null,
      frameEveryMs: opts.frameEveryMs,
      purgeEveryMs: opts.purgeEveryMs,
      cache,
      log: (m, l) => console.log(`${l === 'warn' ? '!' : l === 'error' ? 'x' : '-'} ${m}`),
    });
    const secs = +(argv.secs || 90);
    try {
      const s0 = await inst.start();
      const cmd = await inst.discoverCommands();
      console.log('chat /help ->', JSON.stringify(cmd));
      console.log(`playing ${secs}s ...`);
      const t0 = Date.now();
      while (Date.now() - t0 < secs * 1000) {
        const r = await inst.tick();
        if (r !== 'ok') console.log('tick:', r);
        await new Promise(r2 => setTimeout(r2, 5000));
      }
      const s1 = await inst.screen();
      console.log('\n--- before ---\n' + JSON.stringify(s0, null, 1));
      console.log('\n--- after ----\n' + JSON.stringify(s1, null, 1));
      console.log('\nsnapshot:', JSON.stringify(inst.snapshot(), null, 1));
      console.log('asset cache:', JSON.stringify(cache.stats()));
      if (inst.lastSave) console.log('last save:', JSON.stringify(inst.lastSave));
      const exp = inst.history.filter(x => x.lv === inst.lastSave?.lv);
      if (exp.length > 1) console.log(`EXP gained this run: ${exp[exp.length - 1].exp - exp[0].exp}`);
    } finally {
      await inst.stop();
    }
    return;
  }

  const sup = new Supervisor({ ...opts, build });
  await sup.run();
})().catch(e => { console.error('fatal:', e); process.exit(1); });
