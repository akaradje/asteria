// panel.js - the desktop control panel for the farm.
//
// A tiny local HTTP server (Node's own http module, no dependencies) that serves a single
// page and drives `scripts/run.js` as a child process. This is what the desktop icon opens.
//
//   node src/panel.js [--port=4711] [--no-open]
//
// Endpoints
//   GET  /             the panel
//   GET  /api/status   farm state, host memory, server health, per-window rows, cache stats
//   POST /api/start    { n, nodraw, headed, job, huntmap, radius, potpct, stuck, townstuck, minfree, stagger }
//   POST /api/stop     graceful stop (stop file first, hard kill as a fallback)
//   GET  /api/log      tail of the current run log
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const {terminateTree}=require('./runtime/process-tree');
const api = require('./api');
const economy = require('./economy');
const { Team } = require('./team');
const { mapCatalog } = require('./team-map');
const { summary: reportSummary, loadExpTable } = require('./reports');
const MAP_CATALOG = mapCatalog(require('../data/wiki.json'));

const ROOT = path.resolve(__dirname, '..');
const { Advisor } = require('./ai-advisor');
let advisor = new Advisor(ROOT);
const argv = require('./machine-config').loadMachineArgs();
const PORT = +(argv.port || process.env.PANEL_PORT || 4711);
// Bumped whenever the served page changes, so a stale panel left on the port is detectable.
const PANEL_VERSION = '15';

// Optional password for the panel itself. Without it the panel is open to anything that can
// reach the port - which is fine on 127.0.0.1 and not fine if you bind to the network.
const PANEL_PASSWORD = String(argv.password || process.env.PANEL_PASSWORD || '');
const HOST = String(argv.host || process.env.PANEL_HOST || '127.0.0.1');
const controlSecurity=require('./runtime/panel-security').create({host:HOST,port:PORT,password:PANEL_PASSWORD});
const sessions = new Set();                    // valid session ids, in memory only

function cookieOf(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const isAuthed = req => !PANEL_PASSWORD || sessions.has(cookieOf(req, 'af_sid'));
const STOP_FILE = path.join(ROOT, 'logs', '.stop');

// Self-healing switches. --no-autorestart disables both.
const AUTO_RESTART = argv['no-autorestart'] !== true;
const HUNG_AFTER_MS = 4 * 60 * 1000;           // status.json is written every 30s, so 4 min is dead
let autoRestart = AUTO_RESTART;
const LOG_DIR = path.join(ROOT, 'logs');
const STATUS_FILE = path.join(LOG_DIR, 'status.json');

let child = null;
let startedAt = 0;
let lastOptions = null;
let lastError = null;
let stopping = false;
let controlRevision=0,clientRefreshBusy=false,stopTask=null,watchdogBusy=false;
const refreshFile=path.join(LOG_DIR,'client-refresh.json');
let refreshState;try{refreshState=JSON.parse(fs.readFileSync(refreshFile,'utf8'));}catch{}
const clientRefresh=new(require('./runtime/client-refresh').ClientRefresh)(refreshState);
function saveClientRefresh(){try{require('./runtime/telemetry-file').writeTelemetry(refreshFile,clientRefresh.view());}catch(e){console.error('client refresh diagnostic:',e.code||e.name);}}
async function clientRefreshTick(){
 if(clientRefreshBusy||systemRecovery.busy||!child||stopping||!autoRestart||(!argv.federation&&argv.machine!=='vps'))return;
 clientRefreshBusy=true;
 try{
  const proc=child,revision=controlRevision;
  let health,healthError;try{health=await api.health();}catch(e){healthError=e;}
  if(child!==proc||stopping||controlRevision!==revision)return;
  if(!healthError&&health?.ok)systemRecovery.observeServerHealth(health);
  let snapshot,telemetry;try{snapshot=JSON.parse(fs.readFileSync(STATUS_FILE));}catch{}
  try{telemetry=JSON.parse(fs.readFileSync(path.join(LOG_DIR,'fleet/local.json')));}catch{}
  if(healthError||!health){health=require('./runtime/client-refresh').healthFromKnowledge(snapshot,{startedAt})||{ok:false};}
  clientRefresh.state.healthEvidence=health.evidence||'direct_server_health';clientRefresh.state.healthObservedAt=health.observedAt||Date.now();
  const loaded=require('./runtime/client-refresh').loadedBuild(snapshot,telemetry,{machine:argv.machine,startedAt});
  const plan=clientRefresh.inspect(health,snapshot,loaded,{running:!!child&&!stopping,enabled:autoRestart,startedAt,rolling:true});saveClientRefresh();
  if(plan.action!=='refresh')return;
  const approval=require('./runtime/client-refresh').applicationApproval(ROOT);
  if(!approval.allowed)return;
  const semantic=require('./runtime/semantic-release').inspect(ROOT,plan.build);if(!semantic.autoApproved)return;
  if(child!==proc||stopping||controlRevision!==revision)return;
  clientRefresh.attempt(plan.build);proc.send({type:'semantic-client-refresh',build:plan.build,sourceRevision:approval.sourceRevision});
  clientRefresh.record('rolling-requested',{build:plan.build,reason:'one owned idle actor at a time; farm/controller retained'});saveClientRefresh();
 }catch(e){clientRefresh.record('failed',{reason:String(e.message).slice(0,120)});saveClientRefresh();}
 finally{clientRefreshBusy=false;}
}
const { AutoBrain } = require('./auto-brain');
const getAIFarm = () => {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch {}
  return { id: child?.pid, ready: !!child && child.connected && !stopping && Date.parse(s.at) >= startedAt
    && Date.now() - Date.parse(s.at) < 60000 && s.instances?.some(i => i.status === 'playing') };
};
const systemRecovery=new(require('./learning/system-recovery').SystemRecovery)(ROOT,argv.machine||'windows',{launch:request=>new Promise((resolve,reject)=>{
 const file=path.join(LOG_DIR,'ai-system/reviewer.log');fs.mkdirSync(path.dirname(file),{recursive:true});const out=fs.openSync(file,'a');
 const worker=spawn(process.execPath,['scripts/review-game-release.js',Buffer.from(JSON.stringify(request)).toString('base64')],{cwd:ROOT,stdio:['ignore',out,out],windowsHide:true});fs.closeSync(out);
 worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(Error('System review worker failed')));
})});
const systemTick=()=>{systemRecovery.tick({enabled:autoBrain.data.enabled,farm:getAIFarm()}).catch(()=>{});return systemRecovery.view();};
const dispatchAI = command => command.action==='sync_game'?Promise.resolve(systemRecovery.request(command,{enabled:autoBrain.data.enabled,farm:getAIFarm()})):new Promise(resolve => {
  const proc = child, id = command.id;
  if (!proc?.connected || stopping) return resolve({ status: 'เกมไม่พร้อม' });
  let timer;
  const finish = result => { clearTimeout(timer); proc.off('message', receive); resolve(result); };
  const receive = m => { if (m?.type === 'ai-command-result' && m.id === id) finish(m); };
  proc.on('message', receive);
  timer = setTimeout(() => finish({ status: 'ยังไม่ได้รับการยืนยันจากเกม' }), 3000);
  proc.send({ type: 'ai-command', id, command }, e => { if (e) finish({ status: 'ส่งไม่สำเร็จ' }); });
});
let autoBrain = new AutoBrain(ROOT, advisor, getAIFarm, dispatchAI,{systemRecovery:systemTick});
const advisoryReload = new(require('./runtime/advisory-reload').AdvisoryReload)(ROOT,argv.machine||(process.platform==='win32'?'windows':'tum'));
const loadedControllerRevision=require('./knowledge/system-version').inventory(ROOT).components.controller.revision;
function reloadAdvisory(){const current={advisor,autoBrain};const result=advisoryReload.reload(current,()=>{const next=new(require('./ai-advisor').Advisor)(ROOT);return {advisor:next,autoBrain:new(require('./auto-brain').AutoBrain)(ROOT,next,getAIFarm,dispatchAI,{systemRecovery:systemTick})};});advisor=current.advisor;autoBrain=current.autoBrain;return result;}
setInterval(()=>{try{reloadAdvisory();}catch{advisoryReload.state={...advisoryReload.state,status:'failed',reason:'component check unavailable; old AI/farm preserved',at:Date.now()};}},60000).unref();
setInterval(() => autoBrain.tick().catch(() => {}), 15000).unref();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freeMb = () => Math.round(os.freemem() / 1048576);

