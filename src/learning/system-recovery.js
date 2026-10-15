'use strict';
// The AI and resident controller share this single host repair queue. Slow
// source collection/tests run in a separate process; game owners remain intact.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const read=file=>{try{return JSON.parse(fs.readFileSync(file));}catch{return null;}};
function need(snapshot,now=Date.now(),serverHealth){
 const at=Date.parse(snapshot?.at),v=snapshot?.gameKnowledge?.systemVersion;
 if(Number.isFinite(at)&&now-at>=0&&now-at<=45000&&v&&serverHealth?.authority==='direct_server_health'&&serverHealth.ok===true&&require('../knowledge/build-id').hashBuild(serverHealth.build)&&Number.isFinite(serverHealth.at)&&now-serverHealth.at>=0&&now-serverHealth.at<=120000&&serverHealth.build!==v.build)return {build:serverHealth.build,key:hash([serverHealth.build,v.sourceRevision]),reason:'native_server_build_changed'};
 if(!Number.isFinite(at)||now-at<0||now-at>45000||!v?.liveFresh||!require('../knowledge/build-id').valid(v.liveBuild))return null;
 if(v.sourceMatches!==false&&v.wikiCurrent!==false&&v.architectureCurrent!==false)return null;
 return {build:v.liveBuild,key:hash([v.liveBuild,v.sourceRevision,snapshot.gameKnowledge.current?.sourceHashes||null]),reason:v.sourceMatches===false?'loaded_game_source_mismatch':v.wikiCurrent===false?'wiki_review_required':'current_release_review_required'};
}
class SystemRecovery{
 constructor(root,machine,{launch,now=Date.now}={}){this.root=root;this.machine=machine;this.now=now;this.launch=launch;this.busy=false;this.file=path.join(root,'logs/ai-system/controller.json');this.state=read(this.file)||{attempts:[],history:[]};}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});require('../runtime/telemetry-file').writeTelemetry(this.file,this.state);}
 view(){return {...this.state,busy:this.busy,worker:read(path.join(this.root,'logs/ai-system/review.json'))};}
 observeServerHealth(health){if(health?.ok===true&&require('../knowledge/build-id').hashBuild(health.build)){this.state.serverHealth={authority:'direct_server_health',ok:true,build:health.build,at:this.now()};this.save();}}
 async tick({enabled,farm}={}){
  const now=this.now();if(!enabled||!farm?.ready){return {...this.view(),mode:'inactive'};}
  const snapshot=read(path.join(this.root,'logs/status.json')),task=need(snapshot,now,this.state.serverHealth);if(!task){
   const v=snapshot?.gameKnowledge?.systemVersion,at=Date.parse(snapshot?.at);
   if(!this.busy&&now-at>=0&&now-at<=45000&&v?.liveFresh&&v.sourceMatches===true&&v.wikiCurrent===true&&v.architectureCurrent===true&&v.build===v.liveBuild){this.state.mode='verified_current';this.state.verifiedAt=now;this.state.loadedBuild=v.build;this.state.reason='fresh native loaded source, Wiki and reviewed app manifest agree; combat benefit not inferred';if(this.state.command){this.state.command.state='verified';this.state.command.evidence='fresh_native_source_alignment';}this.save();}
   return this.view();
  }
  this.state.need=task;const recent=(this.state.attempts||[]).filter(r=>r.key===task.key&&now-r.at>=0&&now-r.at<3600000);
  if(this.busy||recent.some(r=>now-r.at<600000)||recent.length>=3)return this.view();
  // Fail closed on mixed app source; the worker cannot approve its own source.
  const approval=require('../runtime/client-refresh').applicationApproval(this.root);
  if(!approval.allowed){this.state.mode='application_review_required';this.state.reason=approval.reason;this.save();return this.view();}
  const intent=read(path.join(this.root,'logs/host-intent.json'));
  if(intent?.mode!=='running'||!Number.isSafeInteger(intent.revision))return this.view();
  this.busy=true;this.state.mode='reviewing';this.state.attempts=[{key:task.key,at:now},...(this.state.attempts||[])].slice(0,24);this.save();
  try{await this.launch({machine:this.machine,build:task.build,sourceRevision:approval.sourceRevision,intentRevision:intent.revision});this.state.mode='awaiting_native_reload';this.state.reason='semantic public contracts approved; rolling per-actor native refresh pending without farm stop';}
  catch(e){this.state.mode='review_failed';this.state.reason='review failed; running farm and uncertain records preserved';this.state.errorHash=hash(String(e.message));}
  finally{this.busy=false;this.state.history=[{at:this.now(),mode:this.state.mode,key:task.key},...(this.state.history||[])].slice(0,32);this.save();}
  return this.view();
 }
 request(command,{enabled,farm}={}){
  const now=this.now(),s=read(path.join(this.root,'logs/status.json')),row=s?.instances?.find(r=>r.slot===command.slot&&r.identity?.actorId===command.actorId),p=command.proposal;
  if(!enabled||!farm?.ready||command.action!=='sync_game'||!row||row.status!=='playing'||now-row.lastSaveAt<0||now-row.lastSaveAt>30000||!need(s,now)||command.build!==s.gameKnowledge.systemVersion.build||!Number.isFinite(command.expiresAt)||command.expiresAt<=now||p?.actorId!==command.actorId||p.build!==command.build||p.version!==2||p.maxSpend!==0||p.stopRule?.stopOnUncertain!==true||p.expiresAt<=now)return {ok:false,status:'system repair requires current actor, build, intent and bounded proposal'};
  if(this.state.command?.id===command.id)return {ok:true,status:'existing system review retained; no duplicate worker'};
  this.state.command={id:command.id,actorId:command.actorId,build:command.build,at:now,state:'queued',evidence:'system_review_requested_not_repaired'};this.save();
  this.tick({enabled,farm}).catch(()=>{});return {ok:true,status:'เข้าคิวตรวจรุ่นเกมและทดสอบระบบ · รอยืนยันโหลดจริง'};
 }
}
module.exports={SystemRecovery,need};
