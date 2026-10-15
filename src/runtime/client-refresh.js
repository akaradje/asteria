'use strict';
const {roomPolicy}=require('./room-policy');
const sourceKeys=['client','world','network'];
const validHashes=hashes=>sourceKeys.every(k=>/^[a-f0-9]{64}$/.test(hashes?.[k]||''));
function historicalIdleTrade(i,now){
 const t=i?.teamTradeStatus,p=t?.idleNavigationEvidence;
 if(p?.kind==='fresh_native_idle_after_closed_outcome_readback'){const q=p.serverReadback;return t.phase==='UNCERTAIN'&&t.navigationReleased===true&&p.outcome==='unknown'&&p.replayBlocked===true&&q?.authority==='server_readback'&&q.actorId===i.identity?.actorId&&q.build===i.runtimeV2?.loadedSourceIdentity?.build&&q.sessionStartedAt===i.runtimeV2?.sessionStartedAt&&q.generation===i.runtimeV2?.generation&&q.requestAt>=Math.max(t.idleAfter||0,t.doneAt||0)&&q.at>=q.requestAt&&now-q.at>=0&&now-q.at<30000&&i.tradeAvailability?.clear===true&&now-i.tradeAvailability.at>=0&&now-i.tradeAvailability.at<15000;}
 return t?.phase==='UNCERTAIN'&&t.navigationReleased===true&&t.confirmationSent===false&&t.receiptId==null&&Number.isFinite(t.idleAfter)&&p?.kind==='fresh_native_idle_after_deadline_no_confirmation'&&p.outcome==='unknown'&&p.replayBlocked===true&&Number.isFinite(p.at)&&p.at<=now&&Number.isFinite(p.saveAt)&&p.saveAt>t.idleAfter&&p.saveAt<=p.at&&i.lastSaveAt>=p.saveAt&&i.tradeAvailability?.clear===true&&Number.isFinite(i.tradeAvailability.at)&&now-i.tradeAvailability.at>=0&&now-i.tradeAvailability.at<15000;
}
function historicalClosedPurchase(row,instance,now){
 const proof=row?.closedSessionEvidence,session=instance?.runtimeV2?.sessionStartedAt;
 return row?.kind==='purchase'&&row.status==='UNCERTAIN'&&!row.externalOwner&&Number.isFinite(row.at)&&Number.isFinite(session)&&session>row.at&&proof?.kind==='authoritative_server_load_after_session_restart'&&proof.sessionStartedAt===session&&Number.isFinite(proof.at)&&proof.at>session&&proof.at<=now&&Number.isInteger(proof.rev)&&proof.rev>=0&&proof.outcome==='unknown'&&proof.replayBlocked===true;
}
function healthFromKnowledge(snapshot,{now=Date.now(),startedAt=0}={}){
 const at=Date.parse(snapshot?.at),k=snapshot?.gameKnowledge,c=k?.current;
 if(!startedAt||!Number.isFinite(at)||at<startedAt||now-at<0||now-at>=45000||k?.lastError)return null;
 if(!require('../knowledge/build-id').valid(c?.build)||c.build!==k.liveBuild||c.evidence!=='downloaded_client_sources'||!validHashes(c.sourceHashes))return null;
 // current.at is the successful final health confirmation; checkedAt can be
 // advanced by a later failed/incomplete collection and cannot replace it.
 if(!Number.isFinite(c.at)||c.at<startedAt||now-c.at<0||now-c.at>=300000)return null;
 const collection=k.collection;
 if(!Number.isFinite(collection?.at)||collection.at<startedAt||collection.at>c.at||now-collection.at>=300000)return null;
 if(!['html','world','network','wiki'].every(key=>collection.sources?.[key]?.status==='received'||key==='html'&&collection.sources?.[key]?.status==='verified_staged_cache'))return null;
 return {ok:true,build:c.build,evidence:'verified_current_run_source_collection',observedAt:c.at};
}
function loadedBuild(snapshot,telemetry,{machine,now=Date.now(),startedAt=0}={}){
 if(telemetry&&Number.isFinite(telemetry.at)&&telemetry.at>=startedAt&&now-telemetry.at>=0&&now-telemetry.at<15000)return telemetry.build||null;
 const at=Date.parse(snapshot?.at);
 if(!['windows','tum','vps'].includes(machine)||!startedAt||!Number.isFinite(at)||at<startedAt||now-at<0||now-at>=45000)return null;
 const sources=(snapshot.instances||[]).map(i=>i.runtimeV2?.loadedSourceIdentity);
 return sources.length&&sources.every(s=>require('../knowledge/build-id').valid(s?.build)&&s.build===sources[0].build&&validHashes(s.sourceHashes)&&sourceKeys.every(k=>s.sourceHashes[k]===sources[0].sourceHashes[k]))?sources[0].build:null;
}
class ClientRefresh{
 constructor(state={}){this.state={attempts:[],history:[],...state};}
 inspect(health,snapshot,loadedBuild,{now=Date.now(),startedAt=0,running=false,enabled=false,rolling=false}={}){
  const wait=reason=>{this.state.status='waiting';this.state.reason=reason;return {action:'wait',reason};};
  this.state.checkedAt=now;this.state.loadedBuild=loadedBuild||null;this.state.liveBuild=health?.build||null;
  if(!enabled||!running){this.state.status='inactive';return {action:'none'};}
  if(!health?.ok||!require('../knowledge/build-id').valid(health.build)){this.state.candidate=null;return wait('server build unavailable');}
  if(!require('../knowledge/build-id').valid(loadedBuild))return wait('fresh loaded client build required');
  const knowledge=snapshot?.gameKnowledge,coherence=knowledge?.sourceCoherence;
  const freshSource=knowledge?.current?.build===health.build&&!knowledge.lastError&&Number.isFinite(knowledge.checkedAt)&&now-knowledge.checkedAt>=0&&now-knowledge.checkedAt<900000;
  const keys=['client','world','network'],hashes=knowledge?.current?.sourceHashes;
  const actorChanged=freshSource&&keys.every(k=>/^[a-f0-9]{64}$/.test(hashes?.[k]||''))&&(snapshot?.instances||[]).some(i=>{const source=i.runtimeV2?.loadedSourceIdentity;return source?.build===loadedBuild&&keys.every(k=>/^[a-f0-9]{64}$/.test(source.sourceHashes?.[k]||''))&&keys.some(k=>source.sourceHashes[k]!==hashes[k]);});
  const diskChanged=coherence?.loadedBuild===loadedBuild&&coherence.liveBuild===health.build&&coherence.matches===false&&coherence.mismatched?.some(k=>keys.includes(k));
  const contentChanged=health.build===loadedBuild&&freshSource&&(diskChanged||actorChanged);
  if(health.build===loadedBuild&&!contentChanged){this.state.candidate=null;this.state.status='current';this.state.reason=null;return {action:'none'};}
  const candidateKey=health.build+(contentChanged?':'+knowledge.current.id:'');
  if(this.state.candidate?.key!==candidateKey)this.state.candidate={build:health.build,key:candidateKey,firstAt:now};
  if(now-this.state.candidate.firstAt<30000)return wait('confirming stable server build');
  const recent=this.state.attempts.filter(at=>now>=at&&now-at<3600000);
  if(recent.length>=3||recent.some(at=>now-at<600000))return wait('client refresh cooldown');
  const at=Date.parse(snapshot?.at);
  if(!startedAt||now-startedAt<60000||!Number.isFinite(at)||at<startedAt||now-at<0||now-at>45000)return wait('fresh current farm snapshot required');
  const rows=snapshot.instances||[];
  if(!rows.length||!rolling&&rows.some(i=>i.status!=='playing'||i.recycling||!Number.isFinite(i.lastSaveAt)||now-i.lastSaveAt<0||now-i.lastSaveAt>=30000))return wait('farm warming up or save stale');
  const candidates=rolling?rows.filter(i=>require('./rolling-client-refresh').safe(i,now)):rows;
  if(!candidates.length)return wait('waiting for one owned idle actor');
  for(const i of candidates){
   const rooms=[i.runtimeV2?.roomPolicy?.room,i.mapId];
   if(rooms.some(room=>roomPolicy(room).dungeon))return wait('protected dungeon or arena');
   if(['MAINTENANCE','RECOVERING','PREPARING','STOPPING','TEAM_TRADE','DUNGEON','PVP_MISSION'].includes(i.runtimeV2?.phase))return wait('active maintenance or team activity');
   if(i.developmentProgress?.pending||(i.development||[]).some(r=>r.status==='pending'))return wait('paid outcome awaiting reconciliation');
   if((i.runtimeV2?.purchases||[]).some(r=>['STARTED','SENT','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status)&&!historicalClosedPurchase(r,i,now)))return wait('paid outcome awaiting reconciliation');
   if(i.dailyWorkStatus?.ownsNavigation||i.dailyActivities?.workPolicy?.ownsNavigation)return wait('active maintenance or team activity');
   const trade=i.teamTradeStatus?.phase;
   if(trade&&!['IDLE','CONFIRMED','CANCELLED'].includes(trade)&&!historicalIdleTrade(i,now))return wait('team trade awaiting reconciliation');
  }
  this.state.status='ready';this.state.reason=contentChanged?'same build client source changed; safe reload required':'stable live build differs from loaded client';return {action:'refresh',build:health.build,revision:contentChanged?knowledge.current.id:null,reason:this.state.reason};
 }
 attempt(build,now=Date.now()){this.state.attempts=[now,...this.state.attempts].slice(0,12);this.record('stopping-for-refresh',{build},now);}
 record(status,extra={},now=Date.now()){this.state.status=status;this.state.history=[{at:now,status,...extra},...this.state.history].slice(0,40);}
 view(){return this.state;}
}
function applicationApproval(root){
 try{
  const fs=require('node:fs'),path=require('node:path');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'logs/system-audit/architecture-release.json'),'utf8'));
  // A resident panel can retain an older inventory boundary after a source rollout.
  // Load the reviewed disk implementation synchronously, restore the prior cache,
  // and never execute an inventory module whose bytes differ from the manifest.
  const file=require.resolve('../knowledge/system-version'),crypto=require('node:crypto');
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==manifest.hashes?.['src/knowledge/system-version.js'])return {allowed:false,reason:'inventory implementation differs from reviewed source'};
  const previous=require.cache[file];let sourceRevision;
  try{delete require.cache[file];sourceRevision=require(file).inventory(root).revision;}
  finally{delete require.cache[file];if(previous)require.cache[file]=previous;}