// ---------------------------------------------------------------- process control
function buildArgs(o) {
  const a = ['scripts/run.js', `--n=${o.n}`];
  if (argv.machine) a.push(`--machine=${argv.machine}`);
  // --god is a preset in run.js that sets nodraw/no-frames/recycle values for six windows; the
  // individual flags below still win where they are set.
  if (o.god) a.push('--god');
  if (o.nodraw) a.push('--nodraw');
  if (o.headed) a.push('--headed');
  if (o.autoBuild === false) a.push('--no-build');
  if (o.job) a.push(`--job=${o.job}`);
  if (o.huntmap) a.push(`--huntmap=${o.huntmap}`);
  if (o.radius) a.push(`--radius=${o.radius}`);
  if (o.potpct) a.push(`--potpct=${o.potpct}`);
  if (o.stuck) a.push(`--stuck=${o.stuck}`);
  if (o.townstuck) a.push(`--townstuck=${o.townstuck}`);
  if (o.minfree) a.push(`--minfree=${o.minfree}`);
  if (o.stagger) a.push(`--stagger=${o.stagger}`);
  // Passthrough so a deployment can size the farm for its machine (small boxes need
  // cheaper windows: --windowcost, and --no-audio to skip decoded audio entirely).
  if (o.windowcost) a.push(`--windowcost=${o.windowcost}`);
  if (o.recyclebelow) a.push(`--recyclebelow=${o.recyclebelow}`);
  if (o.rotate) a.push(`--rotate=${o.rotate}`);
  if (o.purge) a.push(`--purge=${o.purge}`);
  if (o.noaudio) a.push('--no-audio');
  if (o.fps) a.push(`--fps=${o.fps}`);
  if (o.splitbrowsers) a.push('--split-browsers');
  if (o.w) a.push(`--w=${o.w}`);
  if (o.h) a.push(`--h=${o.h}`);
  return a;
}

function logName() { return `farm-${new Date().toISOString().slice(0, 10)}.log`; }
function consoleName() { return `console-${new Date().toISOString().slice(0, 10)}.log`; }

