'use strict';
const fs=require('node:fs'),path=require('node:path');
function safe(i,now=Date.now()){
 const s=i.snapshot?i.snapshot():i,phase=s.runtimeV2?.phase;
 return s.status==='playing'&&!s.recycling&&!s.choresBusy&&!s.pendingTravel&&!s.dailyWorkStatus?.ownsNavigation&&!s.teamControl&&!s.survivalRecovery&&s.runtimeV2?.scheduler?.active==null&&!require('./room-policy').roomPolicy(s.livePos?.room||s.mapId).dungeon&&now-s.lastSaveAt>=0&&now-s.lastSaveAt<30000&&!s.developmentProgress?.pending&&!(s.development||[]).some(r=>r.status==='pending')&&!(s.runtimeV2?.purchases||[]).some(r=>['STARTED','SENT','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status)&&!require('./client-refresh').historicalClosedPurchase(r,s,now))&&(!s.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(s.teamTradeStatus.phase)||require('./client-refresh').historicalIdleTrade(s,now))&&!['MAINTENANCE','RECOVERING','PREPARING','STOPPING','TEAM_TRADE','DUNGEON','PVP_MISSION'].includes(phase);
}
class RollingRefresh{
 constructor(supervisor,{now=Date.now}={}){this.supervisor=supervisor;this.now=now;this.state={status:'idle',history:[]};this.busy=false;}
 persist(){require('./telemetry-file').writeTelemetry(path.join(this.supervisor.root,'logs/rolling-client-refresh.json'),this.state);}
 request(build,sourceRevision){
  if(this.state.build===build&&this.state.status==='complete')return this.state;
  if(this.state.status==='rolling'||this.busy)return this.state;
  const s=this.supervisor,approval=require('./client-refresh').applicationApproval(s.root),semantic=require('./semantic-release').inspect(s.root,build);
  if(s.stopping||!approval.allowed||approval.sourceRevision!==sourceRevision||!semantic.autoApproved)throw Error('Reviewed current semantic release required');
  this.state={status:'rolling',build,sourceRevision,at:this.now(),slots:[],history:[],farmRestarted:false};this.persist();return this.state;
 }
 async tick(){
  if(this.busy||this.state.status!=='rolling')return;this.busy=true;
  try{
   const s=this.supervisor,r=this.state,now=this.now(),approval=require('./client-refresh').applicationApproval(s.root);
   if(s.stopping||!approval.allowed||approval.sourceRevision!==r.sourceRevision){r.status='cancelled';r.reason='stop_or_source_changed';return;}
   const intent=JSON.parse(fs.readFileSync(path.join(s.root,'logs/host-intent.json')));if(intent.mode!=='running'){r.status='cancelled';r.reason='human_stop';return;}
   const list=s.instances.filter(Boolean);if(list.length!==3||!['tum','vps'].includes(s.machine)){r.status='cancelled';r.reason='own_three_remote_scope';return;}
   if(r.canary){const i=list.find(i=>i.slot===r.canary.slot);if(!i||i.actorIdentity?.actorId!==r.canary.actorId){r.status='failed';r.reason='canary_identity_changed';return;}if(i.status!=='playing'||i.v2?.loadedSourceIdentity?.build!==r.build)return;if((i.survivalStatus?.deaths||[]).some(d=>d.at>=r.canary.at)){r.status='failed';r.reason='canary_new_death';return;}if(now-r.canary.at<60000||i.v2?.sourceCoherence?.matches!==true)return;r.history.push({...r.canary,state:'native_loaded_canary_passed'});r.canary=null;}
   const i=list.find(i=>!r.slots.includes(i.slot)&&safe(i,now));if(!i){if(r.slots.length===3){r.status='complete';s.cache=list[0].cache;s.reports.setBuild(r.build);}return;}
   const old=i.cache,oldHash=i.buildHash,oldBuild=path.basename(old.dir),actor=i.actorIdentity?.actorId;
   if(!actor||!i.registryV32?.store.validateOwner(i.actorOwner))return;
   r.canary={slot:i.slot,actorId:actor,at:now,oldBuild};r.history.push({...r.canary,state:'one_actor_reload_armed'});this.persist();
   // Existing instance recovery closes only its owned context; the other two
   // keep their schedulers and browsers. No paid/social action is repeated.
   i.buildHash=r.build;i.cache=new(require('../assetcache').AssetCache)(s.root,r.build,{blockAudio:old.blockAudio,liteWorldArt:old.liteWorldArt});
   try{if(!await i.recycle('verified semantic game update')){i.cache=old;i.buildHash=oldHash;r.canary=null;return;}r.slots.push(i.slot);r.canary.at=this.now();}
   catch(e){i.cache=old;i.buildHash=oldHash;r.status='failed';r.reason='one_actor_reload_failed';}
  }finally{this.persist();this.busy=false;}
 }
}
module.exports={safe,RollingRefresh};
