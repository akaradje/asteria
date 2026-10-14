'use strict';
const assert=require('assert/strict');
const {ClientRefresh,reload}=require('../src/runtime/client-refresh');
async function main(){
 await checkedApplicationRefresh();
 let now=1000000;const startedAt=now-120000;
 const snapshot=()=>({at:new Date(now).toISOString(),instances:[{status:'playing',lastSaveAt:now-1000,mapId:'town',development:[]}]});
 const health={ok:true,build:'new'},opts=()=>({now,startedAt,running:true,enabled:true});
 const c=new ClientRefresh();assert.equal(c.inspect(health,snapshot(),'old',opts()).action,'wait');now+=30000;
 assert.equal(c.inspect(health,snapshot(),'old',opts()).action,'refresh');
 const moved=snapshot();Object.assign(moved.instances[0],{mapId:'tw#1',runtimeV2:{roomPolicy:{room:'town'}}});assert.equal(c.inspect(health,moved,'old',opts()).reason,'protected dungeon or arena','older room policy cannot mask a dungeon map');
 for(const change of [{mapId:'tw#1'},{runtimeV2:{phase:'MAINTENANCE'}},{development:[{status:'pending'}]},{teamTradeStatus:{phase:'READY'}},{teamTradeStatus:{phase:'UNCERTAIN'}},{lastSaveAt:now-30000},{status:'booting'}]){const s=snapshot();Object.assign(s.instances[0],change);assert.equal(c.inspect(health,s,'old',opts()).action,'wait');}
 const idle=snapshot();Object.assign(idle.instances[0],{teamTradeStatus:{phase:'UNCERTAIN',navigationReleased:true,confirmationSent:false,receiptId:null,idleAfter:now-50000,idleNavigationEvidence:{at:now-10000,saveAt:now-11000,kind:'fresh_native_idle_after_deadline_no_confirmation',outcome:'unknown',replayBlocked:true}},tradeAvailability:{at:now-1000,clear:true}});
 assert.equal(c.inspect(health,idle,'old',opts()).action,'refresh','expired native-idle original uncertainty cannot prevent a safe game refresh forever');
 for(const mutate of [i=>i.teamTradeStatus.confirmationSent=true,i=>delete i.teamTradeStatus.confirmationSent,i=>i.teamTradeStatus.receiptId=1,i=>i.teamTradeStatus.phase='READY',i=>i.tradeAvailability.clear=false,i=>i.tradeAvailability.at=now-15000,i=>i.teamTradeStatus.idleNavigationEvidence.saveAt=now-50000,i=>i.teamTradeStatus.idleNavigationEvidence.outcome='confirmed',i=>i.development=[{status:'pending'}],i=>i.mapId='tw#1']){const bad=JSON.parse(JSON.stringify(idle));mutate(bad.instances[0]);assert.equal(c.inspect(health,bad,'old',opts()).action,'wait');}
 assert.equal(idle.instances[0].teamTradeStatus.phase,'UNCERTAIN','refresh permission cannot settle or cancel the original transfer');
 assert.equal(c.inspect(health,{...snapshot(),at:new Date(startedAt-1).toISOString()},'old',opts()).action,'wait');
 assert.equal(c.inspect(health,snapshot(),'old',{...opts(),running:false}).action,'none');
 assert.equal(c.inspect(health,snapshot(),'old',{...opts(),enabled:false}).action,'none');
 c.attempt('new',now);assert.equal(c.inspect(health,snapshot(),'old',opts()).reason,'client refresh cooldown');
 const restored=new ClientRefresh(JSON.parse(JSON.stringify(c.view())));assert.equal(restored.inspect(health,snapshot(),'old',opts()).action,'wait','cooldown survives controller restart');
 assert.equal(c.inspect(health,snapshot(),'new',opts()).action,'none');
 const same=new ClientRefresh(),source=()=>({...snapshot(),gameKnowledge:{checkedAt:now,current:{build:'new',id:'new-content-2'},sourceCoherence:{matches:false,loadedBuild:'new',liveBuild:'new',mismatched:['client']}}});
 assert.equal(same.inspect(health,source(),'new',opts()).action,'wait');now+=30000;
 assert.equal(same.inspect(health,source(),'new',opts()).action,'refresh','same-build byte changes need a safe reload');
 for(const status of ['STARTED','WAITING_CONFIRMATION','UNCERTAIN']){const s=source();s.instances[0].runtimeV2={purchases:[{status}]};assert.equal(same.inspect(health,s,'new',opts()).action,'wait');}
 const fs=require('fs'),path=require('path'),os=require('os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-closed-purchase-'));
 try{
  const {ActionJournal}=require('../src/runtime/action-journal'),j=new ActionJournal(dir,'fixture'),session=now-50000;
  const old={kind:'purchase',target:{item:'Red Potion'},status:'UNCERTAIN',at:session-60000,deadline:session-30000,before:{coins:1000,potions:10,consumables:{}}};j.rows=[old];
  assert.equal(j.reconcilePurchaseLoad({lv:100,coins:1000},{at:session+1,sessionStartedAt:session,rev:5}),true);
  assert.equal(old.status,'UNCERTAIN');assert.equal(j.begin('purchase',{item:'Red Potion'},{},now,'new'),null,'historical payment remains replay-blocked');
  const good=source();good.instances[0].runtimeV2={sessionStartedAt:session,purchases:[old]};assert.equal(same.inspect(health,good,'new',opts()).action,'refresh','verified closed old purchase cannot pin a live client forever');
  const {historicalClosedPurchase}=require('../src/runtime/client-refresh');assert(historicalClosedPurchase(old,good.instances[0],now));
  for(const mutate of [r=>r.kind='refine',r=>r.status='WAITING_CONFIRMATION',r=>r.status='STARTED',r=>r.externalOwner='ledger',r=>r.at=session,r=>r.closedSessionEvidence.at=now+1,r=>r.closedSessionEvidence.sessionStartedAt--,r=>r.closedSessionEvidence.replayBlocked=false,r=>r.closedSessionEvidence.rev=null,r=>delete r.closedSessionEvidence]){const r=JSON.parse(JSON.stringify(old));mutate(r);assert.equal(historicalClosedPurchase(r,good.instances[0],now),false);const bad=source();bad.instances[0].runtimeV2={sessionStartedAt:session,purchases:[r]};assert.equal(same.inspect(health,bad,'new',opts()).action,'wait');}
  assert.equal(historicalClosedPurchase(old,{runtimeV2:{sessionStartedAt:session+1}},now),false,'another page session cannot reuse the load proof');
  for(const options of [{at:session,sessionStartedAt:session,rev:5},{at:now,sessionStartedAt:old.at,rev:5},{at:now,sessionStartedAt:session,rev:null}]){const fresh=new ActionJournal(dir,'reject-'+Object.keys(options).length);fresh.rows=[{...old,closedSessionEvidence:undefined}];assert.equal(fresh.reconcilePurchaseLoad({lv:100,coins:1000},options),false);}
  j.observe({coins:650,potions:30},now);assert.equal(old.status,'UNCERTAIN','later-session loot cannot prove an old purchase');assert.equal(j.pending('Red Potion'),old);
  const live=new ActionJournal(dir,'live-late');live.rows=[{...old,closedSessionEvidence:undefined,at:now-1000,deadline:now-1,reason:'uncertain fixture'}];live.observe({coins:650,potions:30},now);assert.equal(live.rows[0].status,'OBSERVED');assert(live.rows[0].reason,'a client delta without native receipt remains unresolved');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 const owned=source();owned.instances[0].dailyWorkStatus={ownsNavigation:true};assert.equal(same.inspect(health,owned,'new',opts()).action,'wait');
 const stale=source();stale.gameKnowledge.checkedAt=now-900001;assert.equal(same.inspect(health,stale,'new',opts()).action,'none','stale source evidence cannot trigger a restart');
 const mismatched=source();mismatched.gameKnowledge.sourceCoherence.loadedBuild='old';assert.equal(same.inspect(health,mismatched,'new',opts()).action,'none','old disk observation cannot restart new loaded build');
 const actorOld=source();actorOld.gameKnowledge.sourceCoherence.matches=true;actorOld.gameKnowledge.sourceCoherence.mismatched=[];actorOld.gameKnowledge.current.sourceHashes={client:'a'.repeat(64),world:'b'.repeat(64),network:'c'.repeat(64)};actorOld.instances[0].runtimeV2={loadedSourceIdentity:{build:'new',sourceHashes:{...actorOld.gameKnowledge.current.sourceHashes,client:'d'.repeat(64)}}};
 const actorRefresh=new ClientRefresh();assert.equal(actorRefresh.inspect(health,actorOld,'new',opts()).action,'wait');now+=30000;actorOld.at=new Date(now).toISOString();actorOld.instances[0].lastSaveAt=now-1000;actorOld.gameKnowledge.checkedAt=now;
 assert.equal(actorRefresh.inspect(health,actorOld,'new',opts()).action,'refresh','restaged disk never proves the existing page loaded its bytes');
 let starts=0,revision=1;let result=await reload({stop:async()=>{revision++;return {ok:true};},start:()=>{starts++;return {ok:true};},options:{n:3},currentRevision:()=>revision,revision:1});assert.equal(result.ok,false);assert.equal(starts,0,'manual stop during refresh prevents automatic start');
 await assert.rejects(reload({stop:async()=>({ok:false}),start:()=>{starts++;},currentRevision:()=>1,revision:1}),/rejected/);assert.equal(starts,0,'stop rejection is never bypassed');
 result=await reload({stop:async()=>({ok:true}),start:o=>{starts++;assert.equal(o.n,3);return {ok:true};},options:{n:3},currentRevision:()=>1,revision:1});assert.equal(result.ok,true);
 console.log('PASS stable build, fresh run, dungeon/maintenance/paid/trade guards, persistent cooldown, stopped farm and manual stop/rejection protections');
}
async function checkedApplicationRefresh(){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const {applicationApproval}=require('../src/runtime/client-refresh');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-reviewed-refresh-'));
 try{
  fs.mkdirSync(path.join(root,'src'));fs.mkdirSync(path.join(root,'logs/system-audit'),{recursive:true});
  const file=path.join(root,'src/example.js'),manifest=path.join(root,'logs/system-audit/architecture-release.json');fs.writeFileSync(file,'module.exports=1;');
  const revision=require('../src/knowledge/system-version').inventory(root).revision;
  const inventoryPath=require.resolve('../src/knowledge/system-version');
  const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(inventoryPath)).digest('hex');
  let proof={plan:'V3.2',build:'previous-game-build',sourceRevision:revision,hashes:{'src/knowledge/system-version.js':hash},testEvidence:{sourceRevision:revision},stages:{sourceChecks:'PASSED'}};
  fs.writeFileSync(manifest,JSON.stringify(proof));assert.equal(applicationApproval(root).allowed,true,'new game build does not invalidate reviewed app code');
  const oldInventory=require.cache[inventoryPath].exports.inventory;
  require.cache[inventoryPath].exports.inventory=()=>({revision:'obsolete_cached_boundary'});
  assert.equal(applicationApproval(root).allowed,true,'resident controller refresh uses reviewed disk inventory after source rollout');
  assert.equal(require.cache[inventoryPath].exports.inventory().revision,'obsolete_cached_boundary','other loaded cache owners preserved');
  require.cache[inventoryPath].exports.inventory=oldInventory;
  proof.hashes['src/knowledge/system-version.js']='0'.repeat(64);fs.writeFileSync(manifest,JSON.stringify(proof));assert.equal(applicationApproval(root).allowed,false,'unreviewed inventory implementation cannot execute');
  proof.hashes['src/knowledge/system-version.js']=hash;fs.writeFileSync(manifest,JSON.stringify(proof));
  let stops=0,starts=0;const options={stop:async()=>{stops++;return {ok:true};},start:async()=>{starts++;return {ok:true};},currentRevision:()=>1,revision:1,approvedApplication:()=>applicationApproval(root)};
  fs.appendFileSync(file,'// unreviewed edit');assert.equal((await reload(options)).ok,false);assert.equal(stops,0,'unreviewed disk code must not interrupt the playing farm');
  fs.writeFileSync(file,'module.exports=1;');assert.equal((await reload(options)).ok,true);assert.equal(starts,1);
  assert.equal((await reload({...options,stop:async()=>{fs.appendFileSync(file,'// mid-drain edit');return {ok:true};}})).ok,false);assert.equal(starts,1,'source changed during drain must not launch a new session');
  fs.writeFileSync(file,'module.exports=1;');proof.stages.sourceChecks='INCOMPLETE';fs.writeFileSync(manifest,JSON.stringify(proof));assert.equal(applicationApproval(root).allowed,false);
  fs.unlinkSync(manifest);assert.equal(applicationApproval(root).allowed,false,'missing review never falls back to approval');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

{
 const {loadedBuild,healthFromKnowledge}=require('../src/runtime/client-refresh');const now=1000000,startedAt=500000,hashes={client:'a'.repeat(64),world:'b'.repeat(64),network:'c'.repeat(64)};
 const make=()=>({at:new Date(now).toISOString(),instances:[{runtimeV2:{loadedSourceIdentity:{build:'old',sourceHashes:{...hashes}}}}],gameKnowledge:{liveBuild:'new',checkedAt:now,lastError:null,current:{build:'new',at:now-1000,evidence:'downloaded_client_sources',sourceHashes:{...hashes}},collection:{at:now-2000,sources:Object.fromEntries(['html','world','network','wiki'].map(k=>[k,{status:'received'}]))}}});
 for(const machine of ['windows','tum','vps'])assert.equal(loadedBuild(make(),null,{machine,now,startedAt}),'old');
 assert.equal(loadedBuild({...make(),at:new Date(startedAt-1).toISOString()},null,{machine:'vps',now,startedAt}),null);
 const mixed=make();mixed.instances.push({runtimeV2:{loadedSourceIdentity:{build:'old',sourceHashes:{...hashes,client:'d'.repeat(64)}}}});assert.equal(loadedBuild(mixed,null,{machine:'tum',now,startedAt}),null,'mixed page bytes cannot qualify one farm build');
 const absent=make();delete absent.instances[0].runtimeV2.loadedSourceIdentity.sourceHashes;assert.equal(loadedBuild(absent,null,{machine:'windows',now,startedAt}),null);
 assert.equal(loadedBuild(make(),{at:now,build:'fresh'},{machine:'tum',now,startedAt}),'fresh');
 assert.equal(loadedBuild(make(),{at:now,build:'fresh'},{machine:'tum',now,startedAt:now+1}),null,'preceding-run telemetry cannot authorize reload');
 const fallback=healthFromKnowledge(make(),{now,startedAt});assert.equal(fallback.build,'new');assert.equal(fallback.observedAt,now-1000);
 for(const mutate of [s=>s.at=new Date(startedAt-1).toISOString(),s=>s.at=new Date(now+1).toISOString(),s=>s.gameKnowledge.lastError='failed',s=>s.gameKnowledge.liveBuild='changed',s=>s.gameKnowledge.current.at=now-300000,s=>s.gameKnowledge.current.at=now+1,s=>s.gameKnowledge.current.at=startedAt-1,s=>delete s.gameKnowledge.current.sourceHashes.network,s=>s.gameKnowledge.current.evidence='unverified',s=>s.gameKnowledge.collection.at=now,s=>s.gameKnowledge.collection.sources.world.status='unavailable',s=>delete s.gameKnowledge.collection.sources.wiki]){const s=make();mutate(s);assert.equal(healthFromKnowledge(s,{now,startedAt}),null,'incomplete/stale/mixed/failed source collection must fail closed');}
 const staged=make();staged.gameKnowledge.collection.sources.html.status='verified_staged_cache';assert(healthFromKnowledge(staged,{now,startedAt}));
 const guarded=new ClientRefresh(),first=make();assert.equal(guarded.inspect(fallback,first,'old',{now,startedAt,running:true,enabled:true}).action,'wait');const later=make();later.at=new Date(now+30000).toISOString();later.instances[0].status='playing';later.instances[0].mapId='town';later.instances[0].lastSaveAt=now+30000;later.instances[0].development=[{status:'pending'}];assert.equal(guarded.inspect(fallback,later,'old',{now:now+30000,startedAt,running:true,enabled:true}).reason,'paid outcome awaiting reconciliation');assert.equal(guarded.inspect(fallback,later,'old',{now:now+30000,startedAt,running:false,enabled:false}).action,'none');
 console.log('PASS all-host exact page identity and recent complete source fallback; payment/manual-stop guards retained');
}
