'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {SystemRecovery,need}=require('../src/learning/system-recovery');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-system-recovery-')),write=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof v==='string'?v:JSON.stringify(v));};
 try{
  let now=Date.now(),calls=0,finish;const actorId='actor-'+'a'.repeat(32);
  const snapshot={at:new Date(now).toISOString(),gameKnowledge:{current:{sourceHashes:{client:'x'}},systemVersion:{build:'old',liveBuild:'new',liveFresh:true,sourceMatches:false,wikiCurrent:false,architectureCurrent:false}},instances:[{slot:0,identity:{actorId},status:'playing',lastSaveAt:now,lastSaveAgo:0,lv:120}]};
  assert.equal(need(snapshot,now).build,'new');assert.equal(need({...snapshot,at:new Date(now-45001).toISOString()},now),null);assert.equal(need({...snapshot,at:new Date(now+1).toISOString()},now),null);
  assert.equal(need({...snapshot,gameKnowledge:{systemVersion:{...snapshot.gameKnowledge.systemVersion,liveFresh:false}}},now),null);
  const aligned={...snapshot,gameKnowledge:{systemVersion:{build:'add136aa',liveBuild:'add136aa',sourceRevision:'a'.repeat(64),liveFresh:true,sourceMatches:true,wikiCurrent:true,architectureCurrent:true}}};
  const direct={authority:'direct_server_health',ok:true,build:'feef06b7',at:now};
  assert.equal(need(aligned,now,direct).build,'feef06b7','Actual server patch cannot hide behind an aligned loaded catalog');
  assert.equal(need(aligned,now,{...direct,at:now-120001}),null);
  assert.equal(need(aligned,now,{...direct,at:now+1}),null);
  assert.equal(need(aligned,now,{...direct,authority:'client_text'}),null);
  assert.equal(need(aligned,now,{...direct,build:'add136aa'}),null);
  write('logs/status.json',snapshot);write('logs/host-intent.json',{mode:'running',revision:1});
  const code=fs.readFileSync('src/knowledge/system-version.js');write('src/knowledge/system-version.js',code.toString());const version=require('../src/knowledge/system-version').inventory(root);
  write('logs/system-audit/architecture-release.json',{plan:'V3.2',stages:{sourceChecks:'PASSED'},sourceRevision:version.revision,testEvidence:{sourceRevision:version.revision},hashes:version.hashes});
  const controller=new SystemRecovery(root,'windows',{now:()=>now,launch:async()=>{calls++;await new Promise(r=>finish=r);}});
  await controller.tick({enabled:false,farm:{ready:true}});await controller.tick({enabled:true,farm:{ready:false}});assert.equal(calls,0);
  const flight=controller.tick({enabled:true,farm:{ready:true}});await controller.tick({enabled:true,farm:{ready:true}});assert.equal(calls,1,'one worker owns queue');finish();await flight;assert.equal(controller.view().mode,'awaiting_native_reload');
  await controller.tick({enabled:true,farm:{ready:true}});assert.equal(calls,1,'provider-independent queue retains cooldown across repeated AI ticks');
  const restarted=new SystemRecovery(root,'windows',{now:()=>now,launch:async()=>calls++});await restarted.tick({enabled:true,farm:{ready:true}});assert.equal(calls,1,'durable attempt prevents duplicate after panel restart');
  const member=require('../src/ai-advisor').context(root,now).members[0],plan=require('../src/ai-advisor').validatePlan({summary:'repair sources',members:[{slot:0,action:'sync_game',reason:'current source mismatch'}]},{snapshotAt:snapshot.at,members:[{...member,busy:true}]});
  assert.equal(plan.members[0].action,'sync_game','non-mutating system review can run while actor owner is busy');assert(require('../src/learning/autonomous-policy').allowed('sync_game',{...member,busy:true},plan.members[0].proposal,now));
  const c={...plan.members[0],id:'review-1',actorId,build:'old',expiresAt:now+60000};
  assert.equal(controller.request(c,{enabled:true,farm:{ready:true}}).ok,true);assert.equal(controller.request({...c,actorId:'actor-'+'b'.repeat(32)},{enabled:true,farm:{ready:true}}).ok,false);assert.equal(controller.request(c,{enabled:false,farm:{ready:true}}).ok,false);
  assert(require('../src/runtime/ai-command').eligible(c,{status:'playing',lastSaveAt:now},now),'farm executor rejects host system actions');
  const {AutoBrain}=require('../src/auto-brain');let sentinel=0;write('logs/ai-auto.json',{enabled:true});const brain=new AutoBrain(root,{busy:true,nextAt:now+100000},()=>({ready:true}),()=>{}, {systemRecovery:()=>{sentinel++;return {mode:'reviewing'};}});await brain.tick(now);assert.equal(sentinel,1,'model busy/backoff does not disable system recovery');brain.data.enabled=false;await brain.tick(now);assert.equal(sentinel,1,'AI pause respected');
  now+=600001;snapshot.at=new Date(now).toISOString();snapshot.instances[0].lastSaveAt=now;write('logs/status.json',snapshot);write('logs/host-intent.json',{mode:'operator_stopped',revision:2});await restarted.tick({enabled:true,farm:{ready:true}});assert.equal(calls,1,'operator stop wins even with cached farm ready');
  // Same target/app is one durable job regardless of its evidence channel.
  snapshot.gameKnowledge.systemVersion={...aligned.gameKnowledge.systemVersion,sourceMatches:false,liveBuild:'feef06b7'};snapshot.at=new Date(now).toISOString();write('logs/status.json',snapshot);write('logs/host-intent.json',{mode:'running',revision:3});
  const viaSnapshot=need(snapshot,now),viaHealth=need(snapshot,now,{...direct,at:now});assert.equal(viaSnapshot.key,viaHealth.key);
  const legacyKey=crypto.createHash('sha256').update(JSON.stringify(['feef06b7',snapshot.gameKnowledge.systemVersion.sourceRevision,snapshot.gameKnowledge.current.sourceHashes])).digest('hex');
  write('logs/ai-system/controller.json',{attempts:[{key:legacyKey,at:now-1000}],history:[]});
  const migrated=new SystemRecovery(root,'windows',{now:()=>now,launch:async()=>{calls++;}});await migrated.tick({enabled:true,farm:{ready:true}});assert.equal(calls,1,'legacy snapshot key retains cooldown when health becomes authoritative');
  // A long review has a full cooldown after completion, persisted on failure.
  now+=600001;snapshot.at=new Date(now).toISOString();write('logs/status.json',snapshot);
  const slow=new SystemRecovery(root,'windows',{now:()=>now,launch:async()=>{calls++;now+=700000;throw Error('transient public review');}});await slow.tick({enabled:true,farm:{ready:true}});assert.equal(calls,2);assert.equal(slow.view().mode,'review_failed');
  snapshot.at=new Date(now).toISOString();write('logs/status.json',snapshot);const afterFailure=new SystemRecovery(root,'windows',{now:()=>now,launch:async()=>calls++});await afterFailure.tick({enabled:true,farm:{ready:true}});assert.equal(calls,2,'long failed worker cannot immediately relaunch');assert(afterFailure.view().attempts[0].finishedAt);
  now+=600001;snapshot.at=new Date(now).toISOString();write('logs/status.json',snapshot);await afterFailure.tick({enabled:true,farm:{ready:true}});assert.equal(calls,3);
  snapshot.gameKnowledge.systemVersion={...aligned.gameKnowledge.systemVersion,build:'feef06b7',liveBuild:'feef06b7'};write('logs/status.json',snapshot);await afterFailure.tick({enabled:true,farm:{ready:true}});assert.equal(afterFailure.view().mode,'verified_current');assert.equal(afterFailure.view().need,undefined);assert.equal(afterFailure.view().errorHash,undefined);assert(afterFailure.view().lastNeed);assert(afterFailure.view().lastErrorHash,'old error is historical, never erased');
  snapshot.gameKnowledge.systemVersion.liveBuild='abcd1234';snapshot.gameKnowledge.systemVersion.sourceMatches=false;write('logs/status.json',snapshot);await afterFailure.tick({enabled:true,farm:{ready:true}});assert.equal(calls,4,'a genuinely new native build has an independent job');
  console.log('PASS shared AI/host queue, stale/build gates, singleton/cooldown across restart, provider outage, busy actor ownership, proposal identity, AI/operator pauses and farm action separation');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