function start(o) {
  if(argv.federation&&+o.n!==+argv.n)return {ok:false,error:`This machine is assigned ${argv.n} characters in the 3+3 team`};
  if (child || stopTask || stopping) return { ok: false, error: 'already running or cleanup pending' };
  // All accepted launch paths (API, autostart, refresh, recovery) share this durable intent.
  require('./runtime/host-intent').record(ROOT,'running');
  // First run on a fresh machine has no logs/ yet; the console-file open below would throw
  // inside the autostart timer and kill the whole panel (seen on the Linux deployment).
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try { fs.unlinkSync(STOP_FILE); } catch { }
  lastOptions = o;
  lastError = null;
  stopping = false;

  // The supervisor writes its own structured log file. Send the child's raw stdout/stderr
  // to a *different* file, otherwise every line lands in both and the farm log doubles up.
  // The console file still captures crashes and stack traces.
  const out = fs.openSync(path.join(LOG_DIR, consoleName()), 'a');
  fs.writeSync(out, `\n===== run started ${new Date().toISOString()} =====\n`);
  try {
    child = spawn(process.execPath, buildArgs(o), {
      cwd: ROOT, stdio: ['ignore', out, out, 'ipc'], windowsHide: true,
    });
  } catch(e) { lastError=e.message;scheduleRestart('synchronous farm launch failure');throw e; }
  finally { fs.closeSync(out); }
  const launched=child;
  startedAt = Date.now();
  child.on('exit', code => {
    if(child!==launched)return;
    const wasStopping = stopping;
    child = null;
    startedAt = 0;
    stopping = false;
    if (code !== 0 && code !== null) lastError = `farm exited with code ${code}`;
    // A clean stop is one the user asked for. Anything else means the farm died on its own, and
    // leaving it dead is the one failure mode that costs hours of farming - so bring it back.
    if (!wasStopping) scheduleRestart(`farm exited (code ${code})`);
  });
  child.on('error', e => {
    if(child!==launched)return;
    lastError = e.message; child = null; startedAt = 0; stopping = false;
    scheduleRestart(`farm failed to start: ${e.message}`);
  });
  return { ok: true, pid: child.pid, args: buildArgs(o) };
}

/**
 * Bring the farm back after a failure, with backoff.
 *
 * Nothing else restarts it: the farm is the panel's child, so if it dies the panel is still up
 * and perfectly able to relaunch it - it just never used to.
 */
const controllerRecovery=new(require('./runtime/controller-recovery').ControllerRecovery)({
 allowed:()=>autoRestart&&!child&&!stopping&&!!lastOptions&&!require('./runtime/host-intent').view(ROOT,false).operatorStopped,
 revision:()=>controlRevision,probe:async()=>{const h=await api.health();return !!h&&/^[a-f0-9]{7,64}$/.test(h.build||'');},start:()=>start(lastOptions),
 report:r=>{lastError='controller recovery: '+r.state+'; attempt '+r.attempt;console.error('panel:',lastError);}
});
function scheduleRestart(why){controllerRecovery.request(why);}

/**
 * Watchdog: a farm that is running but has stopped writing status.json is hung, not working.
 *
 * The supervisor writes that file every --status seconds, so a stale one means the process is
 * alive but not doing anything - which looks identical to "fine" from the outside and is exactly
 * how a farm can sit dead for hours.
 */
async function watchdogTick() {
  if (!child || stopping || stopTask || watchdogBusy) return;
  if(Date.now()-startedAt<HUNG_AFTER_MS)return;
  let at=null;
  try { at=Date.parse(JSON.parse(fs.readFileSync(STATUS_FILE,'utf8')).at); } catch {}
  const now=Date.now();
  if(Number.isFinite(at)&&at>=startedAt&&now>=at&&now-at<HUNG_AFTER_MS){if(now-startedAt>300000)controllerRecovery.reset();return;}
  const revision=controlRevision;
  watchdogBusy=true;
  lastError='hung: current farm snapshot stopped advancing';
  try {
    // Keep ownership until positive closure. A failed cleanup remains retryable.
    const result=await stop();
    if(result.ok&&controlRevision===revision)scheduleRestart('hung farm');
  } catch(e) {lastError='process cleanup failed: '+e.message;console.error(lastError);}
  finally {watchdogBusy=false;}
}

function stop() {
  if(stopTask)return stopTask;
  stopTask=drainFarm().finally(()=>{stopTask=null;});
  return stopTask;
}
async function drainFarm() {
  if (!child) return { ok: true, note: 'not running' };
  const proc=child;
  stopping = true;
  try {
    fs.writeFileSync(STOP_FILE, String(Date.now()));
    const deadline = Date.now() + 25000;
    while (child===proc && Date.now() < deadline) await sleep(400);
    if(child!==proc)return {ok:true};
    await terminateTree(proc.pid);
    // The exit event is the positive closure proof, not the kill request.
    const closedBy=Date.now()+5000;
    while(child===proc&&Date.now()<closedBy)await sleep(100);
    if(child===proc)throw Error('farm closure not confirmed; ownership retained');
    return {ok:true,forced:true};
  } finally {stopping=false;}
}

