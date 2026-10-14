'use strict';
const path=require('path'),fs=require('fs');
function installAdvancedRuntime(GameInstance){const p=GameInstance.prototype;require('../actions/advanced-adapters').installAdvancedAdapters(GameInstance);require('./paid-actions').installPaidActions(GameInstance);
 const socialLast=p.socialLast;if(socialLast)p.socialLast=function(type){const item=this.activityEvidence?.latest?.[type];return item?Promise.resolve({...item.state,_receivedAt:item.at}):socialLast.call(this,type);};
 const tick=p.tick;p.tick=function(...args){return tick.apply(this,args);};
 const refresh=p.refreshGoal;if(refresh)p.refreshGoal=function(...args){const trial=this.v2?.trial?.active();if(trial?.purpose==='route'){this.goal={...(trial.phase==='confirmation'?trial.baselineGoal:trial.candidateGoal),trialId:trial.id};this.huntMap=this.goal.mapId;return;}return refresh.apply(this,args);};
 p.observeAdvanced=function(now=Date.now()){
  if(!this.v2)return;const v=this.v2,identity=this.credentials?.username||'slot-'+this.slot,build=this.cache?.dir?path.basename(this.cache.dir):this.buildHash;
  v.trial ||=new(require('../learning/experiment-governor').ExperimentGovernor)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||identity,this.machine||(process.platform==='win32'?'windows':'tum'));
  v.reservations ||=new(require('../planning/resource-reservations').ResourceReservations)(this.root,identity);
  if(!v.observations||v.observations.build!==build||v.observationPage!==this.page)v.observations=new(require('../state/observations').Observations)({machine:this.machine||(process.platform==='win32'?'windows':'tum'),character:this.character?.name,build});
  v.observationPage=this.page;v.observations.observe('save',{lv:this.lastSave?.lv},this.lastSaveAt,'outgoing_client_save');v.observations.observe('position',{room:this.livePos?.room},this.livePos?.at,'outgoing_game_state');v.observations.observe('vitals',{hp:this.vitals?.hp,mp:this.vitals?.mp},this.vitals?.at,'screen_hud');v.observations.observe('fps',this.lastFps,this.lastFpsAt,'renderer_sample');
  if(this.reports){v.telemetry ||=new(require('../observability/character-telemetry').CharacterTelemetry)(this.reports,this.slot,()=>this.character?.name||this.credentials?.charName);v.telemetry.observe(this,now);}
  const active=v.trial.active();if(active&&v.journal.rows.some(r=>r.at>=active.at&&r.kind==='purchase'&&r.status!=='CANCELLED'))v.trial.finish('inconclusive','production purchase during trial');v.trial.observe(this,v.learningRevision||build);const finished=v.trial.data.rows.find(r=>r.rollbackRequired);if(finished){this.goal=finished.baselineGoal;this.huntMap=finished.baselineMap;this.teamGoal=null;this.pendingTravel=null;finished.rollbackRequired=false;v.trial.persist();}
  if(v.trial.active()?.phase==='confirmation'){this.teamGoal=null;this.refreshGoal();}
  if(now-(v.loadoutsAt||0)>60000&&this.lastSave&&now-this.lastSaveAt<30000){v.loadoutsAt=now;v.loadouts=require('../planning/activity-loadouts').plan(this.lastSave,this.catalog(),{build,contexts:v.learning.view()});}
  v.journal.importLedger(this.developmentLedger?.view(),build);
  require('./native-reservation-result').reconcile(this);
  const frames=this.activityEvidence?.latest||{};for(const entry of Object.values(frames))v.journal.server(entry.state.t,entry.at,build,entry.state);
  v.release=require('./release-policy').gate(this.root,build,'trials',now);
  // Route selection is the sole experiment proposer; no second automatic map trial.

 };
 p.observeFarmGuard=function(){if(!this.v2)return {action:'none'};this.v2.farmWatchdog ||=new(require('./farm-watchdog').FarmWatchdog)(this.root,this.credentials?.username||'slot-'+this.slot);return this.v2.farmWatchdog.observe(this);};
 p.farmGuardTick=async function(screen){const d=this.observeFarmGuard();if(d.action==='none'||screen.death||screen.panelOpen)return false;
  // Runs inside the existing instance scheduler. Reserve the attempt before sending.
  this.v2.farmWatchdog.mark(d.action,d.room,'เริ่มตรวจและกู้คืนเฉพาะตัว');
  if(d.action==='repair_auto'){const goal=this.campaignGoal||this.teamGoal||this.goal;
   const selected=goal?.mapId===this.livePos?.room&&goal?.monsterId&&await require('./main-quest').selectTarget(this,goal);
   await this.expeditionAuto(!!selected);this.log(selected?'farm watchdog: เป้าหมายยืนยันแล้ว เปิด AUTO':'farm watchdog: เป้าหมายไม่ยืนยัน เก็บ AUTO ปิดและรอจัดแผน','warn');}
  else{this.brain.block(d.room,'ไม่มีผลฟาร์มหลังตรวจ AUTO · พักพื้นที่ 20 นาที',1200000);this.teamGoal=null;this.goal=null;this.pendingTravel=null;this.refreshGoal();await this.expeditionAuto(false);await this.returnToTown();this.log('farm watchdog: เปลี่ยนพื้นที่เฉพาะตัวหลังไม่มีผลฟาร์ม','warn');}
  return true;
 };
 const snapshot=p.snapshot;p.snapshot=function(...args){const s=snapshot.apply(this,args);return {...s,workContinuity:this.workContinuity||null,resourceHealth:this.resourceHealth||null,runtimeV2:{...s.runtimeV2,farmWatchdog:this.v2?.farmWatchdog?.view()||null,stateFreshness:this.v2?.observations?.view()||null,activityEvidence:this.activityEvidence?.view(this.cache?.dir?path.basename(this.cache.dir):this.buildHash)||null,trial:this.v2?.trial?.view()||null,loadouts:this.v2?.loadouts||null,reservations:this.v2?.reservations?.view(this.cache?.dir?path.basename(this.cache.dir):this.buildHash)||null,release:this.v2?.release||null}};};
}
module.exports={installAdvancedRuntime};
