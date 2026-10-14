'use strict';
const fs=require('fs'),path=require('path');
const {ActionScheduler}=require('./action-scheduler'),{ActionJournal}=require('./action-journal');
const {roomPolicy,currentRoom}=require('./room-policy');
const {ContextLearning,farmWindowEligible}=require('../learning/context-learning');
const {SessionWatchdog}=require('./session-watchdog');
const {CapabilityPolicy}=require('../knowledge/capability-policy');
const {objective}=require('../planning/progression-objective');
const {decisionGate}=require('./freshness');
const {RecoveryHistory}=require('./recovery-history');
const {shared:recoveryQueue}=require('./recovery-queue');
function installRuntimeV2(GameInstance){
 const p=GameInstance.prototype;if(Object.hasOwn(p,'_runtimeV2Installed'))return;Object.defineProperty(p,'_runtimeV2Installed',{value:true});
 function setup(i){if(i.v2)return i.v2;const identity=i.credentials?.username||'slot-'+i.slot;i.runtimeV2=true;i.v2={scheduler:new ActionScheduler(),journal:new ActionJournal(i.root,identity),learning:new ContextLearning(i.root,identity),capabilities:new CapabilityPolicy(i.root),recovery:new RecoveryHistory(i.root,i.storageSlot??i.slot),phase:'BOOTING',lastScreenAt:0,lastActionAt:Date.now()};
  // Legacy yield samples arrive from the save socket, even while tick is occupied.
  if(typeof i.learning?.observe==='function'){const observe=i.learning.observe;i.learning.observe=function(...args){if(!farmWindowEligible(i,Date.now())||!learningBuild(i)){this.prev=null;this.prevAt=0;return;}return observe.apply(this,args);};}
  // The existing yield planner keeps its proven calculations, but persistence is
  // scoped to this build and account so updates never blend old map performance.
  if(i.learning&&i.cache?.dir){const crypto=require('crypto'),dir=path.join(i.root,'logs','build-learning',path.basename(i.cache.dir)),file=path.join(dir,crypto.createHash('sha256').update(identity).digest('hex').slice(0,16)+'.json');fs.mkdirSync(dir,{recursive:true});i.learning.file=file;try{i.learning.data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{i.learning.data={version:2,maps:{},monsters:{}};}i.learning.prev=null;i.learning.prevAt=0;}
  i.v2.journal.context=()=>({actorId:i.actorIdentity?.actorId,sessionStartedAt:i.bagSessionStartedAt,generation:i.socialInbox?.generation,build:build(i),baselineRev:i.acceptedSaveObservation?.rev??i.serverSaveObservation?.rev,loadoutSignature:require('../learning/completion-measurements').context(i.lastSave||{})});
  i.v2.scheduler.profiler=new(require('../observability/stage-profiler').StageProfiler)();
  return i.v2;}
 function knowledge(i){try{return JSON.parse(fs.readFileSync(path.join(i.root,'logs/game-knowledge/state.json'),'utf8'));}catch{return null;}}
 function build(i){return i.cache?.dir?path.basename(i.cache.dir):i.buildHash;}
 function pinSourceIdentity(i,identity,page){const v=setup(i);if(page!==i.page||!require('../knowledge/loaded-source').inspect(i.root,build(i),identity.sourceHashes).matches)return;v.loadedSourceIdentity=identity;v.loadedSourcePage=page;v.sourceIdentityCapturedAt=Date.now();}
 function sourceIdentity(i){const v=setup(i),b=build(i);return v.loadedSourceIdentity&&v.loadedSourceIdentity.build===b&&v.loadedSourcePage===i.page?v.loadedSourceIdentity:{build:b,sourceHashes:{},missing:['client','world','network'],signature:null};}
 p.loadedSourceIdentity=function(){return sourceIdentity(this);};
 const gotoAndBoot=p.gotoAndBoot;if(gotoAndBoot)p.gotoAndBoot=async function(...args){const v=setup(this),identity=require('../knowledge/loaded-source').capture(this.root,build(this)),page=this.page;interruptLearning(this,v);v.loadedSourceIdentity=null;const result=await gotoAndBoot.apply(this,args);pinSourceIdentity(this,identity,page);return result;};
 function learningBuild(i){const k=knowledge(i),b=build(i),identity=sourceIdentity(i);i.v2.sourceCoherence=require('../knowledge/loaded-source').inspect(i.root,b,k?.current?.sourceHashes,{liveBuild:k?.liveBuild||b,identity});if(identity.missing.length||k?.current&&!i.v2.sourceCoherence.matches)return null;return k?.current?.id||b+'-loaded-'+identity.signature+'-unverified';}
 function interruptLearning(i,v){v.farmEvidence?.interrupt();v.learning.interrupt();v.goalFeedback?.interrupt();if(i.learning){i.learning.prev=null;i.learning.prevAt=0;}}
 function syncLearning(i,v){const revision=learningBuild(i);if(!revision){v.learningRevision=null;interruptLearning(i,v);return;}v.expRouteIdentity=sourceIdentity(i).signature;if(v.learningRevision===revision)return;v.learningRevision=revision;if(!i.learning)return;const crypto=require('crypto'),identity=i.actorIdentity?.actorId||i.credentials?.username||'slot-'+i.slot;const file=path.join(i.actorStateRoot||i.root,'logs','build-learning',revision,crypto.createHash('sha256').update(identity).digest('hex').slice(0,16)+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});i.learning.file=file;try{i.learning.data=JSON.parse(fs.readFileSync(file));}catch(e){if(e.code!=='ENOENT')throw Error('actor learning unreadable; preserve original');i.learning.data={version:2,maps:{},monsters:{}};}i.learning.prev=null;i.learning.prevAt=0;}
 p.contextRecommendation=function(wiki){const v=setup(this);if(!this.lastSaveAt||Date.now()-this.lastSaveAt>30000)return null;v.recommendation=v.learning.recommend(this.lastSave,learningBuild(this),wiki?.maps?.maps,this.brain?.blocked()||{},this.goal?.mapId||this.livePos?.room);return v.recommendation;};
 const nativeEval=p.eval;if(nativeEval)p.eval=async function(...args){const profiler=setup(this).scheduler.profiler,before=profiler.begin();try{return await nativeEval.apply(this,args);}finally{profiler.end('eval',before);}};
 const screen=p.screen;p.screen=async function(...args){const v=setup(this);v.scheduler.checkpoint();const s=await screen.apply(this,args);v.lastScreenAt=Date.now();this.lastFps=s.fps;this.lastFpsAt=s.fpsMeasuredAt||null;this.lastHeapMB=s.heapMB;v.journal.observe(this.lastSave,this.lastSaveAt);return s;};
 // Read-only health observations remain available while a route owns the action queue.
 p.observeContinuity=async function(){const v=setup(this),now=Date.now();if(v.observing||this.status!=='playing'||this.recycling||this.healthRecovery||now-(v.observationAttemptAt||0)<5000)return;
  const page=this.page;
  v.observing=true;v.observationAttemptAt=now;
  try{const sample=await this.eval(`(() => {const n=window.AsteriaNet;return {nativeBotConsole:document.body.classList.contains('botmode')&&!!document.getElementById('botCon'),hp:document.getElementById('hpText')?.textContent||'',mp:document.getElementById('mpText')?.textContent||'',fps:Date.now()-(window.__fpsAt||0)<3000&&Number.isFinite(window.__fps)?window.__fps:null,fpsMeasuredAt:window.__fpsAt||null,heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,connected:!!n?.isConnected?.(),fixed:!!n?.fixed,kicked:!!n?.kicked,paused:!!n?.pause,repairRevision:'fleet-repair-2026-10-02',resourceProfile:window.__resourceProfile||null};})()`);
   if(this.lastSaveAt&&Date.now()-this.lastSaveAt>=30000){sample.saveDiagnostics=await this.eval(`(() => {const n=window.AsteriaNet,start=document.getElementById('start'),text=document.body?.textContent||'';return {hasConnectionId:!!n?.conn,startVisible:!!start&&!start.hidden&&getComputedStyle(start).display!=='none',nativeResaveAvailable:typeof n?.handlers?.resave==='function',saveWarning:text.includes('บันทึกเกมไม่สำเร็จ'),serverSaveWarning:text.includes('บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ')};})()`);}
   if(this.page!==page||this.recycling||this.healthRecovery||this.status!=='playing')return;
   v.observation={...sample,at:Date.now()};this.vitals=require('../team-readiness').vitals(sample,v.observation.at);this.tradeAvailability={at:v.observation.at,clear:sample.connected&&!sample.paused&&!sample.kicked};this.lastFps=sample.fps;this.lastFpsAt=sample.fpsMeasuredAt||null;this.lastHeapMB=sample.heapMB;const strategyStop=this.brain?.observeStrategy?.(this,v.observation.at);if(strategyStop)this.aiControl={...this.aiControl,status:'Stopped bounded exploration: '+strategyStop};v.observationError=null;if(sample.connected)require('./boss-feed').poll(this).catch(()=>{});this.observeFarmGuard?.();this.runtimeCost ||=new(require('../observability/runtime-cost').RuntimeCost)();this.runtimeCost.sample(this).catch(()=>{});
   // A read-only Astral query must keep flowing while a team/dungeon owns the
   // action tick. It neither steals that owner nor dispatches a point action.
   if(this.actorIdentity&&sample.connected&&!sample.fixed&&!sample.kicked&&!sample.paused){try{await require('./research-poll').poll(this);try{require('../planning/market-shadow').observe(this);}catch{this.marketShadow={state:'OBSERVATION_UNAVAILABLE',mode:'shadow_no_transactions',executable:false};}await require('./astral').poll(this);require('./astral').observe(this);}catch{this.astralQueryStatus={at:Date.now(),requested:false,reason:'native_astral_observer_unavailable'};}}
   // Keep native save evidence flowing during long owned routes. Request the
   // existing saver only; do not make its observation timestamp fresh ourselves.
   const saveNow=Date.now();if(this.lastSaveAt&&saveNow-this.lastSaveAt>=15000&&sample.connected&&!sample.paused&&!sample.fixed&&!sample.kicked&&v.sourceCoherence?.matches===true&&!roomPolicy(currentRoom(this)).dungeon&&saveNow-(v.keepFreshAskedAt||0)>=15000){
    v.keepFreshAskedAt=saveNow;try{v.keepFreshResult=await require('./native-save-probe').requestNativeResave(this);}catch{v.keepFreshResult={at:Date.now(),requested:false,reason:'native_saver_request_failed'};}
   }
  }catch(e){v.observationError=String(e.message).slice(0,180);}finally{v.observing=false;}
 };
 // Native saves keep charging travel/refill time while a long tick is busy.
 p.observeExpRoute=function(){const v=setup(this);v.expRouteEvidence ||=new(require('../learning/exp-route-evidence').ExpRouteEvidence)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.charName||'slot-'+this.slot);const valid=v.loadedSourcePage===this.page&&v.loadedSourceIdentity?.build===build(this)&&v.loadedSourceIdentity?.signature===v.expRouteIdentity;v.expRouteEvidence.observe(this,valid?v.learningRevision:null);};
 const tick=p.tick;p.tick=async function(...args){const v=setup(this);return v.scheduler.run('tick',async()=>{
  let learningObserved=false;
  try{
  const policy=roomPolicy(currentRoom(this));v.phase=policy.dungeon?'DUNGEON':this.pendingTravel?'TRAVELLING':'FARMING';
  if(policy.lab||this.socialInbox?.buildLab?.session?.active){interruptLearning(this,v);v.phase='BUILD_LAB';return 'native build lab isolated from field progression';}
  const sessionNow=Date.now();v.sessionWatchdog ||= new SessionWatchdog();
  // Only cancel our registered terminal session before stale-save gating; trade pauses saves.
  const trade=require('./team-trade');trade.reconcileUnsentCancellation(this);if(trade.cleanupPending(this)){interruptLearning(this,v);const cleaned=await trade.tick(this,{});if(cleaned){v.phase='TEAM_TRADE';return cleaned;}}
  // The trade window pauses saves; only the bounded owned protocol may advance.
  if(require('./team-trade').protocolActive(this,sessionNow)){v.phase='TEAM_TRADE';const live=await this.screen();return await require('./team-trade').tick(this,live)||'trade reconciliation pending';}
  if(this.pvpMission)interruptLearning(this,v);
  const pvpAction=await require('./pvp-mission').tick(this);if(pvpAction){v.phase='PVP_MISSION';return pvpAction;}
  if(this.lastSaveAt&&sessionNow-this.lastSaveAt>=180000){
   let health=null;try{health=await this.eval(`(() => {const n=window.AsteriaNet;if(!n)return null;return {online:!!n.online,connected:!!n.isConnected?.(),fixed:!!n.fixed,kicked:!!n.kicked,paused:!!n.pause};})()`);}catch{}
   v.sessionHealth={at:sessionNow,...health};const decision=v.sessionWatchdog.inspect({now:sessionNow,saveAt:this.lastSaveAt,health,protectedRoom:policy.dungeon,busy:this.choresBusy||this.teamControl});v.sessionStatus=decision;
   if(decision.action==='recover'){await this.recycle(decision.reason);return 'recovered stale save session';}
   if(decision.action==='wait'&&!policy.dungeon){v.phase='WAITING_FRESH_SAVE';return decision.reason;}
  }else{v.sessionWatchdog.inspect({now:sessionNow,saveAt:this.lastSaveAt});v.sessionStatus={action:'continue'};}
  v.freshness=decisionGate(this,sessionNow);
  if(!v.freshness.allowed){
   v.phase='WAITING_FRESH_DATA';
   if(!v.probeAt||sessionNow-v.probeAt>=10000){
    v.probeAt=sessionNow;
    try{const live=await this.screen();this.lastFps=live.fps;this.lastHeapMB=live.heapMB;v.probeErrors=0;
     // Ask the client's own revision-aware saver for fresh data before recycling.
     // Never manufacture a save or bypass trade/server correction guards.
     if(live.inGame&&!policy.dungeon&&!this.choresBusy&&!this.teamControl&&sessionNow-(v.resaveAt||0)>=60000){
      v.resaveAt=sessionNow;v.resaveResult=await require('./native-save-probe').probeNativeResave(this);
     }
     if(!live.inGame&&!live.loading){await this.hardReload('fresh screen confirms disconnected session while save is stale');return 'recovered disconnected session';}
    }catch(e){v.probeErrors=(v.probeErrors||0)+1;if(v.probeErrors>=3){v.probeErrors=0;await this.recycle('three failed live continuity probes');}}
   }
   return v.freshness.reason;
  }
  require('./supply-recovery').hpBatch(this);
  v.goalFeedback ||=new(require('../learning/goal-feedback').GoalFeedback)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.username||'slot-'+this.slot);v.goalFeedback.observe(this,learningBuild(this));
  syncLearning(this,v);v.farmEvidence ||=new(require('../learning/farm-evidence').FarmEvidence)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.charName||'slot-'+this.slot);v.farmEvidence.observe(this,v.learningRevision);this.journeyMemory ||=new(require('../planning/character-journey').JourneyMemory)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.charName||'slot-'+this.slot);this.journeyMemory.observe(this);v.journal.observe(this.lastSave,this.lastSaveAt);v.learning.observe(this,learningBuild(this));learningObserved=true;this.observeAdvanced?.();
  // Account rewards work in the field too. They must not wait behind a capped
  // character's town chores or reserve navigation for a dungeon it cannot enter.
  const optionalAllowed=require('./v3-instance').optionalWork(this,sessionNow)&&!require('./milestone-assistance').supplyIntent(this,sessionNow)?.due;
  if(!policy.dungeon&&optionalAllowed&&sessionNow-(v.rewardsAt||0)>=60000){
   v.rewardsAt=sessionNow;await require('./free-rewards').run(this);
  }
  // Loot upgrades should not wait for a ten-minute visit to town.
  if(!policy.dungeon&&!this.pendingTravel&&!this.choresBusy&&!this.recycling&&typeof this.planBag==='function'
      &&sessionNow-(v.gearCheckAt||0)>60000&&optionalAllowed){
   v.gearCheckAt=sessionNow;
   const plan=await this.planBag(this.roster);
   if(plan.equip?.length){const result=await this.equipItems(plan.equip);this.log('field equipment upgrade: '+JSON.stringify(result));}
  }
  const recovery=v.recovery.rows.at(-1);if(recovery?.status==='context_closed_waiting_for_boot'&&this.status==='playing')v.recovery.finish(recovery,null);
  const now=Date.now();if(this.lastSave&&now-this.lastSaveAt<30000&&now-(v.objectiveAt||0)>60000){v.objectiveAt=now;try{v.objective=objective(this.lastSave,this.catalog(),require('../economy').loadWiki(this.root),{build:build(this)});v.objectiveError=null;
      const study=require('../knowledge/mastery-service').view(this.root,this,{build:build(this),contextBuild:learningBuild(this),contexts:v.learning.view(),now});
      v.mastery=study.mastery;v.techniques=study.techniques;v.encyclopedia=study.book;
      v.masteryMemory ||=new(require('../learning/mastery-curriculum').MasteryMemory)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.username||'slot-'+this.slot);
      v.masteryMemory.observe(v.mastery);}catch(e){v.objectiveError=e.message;}}
  if(this.actorIdentity){try{this.socialInbox?.power?.enrich(this,this.lastSave);if(Date.now()-(v.powerQueryAt||0)>60000&&this.socialInbox?.generation){v.powerQueryAt=Date.now();await this.socialSend('prq',{});await this.socialSend('gq',{});}this.registryV32?.refreshFeatures();require('./astral').observe(this);v.capabilityRegistry=require('./capability-evidence').projection(this);const consoleMode=await require('./native-bot-console').tick(this);if(consoleMode)return consoleMode;const astral=await require('./astral').tick(this);if(astral)return astral;if(!policy.dungeon){const pet=await require('./active-pet').tick(this);if(pet)return pet;const book=await require('./costume-book').tick(this);if(book)return book;}}catch(e){v.astralError=e.message;}}
  try{return await tick.apply(this,args);}finally{v.lastActionAt=Date.now();}
  }finally{if(!learningObserved)interruptLearning(this,v);}
 },{leaseMs:180000});};
 const stop=p.stop;p.stop=async function(...args){const v=setup(this);v.phase='STOPPING';v.farmEvidence?.persist();v.expRouteEvidence?.persist();v.scheduler.cancel();await this.runtimeCost?.close();this.levelProgress?.persist(Date.now(),true);return stop.apply(this,args);};
 const social=p.socialSend;p.socialSend=function(kind,...args){const reads=new Set(['mq','btq','asq','bossq','twq','gdq','dgq','prq','mailq','achq','gq','pq','ginfo','gwq','qstate','shopq']);if(reads.has(kind))return social.call(this,kind,...args);const v=setup(this);return v.scheduler.run('fleet-social-'+String(kind),()=>social.call(this,kind,...args),{priority:1,contract:require('./action-contract').contract(this,'social-'+kind)});};
 const purge=p.purgeMemory;if(purge)p.purgeMemory=async function(...args){const v=setup(this),guard=require('./memory-maintenance');
  if(guard.purgeBlock(this,{owner:v.scheduler.context.getStore()}))return null;
  return v.scheduler.run('memory-gc',async()=>{v.scheduler.checkpoint();if(guard.purgeBlock(this,{owner:v.scheduler.context.getStore()}))return null;return purge.apply(this,args);},{priority:10,leaseMs:180000});};
 for(const[name,kind]of Object.entries({walkTo:'TRAVELLING',returnToTown:'TRAVELLING',escapeTown:'TRAVELLING',chainWalkTo:'TRAVELLING',travelTo:'TRAVELLING',runTownChores:'MAINTENANCE',prepareDungeon:'PREPARING',recycle:'RECOVERING',hardReload:'RECOVERING',craftAtExchange:'MAINTENANCE',refineEquipped:'MAINTENANCE',enchantWeapon:'MAINTENANCE',equipItems:'MAINTENANCE',sellItems:'MAINTENANCE',guildDungeonStart:'DUNGEON',guildDungeonJoin:'DUNGEON'})){
  const original=p[name];if(typeof original!=='function')continue;
  p[name]=async function(...args){const v=setup(this),actionContract=require('./action-contract').contract(this,name,{recovery:kind==='RECOVERING'});return v.scheduler.run(name,async()=>{
   v.scheduler.checkpoint();const policy=roomPolicy(currentRoom(this));
   if(kind==='MAINTENANCE'&&this.assistanceReservation?.expiresAt>Date.now())return {ok:false,reservationNotSent:true,reason:'active team rendezvous owns foreground; maintenance deferred',equipped:0,refined:0};
   if(kind!=='RECOVERING'){
    const gate=decisionGate(this);v.freshness=gate;
    if(!gate.allowed)return {ok:false,ready:false,sent:false,reservationNotSent:true,reason:gate.reason,equipped:0,refined:0};
   }
   if(name==='guildDungeonStart'){
    const team=this.teamEntryGate?.();
    if(team&&!team.canEnter)return {ok:false,sent:false,reason:team.reason};
   }
   if(name==='guildDungeonJoin'){
    const intent=this.fleetActivityIntent,now=Date.now();
    if(intent?.phase!=='JOINING'||intent.kind!=='guild'||intent.build!==build(this)||intent.runId!==args[0]||now>=intent.joinDeadline)return {ok:false,sent:false,reason:'no current verified guild join intent'};
    const state=await this.socialLast('gd');
    if(!state||!require('./freshness').fresh(state._receivedAt,45000,now)||state.run?.id!==args[0]||state.run.done)return {ok:false,sent:false,reason:'fresh matching server guild run required'};
    const ready=require('../team-readiness').check(this,await this.screen());this.readiness=ready;this.vitals={hp:ready.hp,mp:ready.mp,maxHp:ready.maxHp,currentHp:ready.currentHp,maxMp:ready.maxMp,currentMp:ready.currentMp,at:ready.at};
    if(!ready.ready)return {ok:false,sent:false,reason:ready.reasons.join(' · ')};
   }
   if(policy.dungeon&&kind!=='DUNGEON'&&kind!=='RECOVERING'&&name!=='walkTo')return {ok:false,reservationNotSent:true,reason:'active dungeon owns this room',equipped:0,refined:0};
   if(name==='escapeTown'&&this.goal?.mapId)return this.chainWalkTo(this.goal.mapId);
   if(['craftAtExchange','refineEquipped','enchantWeapon'].includes(name)){
    let gate=v.capabilities.check(knowledge(this),build(this),'investment',sourceIdentity(this));
    const k=knowledge(this);
    const reviewed=require('../knowledge/development-source');
    if(!gate.allowed&&reviewed.recentMatchingSource(k,build(this),Date.now(),sourceIdentity(this),this.root))gate=reviewed.check(this.root,build(this),name==='craftAtExchange'?'craft':name==='enchantWeapon'?'enchant':'refine',args,this.catalog(),require('../economy').loadWiki(this.root),this.lastSave);
    if(gate.allowed){const paid=require('./paid-actions'),estimate=paid.estimate(this,name,args),available=paid.inventory(this.lastSave,this.catalog());if(!estimate||Object.entries(estimate.cost).some(([key,value])=>!Number.isFinite(value)||value<0||(available[key]||0)<value))gate={allowed:false,reason:'no eligible upgrade or insufficient resources after reserves'};else args=estimate.args;}
    if(name==='refineEquipped')args=[{...(args[0]||{}),maxAttempts:1}];v.capabilityStatus=gate;
    if(!gate.allowed)return {ok:false,reservationNotSent:true,reason:gate.reason,refined:0};
   }
   // Short owned actions can finish between farm observations on the same map.
   // Ordinary combat repositioning remains part of farming yield and travel cost.
   if(name!=='walkTo')interruptLearning(this,v);
   const previous=v.phase;v.phase=kind;
   const recovery=kind==='RECOVERING'?v.recovery.begin(name,args[0]||'client recovery'):null;
   let waitingTimer=null;
   if(recovery){recovery.status='queued';v.recovery.save();waitingTimer=setInterval(()=>{try{v.scheduler.checkpoint();}catch{}},10000);waitingTimer.unref();}
   const travel=require('./route-travel'),to=name==='chainWalkTo'?args[0]:name==='returnToTown'?'town':null,attempt=to?travel.begin(this,to):null;let arrived=false;
   try{const result=await (recovery?recoveryQueue.run(this.slot,()=>{clearInterval(waitingTimer);recovery.status='running';v.recovery.save();v.scheduler.checkpoint();actionContract.beginRecovery();if(name!=='hardReload')return original.apply(this,args);const identity=require('../knowledge/loaded-source').capture(this.root,build(this)),page=this.page;v.loadedSourceIdentity=null;return Promise.resolve(original.apply(this,args)).then(result=>{if(result!==false)pinSourceIdentity(this,identity,page);return result;});}):original.apply(this,args));arrived=result===true||result?.ok===true;if(recovery)v.recovery.finish(recovery,result===false?Error('waiting for another slot recovery'):null);return result;}catch(e){if(recovery)v.recovery.finish(recovery,e);throw e;}finally{travel.finish(this,attempt,arrived);clearInterval(waitingTimer);v.phase=previous;v.lastActionAt=Date.now();}
  },{priority:kind==='RECOVERING'?0:5,leaseMs:180000,contract:actionContract});};
  p[name].paidDispatchTracked=original.paidDispatchTracked===true;
 }
 const restock=p.restockPotions;p.restockPotions=async function(item='Red Potion',limit=20,options={}){const v=setup(this);return v.scheduler.run('restock',async()=>{
  if(!roomPolicy(currentRoom(this)).allowTown)return {ok:false,reason:'dungeon active'};
  if(!this.lastSaveAt||Date.now()-this.lastSaveAt>30000)return {ok:false,reason:'fresh save required'};
  v.journal.observe(this.lastSave,this.lastSaveAt);const row=v.journal.beginSupply(item,this.lastSave,Date.now(),build(this),{minimum:options.minimum??10,limit,saveAt:this.lastSaveAt,sessionStartedAt:this.bagSessionStartedAt});
  if(!row)return {ok:false,reason:'previous purchase awaits reconciliation'};
  if(row.independentRestock&&v.sourceCoherence?.matches!==true){row.status='CANCELLED';row.reason='fresh coherent source required for independent essential stock';v.journal.save();return {ok:false,sent:false,status:'CANCELLED',reason:row.reason};}
  interruptLearning(this,v);
  this.potionPurchaseDispatchAt=0;
  this.activePotionPurchase=row;
  try{const result=await restock.call(this,item,limit,options);v.journal.sent(row,result);
   if(this.acceptedSaveReceipt)v.journal.acknowledgeAcceptedSave(this.acceptedSaveReceipt.state,this.acceptedSaveReceipt.proof);
   if(result?.ok){for(let n=0;n<10&&row.status==='WAITING_CONFIRMATION';n++){await new Promise(r=>setTimeout(r,500));v.journal.observe(this.lastSave,this.lastSaveAt);}}
   return {...result,ok:row.status==='CONFIRMED',sent:!!result?.ok,status:row.status,evidence:row.evidence,reason:row.status==='CONFIRMED'?null:row.reason||'waiting for inventory confirmation'};
  }catch(e){row.status=this.potionPurchaseDispatchAt?'UNCERTAIN':'CANCELLED';row.reason=e.message;row.evidence=this.potionPurchaseDispatchAt?'purchase_outcome_unknown':'failed_before_purchase_dispatch';v.journal.save();throw e;}finally{this.activePotionPurchase=null;}
 });};
 const planBag=p.planBag;p.planBag=async function(...args){const plan=await planBag.apply(this,args),v=setup(this);const protectedNames=new Set((v.objective?.nodes||[]).map(n=>n.name));if(plan.sell)plan.sell=plan.sell.filter(item=>!protectedNames.has(typeof item==='string'?item:item.name));return plan;};
 const snapshot=p.snapshot;p.snapshot=function(...args){const s=snapshot.apply(this,args),v=setup(this),k=knowledge(this);v.sourceCoherence=require('../knowledge/loaded-source').inspect(this.root,build(this),k?.current?.sourceHashes,{liveBuild:k?.liveBuild||build(this),identity:sourceIdentity(this)});if(!this.characterJourney||Date.now()-this.characterJourney.at>=30000||this.characterJourney.build!==build(this))this.characterJourney=require('../planning/character-journey').plan(this);const teamWork=require('../planning/team-workboard').project(this);return {...s,characterJourney:this.characterJourney,teamWork,teamInventory:require('../planning/team-trade').inventory(this,teamWork),tradeAvailability:this.tradeAvailability||null,livePos:this.livePos?{room:this.livePos.room,x:this.livePos.x,z:this.livePos.z,at:this.livePos.at,dead:!!this.livePos.dead}:null,vitals:this.vitals||null,runtimeHealth:{...require('../observability/runtime-health').diagnose(this),costProbe:this.runtimeCost?.status()||null},runtimeCost:this.runtimeCost?.view()||null,runtimeCostStatus:this.runtimeCost?.status()||null,actualProgress:require('../observability/actual-progress').view(this,s),dailyActivities:this.dailyActivities||null,dailyWorkStatus:this.dailyWorkStatus||null,dailyQueryStatus:this.dailyQueryStatus||null,townServiceStatus:this.townServiceStatus||null,travelRecoveryStatus:this.travelRecoveryStatus||null,survivalSupply:this.survivalSupply||null,teamPlanningStatus:this.teamPlanningStatus||null,teamCooperation:this.teamWorkboard||null,guildDevelopment:this.guildDevelopment||null,fps:this.lastFps??null,fpsAt:this.lastFpsAt||null,continuity:this.continuityReason||null,lastSaveAt:this.lastSaveAt||null,positionAt:this.livePos?.at||null,recovery:v.recovery.view(),freshness:decisionGate(this),memory:{jsHeapMb:this.lastHeapMB||null,scope:'renderer_js_heap_not_total_process_ram',at:v.lastScreenAt||null},runtimeV2:{generation:this.socialInbox?.generation||null,sessionStartedAt:this.bagSessionStartedAt||null,loadedSourceIdentity:v.loadedSourceIdentity||null,sourceCoherence:v.sourceCoherence||null,learningRevision:v.learningRevision||null,mastery:v.mastery||null,techniques:v.techniques||[],encyclopedia:v.encyclopedia||null,observation:v.observation||null,observationError:v.observationError||null,resaveResult:v.resaveResult||null,phase:v.phase,lastScreenAt:v.lastScreenAt,lastActionAt:v.lastActionAt,scheduler:v.scheduler.view(),objective:v.objective||null,objectiveError:v.objectiveError||null,capabilityStatus:v.capabilityStatus||null,costumeBook:v.costumeBook||null,purchases:v.journal.view(),contexts:v.learning.view(),farmEvidence:v.farmEvidence?.view({save:this.lastSave,build:v.learningRevision})||null,recommendation:v.recommendation||null,sessionStatus:v.sessionStatus||null,sessionHealth:v.sessionHealth||null,roomPolicy:roomPolicy(currentRoom(this))}};};
 require('./advanced-instance').installAdvancedRuntime(GameInstance);
 require('./v3-instance').installRuntimeV3(GameInstance);
}
module.exports={installRuntimeV2};