// ---------------------------------------------------------------- status
async function status() {
  let instances = [], party = null, guild = null, tower = null;
  let snapshotAt = null, runtimeV2 = null, gameKnowledge = null;
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    instances = s.instances || [];
    snapshotAt = s.at;
    party = s.party || null;
    guild = s.guild || null;
    tower = s.tower || null;
    runtimeV2=s.runtimeV2||null;gameKnowledge=s.gameKnowledge||null;
  } catch { }

  const health = await api.health().catch(() => null);
  const cacheDir = health && health.build ? path.join(ROOT, 'cache', health.build) : null;
  let cacheFiles = 0, cacheMB = 0;
  if (cacheDir && fs.existsSync(cacheDir)) {
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else { cacheFiles++; try { cacheMB += fs.statSync(p).size; } catch { } }
      }
    };
    try { walk(cacheDir); } catch { }
  }

  // EXP progress per instance, computed with the GAME'S OWN expToNext from the live build -
  // hardcoding one build's formula (fc1842a) is what left every bar empty after the 29 Sep
  // update changed the build hash.
  const expTable = health && health.build ? loadExpTable(ROOT, health.build) : null;
  instances = instances.map(i => {
    if (!expTable || !Number.isInteger(i.lv) || i.lv < 1 || i.lv >= 120 || !Number.isFinite(i.exp) || i.exp < 0) return i;
    const need = expTable[i.lv + 1] - expTable[i.lv];
    if (!Number.isFinite(need) || need <= 0) return i;
    return { ...i, expNeed: need, expPct: Math.min(100, i.exp / need * 100) };
  });
  return {
    panelVersion: PANEL_VERSION,
    running: !!child,
    pid: child ? child.pid : null,
    startedAt,
    uptimeSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
    stopping,
    options: lastOptions,
    godDefault: !!argv.god,
    countDefault: +(argv.n||6),
    federatedDefault: !!argv.federation,
    autoRestart: autoRestart,
    error: lastError,
    host: {
      freeMb: freeMb(),
      totalMb: Math.round(os.totalmem() / 1048576),
      cpus: os.cpus().length,
    },
    game: health ? { online: health.online, build: health.build } : null,
    instances,
    party,
    guild,
    tower,
    snapshotAt,
    runtimeV2,gameKnowledge,
    cache: { files: cacheFiles, mb: +(cacheMB / 1048576).toFixed(1) },
    logFile: path.join(LOG_DIR, logName()),
  };
}

function tailLog(n) {
  const p = path.join(LOG_DIR, logName());
  try {
    const text = fs.readFileSync(p, 'utf8');
    const lines = text.split('\n');
    return lines.slice(Math.max(0, lines.length - n)).join('\n');
  } catch { return ''; }
}

/**
 * What each character should do next, computed from the game's own tables.
 *
 * The dashboard should answer "am I getting stronger" without anyone reading a log, so this
 * reuses the exact planners the controller runs (src/economy.js) rather than a second copy of
 * the rules that could drift.
 */
function plans() {
  let instances = [], party = null, guild = null, tower = null;
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    instances = s.instances || [];
    party = s.party || null; guild = s.guild || null; tower = s.tower || null;
  } catch { }

  // status.json carries no build hash, so resolve the newest cache directory - the same rule
  // economy.anyWorld uses. Without this the wing plan silently came back null on the dashboard
  // while working fine in the controller.
  const build = (instances[0] && instances[0].build) || economy.newestBuild(ROOT);
  const cat = economy.loadCatalog(ROOT, build);
  const wiki = economy.loadWiki(ROOT);
  const wings = economy.loadWings(ROOT, build);
  const recipes = (wiki && wiki.crafting && wiki.crafting.recipes) || [];

  const rows = instances.filter(i => i && i.lv).map(i => {
    const equip = i.equip || {}, refine = i.refine || {}, mats = i.materials || {};
    const coins = i.coins || 0, lv = i.lv || 1, job = i.job || 'novice';

    const wp = economy.wingPlan({ job, materials: mats, coins, lv, world: cat.world, items: cat.items, wings, recipes, held: economy.ownedNames(i) });
    const rp = economy.refinePlan({ equip, refine, materials: mats, coins, items: cat.items, world:cat.world, wiki });
    const pets = economy.petPlan({ bestiary: i.bestiary || {}, wiki, limit: 3 });
    const gear = economy.gearFarm({ lv, job, world: cat.world, items: cat.items, wiki, limit: 3 });

    return {
      slot: i.slot, char: i.char, lv, job,
      wing: require('./wing-recipes').publicPlan(wp),
      refine: {
        doable: rp.doable.length,
        next: rp.doable.slice(0, 3).map(s => `${s.slot} +${s.to} (${s.chancePct}%)`),
        blocked: rp.blockedByOre.slice(0, 3).map(b => `${b.need} ${b.have}/${b.want}`),
      },
      pet: pets.length ? {
        name: pets[0].monster, pct: pets[0].progressPct,
        kills: pets[0].kills, need: pets[0].need,
        unlocked: pets[0].unlocked, bonus: pets[0].firstTier,
      } : null,
      gear: gear.slice(0, 2).map(g => `${g.item} T${g.tier} ${g.ratePct}% <- ${g.monster}`),
    };
  });
  return { at: new Date().toISOString(), party, guild, tower, rows };
}

