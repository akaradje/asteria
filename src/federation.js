'use strict';
const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const read=p=>{try{return JSON.parse(fs.readFileSync(p));}catch{return null;}};
function validate(config){
 const rows=config?.members||[],jobs=new Set(rows.map(r=>r.baseJob)),names=new Set(rows.map(r=>r.charName));
 if(rows.length!==6||jobs.size!==6||names.size!==6||!rows.some(r=>r.charName===config.leader))throw Error('Federation requires six distinct characters/classes and one known leader');
 if(rows.some(r=>!['windows','tum'].includes(r.machine)))throw Error('Unknown federation machine');
 for(const machine of ['windows','tum']){
  const assigned=rows.filter(r=>r.machine===machine),slots=assigned.map(r=>r.slot).sort((a,b)=>a-b);
  if(!assigned.length||slots.some((slot,i)=>slot!==i))throw Error('Federation requires contiguous unique slots per machine');
 }
 return config;
}
function safeMember(i){const work=require('./planning/team-workboard').project(i);return {identity:i.registryV32?.public(i.actorIdentity)||null,classSupport:require('./runtime/class-support-peer').project(i),runtimeGeneration:i.v2?.observations?.sessionId||null,slot:i.slot,charName:i.credentials?.charName||i.character?.name,status:i.status,job:i.lastSave?.job,lv:i.lastSave?.lv,lastSaveAt:i.lastSaveAt,teamPartyId:i.teamPartyId||null,teamInventory:require('./planning/team-trade').inventory(i,work),teamWork:work,actionOwner:i.teamControl?'activity':null,teamTradeStatus:i.teamTradeStatus||null,tradeAvailability:i.tradeAvailability?{at:i.tradeAvailability.at,clear:i.tradeAvailability.clear===true}:null,
 livePos:i.livePos?Object.fromEntries(['room','x','z','at','dead'].map(k=>[k,i.livePos[k]])):null,vitals:i.vitals?{hp:i.vitals.hp,mp:i.vitals.mp,at:i.vitals.at}:null,recycling:!!i.recycling,performance:{fps:i.lastFps??null,at:i.lastFpsAt||null},goal:i.goal?{mapId:i.goal.mapId,label:i.goal.label}:null,readiness:i.readiness?{at:i.readiness.at,ready:i.readiness.ready,reasons:i.readiness.reasons}:null,activityState:require('./planning/fleet-activity').publicActivity(i),activityDispatchResult:require('./planning/fleet-activity').publicDispatch(i),workflowAck:i.workflowAck||null,activityResult:i.activityEvidence?.data.rows.find(r=>r.runId&&(!i.fleetActivityIntent?.runId||r.runId===i.fleetActivityIntent.runId)&&['twreward','dgreward'].includes(r.type))||null,recovery:i.v2?.recovery?.view()?.[0]||null,memory:{jsHeapMb:i.lastHeapMB||null,at:i.v2?.lastScreenAt||null,scope:'renderer_js_heap_not_total_process_ram'}};}
