'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {key,routeContext}=require('./exp-route-evidence');
const {fresh}=require('../runtime/freshness');
const measurable=e=>e?.confidence==='observational'&&e.samples>=10&&e.ms>=300000&&e.coveragePct>=90&&e.deaths===0&&!e.expLossEvents&&e.expPerHour>0;
const sameOwner=i=>i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pvpMission||i.choresBusy||i.recycling||i.healthRecovery||i.tradeJournal?.sessionId&&!['CONFIRMED','CANCELLED'].includes(i.tradeJournal.phase);
function controlSafe(i,now,minimumFps=15){const mode=i.v2?.observation;if(mode?.nativeBotConsole===true&&fresh(mode.at,15000,now)){const p=i.v2.scheduler?.profiler?.view();const samples=(p?.stages||[]).filter(r=>r.kind==='eval').flatMap(r=>r.samples||[]).filter(s=>fresh(s.at,30000,now));return fresh(p?.at,15000,now)&&Number.isFinite(p.eventLoop?.p95Ms)&&p.eventLoop.p95Ms<200&&samples.length>0&&samples.every(s=>Number.isFinite(s.wallMs)&&s.wallMs<1500);}return fresh(i.lastFpsAt,15000,now)&&Number.isFinite(i.lastFps)&&i.lastFps>=minimumFps;}
// Zero-spend route trials cannot replay an old potion purchase. Keep its
// monetary quarantine; isolate only old-session known potions using the same
// inventory policy already used by independent progression.
function routePaymentBlocks(i,now){
 const j=i.v2?.journal;if(!j?.pending?.())return false;
 if(!Array.isArray(j.rows)||!fresh(i.tradeAvailability?.at,15000,now)||i.tradeAvailability.clear!==true)return true;
 return require('../runtime/equipment-headroom').journalBlocks(i,now);
}
class ExperimentGovernor{
 constructor(root,identity,machine,{now=Date.now}={}){
  this.actorId=identity;this.now=now;this.owner=crypto.randomUUID();this.file=root&&path.join(root,'logs','v3-experiments',crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0,24)+'.json');this.lock=root&&path.join(root,'logs','v3-experiments',String(machine).replace(/[^\w-]/g,'_')+'.lease.json');
  this.data={version:3,rows:[],observedMs:0,explorationMs:0,cooldowns:{},lastProbeAt:null,hold:null};
  if(this.file)try{this.data=JSON.parse(fs.readFileSync(this.file));}catch(e){if(e.code!=='ENOENT')throw Error('experiment journal unreadable');}
  if(this.active())this.finish('inconclusive','process restarted; restore baseline and retain interrupted evidence');
 }
 active(){return this.data.rows.find(r=>r.status==='running');}
 persist(){if(!this.file)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 release(){if(!this.lock)return;try{const r=JSON.parse(fs.readFileSync(this.lock));if(r.owner===this.owner||r.file===this.file)fs.unlinkSync(this.lock);}catch{}}
 acquire(deadline,bootstrap,now){
  if(!this.lock)return true;
  fs.mkdirSync(path.dirname(this.lock),{recursive:true});
  let old;try{old=JSON.parse(fs.readFileSync(this.lock));}catch(e){if(e.code!=='ENOENT')return false;}
  if(old?.deadline>now)return false;
  // Expired trials are safe to fence; paid reservations use a different journal.
  const lastBootstrapAt=old?.lastBootstrapAt||0;
  if(bootstrap&&now-lastBootstrapAt<86400000&&lastBootstrapAt>0)return false;
  if(old)try{fs.unlinkSync(this.lock);}catch{return false;}
  try{const fd=fs.openSync(this.lock,'wx');try{fs.writeFileSync(fd,JSON.stringify({owner:this.owner,file:this.file,deadline,lastBootstrapAt:bootstrap?now:lastBootstrapAt}));}finally{fs.closeSync(fd);}return true;}catch{return false;}
 }
 observe(i,build,now=this.now()){
  this.currentTime=now;const at=i.lastSaveAt,valid=fresh(at,30000,now)&&fresh(i.livePos?.at,10000,now)&&i.v2?.sourceCoherence?.matches===true;
  const prev=this.previous;this.previous=valid?{at,build}:null;
  if(prev&&valid&&at>prev.at&&at-prev.at<=30000&&build===prev.build){this.data.observedMs+=at-prev.at;const active=this.active();if(active){const ms=Math.max(0,at-Math.max(prev.at,active.at));this.data.explorationMs+=ms;active.chargedMs=(active.chargedMs||0)+ms;}}
  const r=this.active();if(r){
   if(i.lastSave?.lv>=i.catalog().world?.MAX_LV)this.finish('inconclusive','EXP objective completed; release actor to progression');
   else if(build!==r.build||routeContext(build,i.lastSave)!==r.signature)this.finish('version_interrupt','build or loadout context changed');
   else if(!valid)this.finish('inconclusive','stale or unverified observations');
   else if(sameOwner(i)||i.survivalRecovery||i.livePos.dead||routePaymentBlocks(i,now)||!fresh(i.vitals?.at,15000,now)||!Number.isFinite(i.vitals.hp)||i.vitals.hp<.6||!controlSafe(i,now))this.finish('safety_abort','safety, transaction or activity owns actor');
   else if(now>=r.deadline)this.finish('inconclusive','bounded wall-time budget exhausted');
  }
  if(now-(this.writtenAt||0)>=60000){this.persist();this.writtenAt=now;}
 }
 beginRoute(i,build,candidate,baseline,now=this.now()){
  this.currentTime=now;const evidence=baseline?.routeEvidence;
  if(this.active()||!measurable(evidence)||evidence.at>now||now-evidence.at>=3600000)return {ok:false,reason:'whole-route baseline required'};
  if(!candidate||candidate.monsterKind!=='normal'||candidate.kind!=='exp'||!key(candidate)||!key(baseline)||key(candidate)===key(baseline)||i.livePos?.room!==baseline.mapId||!fresh(i.vitals?.at,15000,now)||i.vitals.hp<.85||!controlSafe(i,now,candidate.kills>0?15:20)||require('../runtime/survival').hpPots(i.lastSave||{})<20||!fresh(i.lastSaveAt,30000,now)||!fresh(i.livePos?.at,10000,now)||i.v2?.sourceCoherence?.matches!==true||sameOwner(i)||i.pendingTravel||i.survivalRecovery||routePaymentBlocks(i,now))return {ok:false,reason:'fresh exclusive safe field owner required'};
  const native=candidate.travelMs,duration=480000+300000+2*native+60000;
  if(!Number.isFinite(duration)||duration>1500000)return {ok:false,reason:'trial travel cannot fit bounded window'};
  const budget=this.data.observedMs*.05-this.data.explorationMs,bootstrap=budget<duration;
  if(bootstrap&&(duration>900000||this.data.rows.some(r=>r.bootstrap&&now-r.at<86400000)))return {ok:false,reason:'5 percent exploration budget; bootstrap allowance already used or route too long'};
  if(!this.acquire(now+duration,bootstrap,now))return {ok:false,reason:'host experiment lease or bootstrap budget held'};
  const r={id:crypto.randomUUID(),purpose:'route',actorId:this.actorId,at:now,startedAt:now,build,signature:routeContext(build,i.lastSave),status:'running',phase:'treatment',baseline:key(baseline),candidate:key(candidate),baselineMap:baseline.mapId,candidateMap:candidate.mapId,baselineGoal:{...baseline},candidateGoal:{...candidate},baselineRate:evidence.expPerHour,baselineBasis:'whole_route',deadline:now+duration,bootstrap,maxSpend:0,minimumGain:.2,coverageMinimum:.9,causalVerified:false,novel:candidate.kills===0};
  this.data.rows.unshift(r);this.data.rows=this.data.rows.slice(0,60);this.data.lastProbeAt=now;
  try{this.persist();}catch(e){this.data.rows.shift();this.release();throw e;}return {ok:true,id:r.id};
 }
 select(i,build,rows,now=this.now()){
  this.observe(i,build,now);const r=this.active();if(!r)return null;
  const target=r.phase==='confirmation'?r.baselineGoal:r.candidateGoal;
  const goal=rows.find(g=>key(g)===key(target))||target;
  const start=r.phase==='confirmation'?r.confirmAt:r.at;
  const w=i.v2?.expRouteEvidence?.window(i.lastSave,build,goal,start),wall=now-start;
  if(w?.deaths>0||w?.expLossEvents>0||w?.netExp<0){this.finish('safety_abort','death or EXP loss observed');return r.baselineGoal;}
  const minimum=r.phase==='confirmation'?300000:480000;
  if(w?.confidence!=='observational'||w.fieldMs<minimum||wall<=0)return goal;
  const rate=w.netExp*3600000/wall,coverage=w.knownMs/wall;
  if(coverage<.9){this.finish('inconclusive','insufficient whole-window coverage');return r.baselineGoal;}
  if(r.phase==='treatment'){
   r.candidateRate=rate;r.candidateCoverage=coverage;r.candidateWindow=w;
   if(rate<r.baselineRate*1.2){this.finish('rejected','whole-time gain below predeclared20 percent');return r.baselineGoal;}
   r.phase='confirmation';r.confirmAt=now;this.persist();return r.baselineGoal;
  }
  r.confirmationRate=rate;r.confirmationCoverage=coverage;
  const stable=Math.abs(rate-r.baselineRate)/r.baselineRate<=.25;
  const accepted=stable&&r.candidateRate>=Math.max(rate,r.baselineRate)*1.2;
  this.finish(accepted?'accepted':'inconclusive',accepted?'A/B/A whole-time comparison passed':'baseline drift; attribution remains inconclusive');return accepted?r.candidateGoal:r.baselineGoal;
 }
 finish(status,reason){const r=this.active();if(!r)return;r.status=status;r.reason=reason;r.finishedAt=this.currentTime??this.now();r.wallExposureMs=Math.max(0,Math.min(r.finishedAt,r.deadline)-r.at);this.data.explorationMs+=Math.max(0,r.wallExposureMs-(r.chargedMs||0));r.chargedMs=Math.max(r.chargedMs||0,r.wallExposureMs);r.rollbackRequired=status!=='accepted';r.relativeGain=r.candidateRate? r.candidateRate/r.baselineRate-1:null;if(status!=='accepted')this.data.cooldowns[r.candidate]=r.finishedAt+3600000;this.data.policyEvidence=require('./policy-evidence').assess(this.data.rows,{actorId:this.actorId,build:r.build,signature:r.signature,candidate:r.candidate,now:r.finishedAt,minimumGain:r.minimumGain});this.persist();
  // Keep the last bootstrap timestamp after the lease is released.
  if(this.lock)try{const l=JSON.parse(fs.readFileSync(this.lock));if(l.owner===this.owner||l.file===this.file){l.deadline=0;fs.writeFileSync(this.lock,JSON.stringify(l));}}catch{}
 }
 view(){return {version:3,policyEvidence:this.data.policyEvidence||null,owner:'single_route_governor',active:this.active()||null,rows:this.data.rows.slice(0,4),observedMs:this.data.observedMs,explorationMs:this.data.explorationMs,maxExplorationFraction:.05,bootstrapAllowanceMs:900000,limits:'A/B/A nonrandomized native-save evidence; no global optimality or causal proof'};}
}
module.exports={ExperimentGovernor,measurable,routePaymentBlocks,controlSafe};