/**
 * One character, in full: personal stats, learned skills, worn gear, bag, pets and the plans.
 *
 * The dashboard's overview answers "is the farm healthy"; this answers "what IS this character".
 * Everything is joined against the game's own tables so the panel shows names and caps rather
 * than raw ids.
 */
function character(slot) {
  let instances = [];
  try {
    const st = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    instances = st.instances || [];
  } catch { }
  const i = instances.find(x => x && x.slot === slot);
  if (!i) return { ok: false, error: `no window in slot ${slot}` };

  const build = economy.newestBuild(ROOT);
  const cat = economy.loadCatalog(ROOT, build);
  const wiki = economy.loadWiki(ROOT) || {};
  const skills = (wiki.classes && wiki.classes.skills) || {};
  const wings = economy.loadWings(ROOT, build);
  const recipes = (wiki.crafting && wiki.crafting.recipes) || [];
  const items = cat.items;

  const equip = Object.entries(i.equip || {}).filter(([, id]) => id).map(([slotName, id]) => {
    const it = items[id] || {};
    return {
      slot: slotName, id, name: it.name || id, tier: it.tier || 1, rarity: it.rarity || 'common',
      stats: it.stats || null, refine: (i.refine || {})[id] || 0,stage:i.stage?.[id]??null,holes:i.holes?.[id]??null,sockets:i.sockets?.[id]??null,
      reqLv: it.reqLv || 1,
    };
  });

  const bagCounts=Array.isArray(i.bag)?i.bag.reduce((out,row)=>{const id=typeof row==='string'?row:row.id;if(id)out[id]=(out[id]||0)+1;return out;},{}):(i.bag||{});
  const bag = Object.entries(bagCounts)
    .map(([id, n]) => ({ id, n, name: (items[id] || {}).name || id, tier: (items[id] || {}).tier || 1 }));

  const learned = Object.entries(i.skills || {}).map(([id, lv]) => {
    const d = skills[id] || {};
    return { id, name: d.name || id, lv, max: d.max || null, kind: d.kind || null,
      desc: Array.isArray(d.desc) ? (d.desc[Math.min(lv - 1, d.desc.length - 1)] || null) : null };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const pets = economy.petPlan({ bestiary: i.bestiary || {}, wiki, limit: 6 });

  return {
    ok: true, slot,
    char: i.char, account: i.account, status: i.status,
    job: i.job, jobLv: i.jobLv, lv: i.lv, exp: i.exp,
    hp: i.hp, potions: i.potions, coins: i.coins, tokens: i.tokens, runeDust: i.runeDust,
    mapId: i.mapId, pts: i.pts, skPts: i.skPts, fps: i.fps,
    noProgressFor: i.noProgressFor, errors: i.errors, recycles: i.recycles,
    boardQuest: i.boardQuest, lastChore: i.lastChore,
    // the game brain: the current goal (with its reasoning) and what the character has measured
    goal: i.goal || null, learned: i.learned || null,
    // personal stats - the six the player allocates, straight from the save
    stats: i.st || null,
    identity:i.identity||null,astral:i.astral||null,astralObjective:i.astralObjective||null,observations:i.observations||null,levelProgress:i.levelProgress||null,levelTrainingStatus:i.levelTrainingStatus||null,developmentProgress:i.developmentProgress||null,equipmentCeiling:i.equipmentCeiling||null,equip, bag, bagTier:i.bagTier,bagCapacity:i.bagCapacity,bagUsed:Array.isArray(i.bag)?i.bag.length:bag.reduce((n,r)=>n+r.n,0),survivalStatus:i.survivalStatus||null, skills: learned, pets,
    materials: Object.keys(i.materials || {}).length,
    wing: (() => {
      const wp = economy.wingPlan({ job: i.job, materials: i.materials || {}, coins: i.coins || 0,
        lv: i.lv || 1, world: cat.world, items, wings, recipes, held: economy.ownedNames(i) });
      return require('./wing-recipes').publicPlan(wp);
    })(),
    promote: (() => {
      const to = economy.BASE_TO_PROMOTED[i.job];
      const ready = !!to && (i.jobLv || 0) >= 50 && (i.lv || 0) >= 60;
      return { to: to || null, ready, needJobLv: 50, needLv: 60 };
    })(),
  };
}

// ---------------------------------------------------------------- http
function json(res, code, body) {
  // Guard against a second response. This is called from the top-level catch as well, and if the
  // handler already wrote a head before failing, writeHead here throws ERR_HTTP_HEADERS_SENT -
  // which then escapes the request handler and takes the whole panel process down. That happened
  // for real on 2026-09-29 and orphaned the farm it had spawned.
  if (res.headersSent) { try { res.end(); } catch { } return; }
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}
function readBody(req) {
  return new Promise(res => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch { res({}); } });
  });
}