class Federation{
 constructor(root,machine,{now=Date.now,log=()=>{}}={}){this.root=root;this.machine=machine;this.now=now;this.log=log;this.localScope=require('./planning/host-team-scope').team(root,machine);this.coordinator=!!this.localScope||machine==='tum';this.config=this.localScope||validate(read(path.join(root,'machines/fleet.json')));this.dir=path.join(root,'logs/fleet');fs.mkdirSync(this.dir,{recursive:true});this.busy=false;this.daily=new(require('./planning/daily-team-activities').DailyActivities)(root,(this.localScope||require('./planning/cross-party').roster(root)),{now});this.cooperationConfig=(this.localScope||require('./planning/cross-party').roster(root));this.workboard=new(require('./planning/team-workboard').TeamWorkboard)(root,this.cooperationConfig,{now});this.activity=new(require("./planning/fleet-activity").FleetActivity)(root,this.config,machine,{now});this.trade=new(require("./runtime/team-trade").TeamTrade)(root,this.cooperationConfig,machine);}
 save(file,data){
  const result=require('./runtime/telemetry-file').writeTelemetry(file,data);
  this.persistenceFailures ||= new Map();
  if(result.ok){this.persistenceFailures.delete(path.basename(file));return true;}
  const previous=this.persistenceFailures.get(result.file);
  const now=this.now();
  this.persistenceFailures.set(result.file,{...result,at:now,firstAt:previous?.firstAt||now});
  if(!previous||now-(previous.loggedAt||0)>=60000){
   this.persistenceFailures.get(result.file).loggedAt=now;
   this.log('fleet snapshot deferred: '+result.file+' '+result.code+'; keeping last complete file','warn');
  }else this.persistenceFailures.get(result.file).loggedAt=previous.loggedAt;
  return false;
 }
 publish(instances,party,build){if(this.coordinator)this.daily.reloadControls(this.activity);const current={tradeWorkflow:this.coordinator?(this.trade?.view()||this.local?.tradeWorkflow):null,machine:this.machine,at:this.now(),build,party,members:instances.filter(Boolean).map(safeMember)};if(this.coordinator)this.workboard.reconcile(this.sources(current),require('./economy').loadWiki(this.root));const board=this.coordinator?this.workboard.state:this.remote()?.workboard;for(const i of instances.filter(Boolean))i.teamWorkboard=board||null;if(this.coordinator)this.activity.reconcile(this.sources(current),party);if(this.coordinator)this.daily.reconcile(this.sources(current),this.activity,build,{tradeActive:this.trade?.state?.offer&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(this.trade.state.phase)});this.trade||=new(require('./runtime/team-trade').TeamTrade)(this.root,this.config,this.machine);if(this.coordinator){const instance=instances.find(i=>i?.status==='playing'&&typeof i.catalog==='function');if(instance)this.trade.reconcile(this.sources(current),instance.catalog(),this.now(),{activityActive:!['IDLE','COMPLETE','FINISHED','WITHDRAWN','UNCERTAIN'].includes(this.activity.state.phase)||require('./planning/daily-work-policy').dailyWorkPolicy(this.daily.view,this.activity.state,build,this.now()).reserve});}const intent=this.coordinator?this.trade.view():this.remote()?.tradeWorkflow;for(const i of instances.filter(Boolean)){i.teamTradeIntent=intent;i.dailyActivities=this.coordinator?this.daily.view:this.remote()?.dailyActivities||null;i.dailyActivitiesRequired=i.dailyActivities?.enabled===true;i.activityAutomationPaused=i.dailyActivities?.enabled!==true;}this.local={guild:this.coordinator?this.guild||null:null,machine:this.machine,at:this.now(),build,tradeWorkflow:this.coordinator?intent:null,workflow:this.coordinator?this.activity.view():null,dailyActivities:this.coordinator?this.daily.view||null:null,workboard:this.coordinator?board:null,party:party?{id:party.id,leader:party.leader,members:party.members,checkedAt:party.checkedAt}:null,members:current.members};this.save(path.join(this.dir,'local.json'),this.local);this.save(path.join(this.dir,'view.json'),this.view());}
 sources(current){return this.localScope?[current]:[current,this.remote(),...require('./planning/cross-party').sources(this.root,this.now(),[this.machine,this.machine==='windows'?'tum':'windows'])].filter(Boolean);}
 remote(){if(this.localScope)return null;const other=this.machine==='windows'?'tum':'windows';return require('./registry/topology').peer(this.root,other,this.now());}
 peers(instances){const remote=this.remote(),offset=this.config.members.filter(r=>r.machine===this.machine).length,owner=instances.find(i=>typeof i?.catalog==='function');return [...instances.filter(Boolean),...(remote?.members||[]).filter(m=>this.config.members.some(r=>r.machine===remote.machine&&r.charName===m.charName)).map(m=>({...m,...(remote&&require('./runtime/class-support-peer').wrap(m,remote,owner,this.now())||{}),slot:m.slot+offset,lastSave:remote&&require('./runtime/class-support-peer').wrap(m,remote,owner,this.now())?.lastSave||{job:m.job,lv:m.lv},credentials:{charName:m.charName},remoteMachine:remote.machine}))];}
 view(){const remote=this.remote(),sources=[this.local,remote].filter(Boolean),members=this.config.members.map(r=>{const source=sources.find(s=>s.machine===r.machine),m=source?.members.find(m=>m.charName===r.charName);return {...r,status:m?.status||'unknown',job:m?.job||null,lv:m?.lv||null,online:!!m&&m.status==='playing'&&!m.recycling&&this.now()-m.lastSaveAt<30000,map:m?.livePos?.room||null,partyId:m?.teamPartyId||null};});const party=sources.map(s=>s.party).find(p=>p?.leader===this.config.leader&&this.now()-p.checkedAt<90000);return {at:this.now(),leader:this.config.leader,expected:this.config.members.length,scope:this.localScope?'host':'fleet',coordinatorHost:this.localScope?this.machine:'tum',online:members.filter(m=>m.online).length,members,party:party||null,complete:members.every(m=>m.online)&&!!party&&members.every(m=>party.members.includes(m.charName)&&m.partyId===party.id)&&(!this.localScope||party.members.every(n=>this.config.members.some(m=>m.charName===n))),dailyActivities:this.coordinator?this.daily.view:remote?.dailyActivities||null,workboard:this.coordinator?this.workboard.state:remote?.workboard||null,director:require("./team-director").direct(this.config,sources,this.now()),persistenceHealth:{ok:!this.persistenceFailures?.size,failures:[...(this.persistenceFailures?.values()||[])]},linkError:this.lastError||(this.persistenceFailures?.size?'การบันทึกข้อมูลทีมถูกเลื่อน: '+[...this.persistenceFailures.keys()].join(', '):null)};}
 async exchange(){if(this.localScope)return;if(this.machine!=='windows'||!this.local)return;if(this.busy){this.exchangeQueued=true;return;}this.busy=true;const sentAt=this.now(),sourceAt=this.local.at;let succeeded=false;
  try{const {host,exchange}=this.config.ssh;if(!/^[\w.@-]+$/.test(host)||!/^\/[\w/.-]+$/.test(exchange))throw Error('Invalid federation SSH target');
   const expansion=require('./planning/cross-party').source(this.root,this.now());const payload=Buffer.from(JSON.stringify({...this.local,...(expansion?{expansion}:{})}));if(payload.length>48000)throw Error('Fleet telemetry too large');
   const remote=await new Promise((resolve,reject)=>{require('./runtime/fleet-transport').sshCapture(['-n','-o','BatchMode=yes','-o','ConnectTimeout=5',host,'python3',exchange,require('./runtime/fleet-transport').encodeCompressed(JSON.parse(payload))],{cwd:this.root,windowsHide:true,timeout:10000,maxBuffer:200000},(error,out)=>{if(error)return reject(Error('Fleet SSH exchange unavailable ('+(error.code||'TRANSPORT_ERROR')+')'));try{resolve(require('./runtime/fleet-transport').decode(out));}catch{reject(Error('Invalid fleet response'));}});});
   if(remote.machine!=='tum'||!Array.isArray(remote.members)||remote.members.length>this.config.members.filter(r=>r.machine==='tum').length||remote.members.some(m=>!this.config.members.some(r=>r.machine==='tum'&&r.slot===m.slot&&r.charName===m.charName)))throw Error('Unexpected remote roster');
   this.save(path.join(this.dir,'tum.json'),remote);this.lastError=null;succeeded=true;this.linkHealth={at:this.now(),sentAt,receivedAt:this.now(),durationMs:this.now()-sentAt,remoteAt:remote.at,consecutiveFailures:0,totalFailures:this.linkHealth?.totalFailures||0,status:'connected'};
  }catch(e){this.lastError=e.message;this.linkHealth={...this.linkHealth,at:this.now(),sentAt,durationMs:this.now()-sentAt,status:'failed',consecutiveFailures:(this.linkHealth?.consecutiveFailures||0)+1,totalFailures:(this.linkHealth?.totalFailures||0)+1,error:e.message};}finally{this.busy=false;this.save(path.join(this.dir,'link-health.json'),this.linkHealth);this.save(path.join(this.dir,'view.json'),{...this.view(),linkHealth:this.linkHealth});const queued=this.exchangeQueued;this.exchangeQueued=false;if(succeeded&&queued&&this.local.at>sourceAt)setImmediate(()=>this.exchange().catch(e=>this.log(e.message)));}
 }
 async accept(instance){const invite=(await instance.socialFrames('pinvite',this.now()-60000)).filter(m=>m.name===this.config.leader).at(-1);if(!invite||invite.from==null)return false;if(instance.acceptedPartyInvite?.from===invite.from&&this.now()-instance.acceptedPartyInvite.at<60000)return false;instance.acceptedPartyInvite={from:invite.from,at:this.now()};const sent=await instance.socialSend('pans',{from:invite.from,ok:true});if(sent?.ok===false){instance.acceptedPartyInvite=null;return false;}return true;}
 refreshDailyQuotas(farm){
  const build=farm.cache?.dir?path.basename(farm.cache.dir):this.local?.build;
  for(const i of farm.instances.filter(i=>i&&i.status==='playing'&&!i.recycling&&i.credentials?.charName)){
   i.dailyActivitiesRequired=this.daily.policy.enabled===true;
   i.dailyRallyKind=(this.coordinator?this.daily.controls:this.remote()?.dailyActivities?.controls)?.request?.kind||null;
   require('./runtime/daily-quota-poll').refreshDailyQuotas(i,build,()=>this.now(),this.log);
  }
 }
 refreshTeamActivities(farm){
  const live=farm.instances.filter(i=>i&&i.status==='playing'&&!i.recycling&&i.credentials?.charName);
  const build=farm.cache?.dir?path.basename(farm.cache.dir):this.local?.build;
  const intent=this.coordinator?this.activity.view():this.remote()?.workflow;
  const release=this.daily.gate(build,{manual:!!(intent?.requestId||intent?.openAt||intent?.runId),kind:intent?.kind});
  const dailyView=this.coordinator?this.daily.view:this.remote()?.dailyActivities;
  for(const i of live){
   const participating=!intent?.participants||intent.participants.some(m=>m.machine===this.machine&&m.slot===i.slot&&(!m.actorId||m.actorId===i.actorIdentity?.actorId));i.dailyWorkStatus=require('./planning/daily-work-policy').dailyWorkPolicy(dailyView,participating?intent:null,build,this.now());
   // A personal remaining quota alone must not reserve this actor forever.
   // Only a fresh, accepted six-member workflow owns gathering/preparation.
   i.dailyTeamPending=release.allowed&&i.dailyWorkStatus.reserve;
   if(!release.allowed){i.teamControl=false;continue;}if(i.fleetActivityBusy)continue;i.fleetActivityBusy=true;
   Promise.resolve().then(()=>this.activity.act(i,intent,build)).catch(e=>this.log('daily activity: '+i.credentials.charName+' '+e.message,'warn')).finally(()=>{i.fleetActivityBusy=false;});
  }
  farm.towerInfo={...(intent||{phase:'waiting'}),daily:this.coordinator?this.daily.view:this.remote()?.dailyActivities,reason:release.allowed?intent?.reason:release.reason,at:this.now()};
 }
 async partyRound(farm){
  const live=farm.instances.filter(i=>i&&i.status==='playing'&&i.credentials?.charName);
  const leader=live.find(i=>i.credentials.charName===this.config.leader);
  if(this.localScope){
   const names=new Set(this.config.members.map(m=>m.charName));
   for(const i of live){
    if(i.recycling||/^(tw|dx|gd|pv)/.test(i.livePos?.room||'')||Object.values(i.activityState||{}).some(s=>s?.run?.member&&!s.run.done))continue;
    const p=await i.partyState();
    if(p?.members?.some(m=>!names.has(m.name))&&require('./runtime/party-evidence').observedAt(p,this.now())!==null){
     if(!i.hostPartyLeaveAt||this.now()-i.hostPartyLeaveAt>=60000){i.hostPartyLeaveAt=this.now();await i.partyLeave();i.partyResync=null;}
     return; // Require the next native party frame before inviting only our own actors.
    }
   }
  }
  for(const i of live){
   if(i===leader)continue;
   // Party frames use only the socket; they do not move or operate town UI.
   // Waiting behind a long town tick would expire the server's 60-second invite.
   if(/^(tw|dx|gd|pv)/.test(i.livePos?.room||''))continue;await(async()=>{const current=await i.partyState(),name=current?.members?.find(m=>m.aid===current.leader)?.name;
    if(current&&name!==this.config.leader){await i.partyLeave();i.partyResync=null;return;}
    if(name!==this.config.leader){
     const accepted=await this.accept(i), remote=this.remote(), roster=this.coordinator?this.local?.party:remote?.party;
     // A reconnect may retain server membership without replaying the party frame.
     // Rejoin only this character, after fresh leader evidence and a bounded wait.
     const listed=roster?.leader===this.config.leader&&this.now()-roster.checkedAt>=-5000&&this.now()-roster.checkedAt<90000&&roster.members?.includes(i.credentials.charName);
     if(!current&&!accepted&&listed){
      i.partyResync ||= {since:this.now(),attempts:[]};
      const recovery=i.partyResync;recovery.attempts=recovery.attempts.filter(at=>this.now()-at<900000);
      if(this.now()-recovery.since>=60000&&recovery.attempts.length<3&&(!recovery.attempts.length||this.now()-recovery.attempts.at(-1)>=180000)){
       recovery.attempts.push(this.now());await i.partyLeave();
       i.log?.('party recovery: fresh leader lists this character but local party frame is missing; rejoin this character only','warn');
      }
     }else i.partyResync=null;
    }else i.partyResync=null;
   })();
  }
  if(leader&&!/^(tw|dx|gd|pv)/.test(leader.livePos?.room||''))await(async()=>{
   let current=await leader.partyState(),name=current?.members?.find(m=>m.aid===current.leader)?.name;
   if(current&&name&&name!==this.config.leader){await leader.partyLeave();current=null;}
   const have=new Set((current?.members||[]).map(m=>m.name)),online=this.view().members.filter(m=>m.online);
   leader.partyInviteSent ||= {};for(const m of online)if(m.charName!==this.config.leader&&!have.has(m.charName)&&this.now()-(leader.partyInviteSent[m.charName]||0)>=20000){leader.partyInviteSent[m.charName]=this.now();const sent=await leader.partyInvite(m.charName);if(sent?.ok===false)this.log('party invite deferred: '+m.charName+' ('+(sent.reason||'not sent')+')','warn');}
  })();
  const observed=[];
  for(const i of live){const p=await i.partyState(),partyAt=require('./runtime/party-evidence').observedAt(p,this.now()),valid=partyAt!==null,names=valid?(p.members||[]).map(m=>m.name):[];i.teamPartyId=names.includes(i.credentials.charName)?p.id:null;
   if(valid){const leaderName=p.members.find(m=>m.aid===p.leader)?.name;if(leaderName===this.config.leader)observed.push({observer:i.credentials.charName,id:p.id,leader:leaderName,members:names,checkedAt:partyAt,serverReceivedAt:p._receivedAt,want:this.config.members.map(m=>m.charName),missing:this.config.members.filter(m=>!names.includes(m.charName)).map(m=>m.charName)});}
  }
  if(leader){const p=await leader.partyState();farm.partyInfo=observed.find(p=>p.observer===this.config.leader&&p.id===leader.teamPartyId)||null;}
  else{const canonical=this.remote()?.party;farm.partyInfo=canonical?.leader===this.config.leader&&this.now()-canonical.checkedAt<30000?canonical:null;}
  await require('./runtime/guild-team').round(this,farm,live,leader);
  const build=farm.cache?.dir?path.basename(farm.cache.dir):this.local?.build;
  this.refreshDailyQuotas(farm);
  this.refreshTeamActivities(farm);
 }
}
module.exports={Federation,validate,safeMember};