  if(manifest.plan!=='V3.2'||manifest.stages?.sourceChecks!=='PASSED'||manifest.sourceRevision!==sourceRevision||manifest.testEvidence?.sourceRevision!==sourceRevision)return {allowed:false,reason:'automatic reload requires checked application source'};
  // Game assets/build may change independently. Domain gates still review those
  // changes; this guard prevents a game refresh loading half-edited app code.
  return {allowed:true,sourceRevision};
 }catch{return {allowed:false,reason:'application review manifest unavailable'};}
}
async function reload({stop,start,options,currentRevision,revision,approvedApplication}){
 const approval=approvedApplication?.();
 if(approvedApplication&&approval?.allowed!==true)return {ok:false,reason:approval?.reason||'application source approval required'};
 const result=await stop();
 if(result?.ok!==true)throw Error('client refresh stop rejected');
 if(currentRevision()!==revision)return {ok:false,reason:'manual control changed; automatic start cancelled'};
 if(approvedApplication){const next=approvedApplication();if(next?.allowed!==true||next.sourceRevision!==approval.sourceRevision)return {ok:false,reason:'application source changed while draining; automatic start cancelled'};}
 return start(options);
}
module.exports={ClientRefresh,reload,applicationApproval,loadedBuild,healthFromKnowledge,historicalClosedPurchase,historicalIdleTrade};