let mapFlight = null;
let mapRequestId = 0;
async function teamMap() {
  if (!child || !child.connected || stopping) return { running: false, maps: MAP_CATALOG, members: [], at: Date.now() };
  if (mapFlight) return mapFlight;
  const proc = child, id = ++mapRequestId;
  mapFlight = new Promise(resolve => {
    let timer;
    const finish = result => {
      clearTimeout(timer); proc.off('message', receive);
      resolve({ maps: MAP_CATALOG, ...result });
    };
    const receive = message => {
      if (message?.type === 'team-map' && message.id === id) {
        if (child !== proc || stopping) return finish({ running: false, members: [], at: Date.now() });
        finish({ running: true, at: message.at, members: message.members });
      }
    };
    proc.on('message', receive);
    timer = setTimeout(() => finish({ running: true, unavailable: true, members: [], at: Date.now() }), 1500);
    proc.send({ type: 'team-map', id }, error => {
      if (error) finish({ running: false, unavailable: true, members: [], at: Date.now() });
    });
  });
  try { return await mapFlight; } finally { mapFlight = null; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    const originBlock=controlSecurity.origin(req);if(originBlock)return json(res,403,{error:originBlock});
    if (u.pathname === '/api/panel-health' && req.method === 'GET') return json(res, 200, {service:'asteria-panel',version:PANEL_VERSION,machine:argv.machine||'windows',at:Date.now(),farmPid:child?.pid||null,farmStartedAt:startedAt||null,running:!!child&&!stopping,controllerRecovery:controllerRecovery.view(),...require('./runtime/host-intent').view(ROOT,!!child&&!stopping),loadedControllerRevision,clientRefresh:clientRefresh.view(),systemRecovery:systemRecovery.view()});
    // ---- auth (only when a panel password is set) ----
    if (u.pathname === '/api/auth' && req.method === 'POST') {
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'JSON required'});
      const body = await readBody(req);
      const given = String(body.password || '');
      // Constant-time compare so the password cannot be guessed a character at a time.
      const a = Buffer.from(given), b = Buffer.from(PANEL_PASSWORD);
      const same = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!same) {
        await new Promise(r => setTimeout(r, 400));       // slow down guessing
        return json(res, 401, { error: 'รหัสผ่านไม่ถูกต้อง' });
      }
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.add(sid);
      res.setHeader('set-cookie', `af_sid=${sid}; HttpOnly; SameSite=Strict; Path=/`);
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/logout' && req.method === 'POST') {
      sessions.delete(cookieOf(req, 'af_sid'));
      res.setHeader('set-cookie', 'af_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    if(['/api/start','/api/stop'].includes(u.pathname)&&req.method==='POST'){const blocked=controlSecurity.mutation(req);if(blocked)return json(res,403,{error:blocked});}
    if (!isAuthed(req)) {
    if (u.pathname === '/' || u.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(LOGIN_PAGE);
      }
      if (u.pathname === '/api/icon') { /* icon is harmless; fall through */ }
      else return json(res, 401, { error: 'unauthorised' });
    }

    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(panelPage());
    }
    if(u.pathname==='/api/control-token'&&req.method==='GET')return json(res,200,{token:controlSecurity.token});
    if (u.pathname === '/api/team') {
      const t = new Team(ROOT);
      return json(res, 200, {
        file: path.relative(ROOT, t.file),
        count: t.members.length,
        members: require('./runtime/panel-security').publicTeam(t.members),
      });
    }
    if (u.pathname === '/api/status') return json(res, 200, await status());
    if(u.pathname==='/api/components'&&req.method==='GET'){const c=require('./knowledge/system-version').inventory(ROOT);return json(res,200,{source:Object.fromEntries(Object.entries(c.components).map(([k,v])=>[k,v.revision])),ai:advisoryReload.state,controller:{loadedRevision:loadedControllerRevision,reloadPolicy:'external controller restart required'},farmPid:child?.pid||null,web:{staticAssets:'read_from_disk_per_request',serverReload:'separate_dashboard_process'}});}
    if(u.pathname==='/api/components/reload'&&req.method==='POST'){if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['x-advisor-request']!=='1')return json(res,403,{error:'Origin/header rejected'});return json(res,200,reloadAdvisory());}
    if (u.pathname === '/api/advice' && req.method === 'GET') {
      let outcomes = [];
      try { outcomes = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')).instances.filter(i => i.aiControl).map(i => ({ slot: i.slot, ...i.aiControl })); } catch {}
      return json(res, 200, { ...advisor.view(), automation: autoBrain.view(), outcomes });
    }
    if (u.pathname === '/api/advice/auto' && req.method === 'POST') {
      if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['x-advisor-request'] !== '1') return json(res, 403, { error: 'Origin/header rejected' });
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled must be boolean' });
      autoBrain.setEnabled(body.enabled);
      if (!body.enabled && child?.connected) child.send({ type: 'ai-cancel' }, () => {});
      return json(res, 200, { automation: autoBrain.view() });
    }
    if (u.pathname === '/api/advice' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Origin rejected' });
      if (req.headers['x-advisor-request'] !== '1') return json(res, 403, { error: 'Missing request header' });
      if (!child || stopping) return json(res, 409, { error: 'กรุณาเปิดระบบเกมก่อนขอแผน' });
      try { return json(res, 200, await advisor.generate()); }
      catch (e) { return json(res, 400, { error: /^(ข้อมูลเกม|ยังไม่มีข้อมูล|กำลังวิเคราะห์|เว้นอย่างน้อย)/.test(e.message) ? e.message : 'ไม่สามารถสร้างแผนได้ กรุณาตรวจการตั้งค่า .env' }); }
    }
    if (u.pathname === '/api/team-brain') return json(res, 200, require('./team-room').teamView(ROOT, !!child && !stopping));
    if (u.pathname === '/api/map') return json(res, 200, await teamMap());
    if (u.pathname === '/api/reports') {
      let data = {};
      try { data = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'reports.json'), 'utf8')); } catch {}
      return json(res, 200, { running: !!child && !stopping, ...reportSummary(data) });
    }
    if (['/team-map.js', '/team-map.css', '/reports-ui.js', '/reports-ui.css', '/ai-advisor-ui.js', '/team-brain-ui.js'].includes(u.pathname)) {
      res.writeHead(200, { 'content-type': u.pathname.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', u.pathname.slice(1))));
    }
    if (u.pathname === '/api/plan') return json(res, 200, plans());
    if (u.pathname === '/api/char') {
      const slot = +u.searchParams.get('slot');
      if (!Number.isFinite(slot)) return json(res, 400, { error: 'slot required' });
      return json(res, 200, character(slot));
    }
    if (u.pathname === '/api/log') return json(res, 200, { text: tailLog(+(u.searchParams.get('tail') || 120)) });
    if (u.pathname === '/api/frame') {
      const slot = +u.searchParams.get('slot');
      if (!Number.isFinite(slot)) return json(res, 400, { error: 'slot required' });
      const f = path.join(LOG_DIR, 'frames', `slot-${String(slot).padStart(2, '0')}.jpg`);
      // Read the bytes first, then look at the clock. A stat-then-read pair races with the farm
      // rewriting this file (~1/s), and it is the read that loses - after the head is already
      // written, which is exactly how the crash above got triggered.
      let buf;
      try { buf = fs.readFileSync(f); }
      catch { res.writeHead(404, { 'cache-control': 'no-store' }); return res.end(); }
      let ageMs = 0;
      try { ageMs = Date.now() - fs.statSync(f).mtimeMs; } catch { }
      // A frame older than this means that window is not producing previews any more.
      if (ageMs > 15000) { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); }
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': buf.length,
        'cache-control': 'no-store, max-age=0',
        'x-frame-age-ms': String(Math.round(ageMs)),
      });
      return res.end(buf);
    }
    if (u.pathname === '/api/start' && req.method === 'POST') {
      const revision=++controlRevision;controllerRecovery.reset();
      const body = await readBody(req);
      if(controlRevision!==revision)return json(res,409,{ok:false,error:'newer manual control superseded start'});
      return json(res, 200, start({
        n: Math.max(1, Math.min(24, +body.n || 1)),
        nodraw: !!body.nodraw,
        headed: !!body.headed,
        autoBuild: body.autoBuild !== false,
        job: body.job || '',
        huntmap: body.huntmap || '',
        radius: body.radius || '',
        potpct: body.potpct || '',
        stuck: body.stuck || '',
        townstuck: body.townstuck || '',
        minfree: body.minfree || '',
        stagger: body.stagger || '',
        god: !!body.god,
      }));
    }
    if (u.pathname === '/api/stop' && req.method === 'POST') {require('./runtime/host-intent').record(ROOT,'operator_stopped');controlRevision++;controllerRecovery.reset();return json(res, 200, await stop());}
    if (u.pathname === '/api/icon') {
      const p = path.join(ROOT, 'assets', 'asteria-farm.ico');
      if (!fs.existsSync(p)) return json(res, 404, { error: 'no icon' });
      res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(p));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    // Log it: this used to fail silently from the caller's point of view, and the panel dying is
    // the difference between a controllable farm and an orphaned one.
    console.error(`panel request failed (${req.method} ${req.url}):`, (e && e.message) || e);
    json(res, 500, { error: String((e && e.message) || e) });
  }
});

// A panel that dies takes its control surface with it while the farm it spawned keeps running,
// and a replacement panel cannot adopt that child - so a second "start" would sign the same
// accounts in twice and they would kick each other. Stay up and say so instead.
server.on('clientError', (err, socket) => {
  console.error('panel client error:', err && err.message);
  try { socket.destroy(); } catch { }
});

// ---------------------------------------------------------------- page
const LOGIN_PAGE = `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Asteria Farm - เข้าสู่ระบบ</title>
<link rel="icon" href="/api/icon">
<style>
  :root{--bg:#0b1117;--panel:#111a23;--line:#1e2c39;--tx:#dfe9f2;--dim:#7e93a6;--acc:#2ee59d;--err:#ff6b6b}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 20% -10%,#13202c,transparent),var(--bg);
       color:var(--tx);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  form{background:linear-gradient(180deg,var(--panel),#0e161e);border:1px solid var(--line);border-radius:16px;
       padding:30px;width:min(360px,92vw);display:grid;gap:14px}
  img{width:56px;height:56px;border-radius:12px;justify-self:center;box-shadow:0 6px 20px rgba(46,229,157,.2)}
  h1{margin:0;font-size:17px;text-align:center;font-weight:650}
  p.sub{margin:-8px 0 4px;text-align:center;color:var(--dim);font-size:12.5px}
  input{background:#0a1219;border:1px solid var(--line);border-radius:10px;color:var(--tx);padding:12px 14px;font:inherit;width:100%}
  input:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(46,229,157,.12)}
  button{font:inherit;font-weight:650;border-radius:10px;border:1px solid var(--acc);
         background:linear-gradient(180deg,#2ee59d,#12b374);color:#04140d;padding:12px;cursor:pointer}
  button:disabled{opacity:.5;cursor:not-allowed}
  .err{color:var(--err);font-size:13px;min-height:18px;margin:0;text-align:center}
</style></head>
<body>
<form id="f">
  <img src="/api/icon" alt="">
  <h1>Asteria Farm</h1>
  <p class="sub">ใส่รหัสผ่านเพื่อเข้าใช้งาน</p>
  <input id="pw" type="password" autocomplete="current-password" placeholder="รหัสผ่าน" autofocus>
  <p class="err" id="e"></p>
  <button id="go" type="submit">เข้าใช้งาน</button>
</form>
<script>
  const f = document.getElementById('f'), pw = document.getElementById('pw'),
        go = document.getElementById('go'), e = document.getElementById('e');
  f.addEventListener('submit', async ev => {
    ev.preventDefault(); go.disabled = true; e.textContent = '';
    try {
      const r = await fetch('/api/auth', { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ password: pw.value }) });
      if (r.ok) { location.reload(); return; }
      const j = await r.json().catch(()=>({}));
      e.textContent = j.error || 'รหัสผ่านไม่ถูกต้อง';
    } catch (err) { e.textContent = 'เชื่อมต่อไม่ได้'; }
    go.disabled = false; pw.select();
  });
</script>
</body></html>`;

// Read the page per request so UI-only edits do not restart the farm.
function panelPage() { return fs.readFileSync(path.join(__dirname, 'public', 'panel.html'), 'utf8'); }

function openBrowser(url) {
  const open = spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true });
  open.on('error', () => { });
  open.unref();
}

server.on('error', async e => {
  if (e.code === 'EADDRINUSE') {
    // Another panel already owns the port. If it is an older build it would keep serving the
    // previous page, which is confusing rather than helpful - so say so plainly.
    const url = `http://127.0.0.1:${PORT}/`;
    let theirs = null;
    try {
      const r = await fetch(url + 'api/status', { cache: 'no-store' });
      theirs = (await r.json()).panelVersion || null;
    } catch { }
    if (theirs && theirs !== PANEL_VERSION) {
      console.log(`An older control panel (v${theirs}) is still running at ${url}.`);
      console.log(`This build is v${PANEL_VERSION}. Close it first, or use "Asteria Farm.cmd",`);
      console.log('which replaces it automatically. On Windows you can also run:');
      console.log('  for /f "tokens=5" %a in (\'netstat -ano ^| findstr ":4711" ^| findstr LISTENING\') do taskkill /PID %a /F');
    } else {
      console.log(`The control panel is already running at ${url} - opening it.`);
    }
    if (!argv['no-open']) openBrowser(url);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? `http://<this machine's IP>:${PORT}/` : `http://127.0.0.1:${PORT}/`;
  console.log(`Asteria Farm control panel: ${shown}`);
  console.log(`project: ${ROOT}`);
  console.log(`listening on: ${HOST}:${PORT}`);
  if (PANEL_PASSWORD) {
    console.log('password: required (set from --password / PANEL_PASSWORD)');
  } else if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log('');
    console.log('  WARNING: the panel is bound to the network and has NO password.');
    console.log('  Anyone who can reach this port can start and stop your farm and read your');
    console.log('  team credentials. Add one:  node src/panel.js --password=<something>');
    console.log('');
  } else {
    console.log('password: none (bound to 127.0.0.1, so only this machine can reach it)');
  }
  // The watchdog is what makes an unattended run unattended: it notices a farm that is alive but
  // doing nothing, which no other part of the system can see.
  setInterval(watchdogTick, 60000).unref();
  setInterval(clientRefreshTick,30000).unref();
  console.log(`self-heal: auto-restart ${autoRestart ? 'on' : 'off'}, hung after ${HUNG_AFTER_MS / 60000} min`);
  if (argv.god) console.log('god mode: the start button defaults to 6 windows');
  // --autostart makes the desktop icon one click: open the panel and start the farm straight
  // away, rather than waiting for someone to press a button.
  if (argv.autostart) {
    const n = +(argv.n || (argv.god ? 6 : 4));
    setTimeout(() => {
      if (child) return;
      const r = start({
        n, nodraw: true, autoBuild: true, god: !!argv.god,
        // Machine-sizing passthrough (see buildArgs) - lets the systemd unit decide
        // window cost and audio policy without editing this file.
        windowcost: argv.windowcost, minfree: argv.minfree, recyclebelow: argv.recyclebelow,
        rotate: argv.rotate, purge: argv.purge, noaudio: !!argv['no-audio'], stagger: argv.stagger, fps: argv.fps,
        splitbrowsers: !!argv['split-browsers'], w: argv.w, h: argv.h,
      });
      console.log(r.ok ? `autostart: ${n} window(s), pid ${r.pid}` : `autostart failed: ${r.error}`);
    }, 1500).unref();
  }
  if (!argv['no-open']) openBrowser(`http://127.0.0.1:${PORT}/`);
});

process.on('SIGINT', async () => {
  if (child) { console.log('stopping the farm first...'); await stop(); }
  process.exit(0);
});
