'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {diagnose,HealthRound}=require('../src/observability/runtime-health'),{measure,RuntimeCost}=require('../src/observability/runtime-cost'),progress=require('../src/observability/actual-progress');
(async()=>{
 const now=1000000,i={status:'playing',lastSaveAt:now,livePos:{at:now},lastFps:20,lastFpsAt:now,v2:{observation:{at:now,connected:true}}};
 assert.equal(diagnose(i,now).state,'working');assert.equal(diagnose({...i,lastFpsAt:now-16000},now).state,'telemetry_late');
 assert.equal(diagnose({...i,lastSaveAt:now-31000},now).state,'save_delayed');assert(!diagnose({...i,lastSaveAt:now-31000},now).recoveryEligible);
 assert.equal(diagnose({...i,lastFps:0},now).state,'low_fps');assert.equal(diagnose({...i,lastFpsAt:now+1},now).state,'telemetry_late');
 assert.equal(diagnose({...i,v2:{observation:{at:now,connected:false}}},now).state,'disconnected');
 assert.equal(diagnose({...i,v2:{observation:{at:now-16000,connected:false}}},now).state,'working','old connection evidence cannot label a fresh actor disconnected');
 assert.equal(diagnose({...i,choresBusy:true,v2:{observation:{at:now,paused:true}}},now).state,'owned_activity');
 let calls=[];const farm={instances:[0,1,2,3,4,5].map(slot=>({status:'playing',observeContinuity:async()=>calls.push(slot)})),log:()=>{}};const round=new HealthRound(farm);
 for(let n=0;n<12;n++)round.pulse();await new Promise(setImmediate);assert.deepEqual(calls,[0,1,2,3,4,5,0,1,2,3,4,5]);farm.stopping=true;round.pulse();await Promise.resolve();assert.equal(calls.length,12);
 const before={Timestamp:10,TaskDuration:3,ScriptDuration:2,LayoutDuration:1,RecalcStyleDuration:.1},after={Timestamp:25,TaskDuration:9,ScriptDuration:5,LayoutDuration:2,RecalcStyleDuration:.4,JSHeapUsedSize:30*1048576};
 assert.equal(measure(before,after,now).mainThreadBusyPct,40);assert.equal(measure(before,after,now).scriptPct,20);assert.equal(measure(before,after,now).jsHeapMb,30);assert.equal(measure(after,before,now),null);assert.equal(measure(before,{...after,TaskDuration:0},now),null);
 const meter=new RuntimeCost();let sends=0,detaches=0;const page={},actor={status:'playing',page,ctx:{newCDPSession:async()=>({send:async name=>{if(name==='Performance.enable')return {};sends++;return {metrics:Object.entries(sends===1?before:after).map(([name,value])=>({name,value}))};},detach:async()=>detaches++})}};
 await meter.sample(actor,now);assert.equal(meter.value,null);await meter.sample(actor,now+1000);assert.equal(sends,1);await meter.sample(actor,now+16000);assert.equal(meter.value.mainThreadBusyPct,40);actor.page={};await meter.sample(actor,now+32000);assert.equal(meter.value,null,'new page has new baseline');assert.equal(detaches,1);await meter.close();assert.equal(detaches,2);assert.equal(meter.view(),null);
 const hung=new RuntimeCost({timeoutMs:15,detachTimeoutMs:5}),never=new Promise(()=>{}),blocked={...actor,ctx:{newCDPSession:async()=>({send:async n=>n==='Performance.enable'?{}:never,detach:()=>never})}};
 const t0=Date.now();await hung.sample(blocked,now);assert(Date.now()-t0<500,'teardown after timed out probe stays bounded');assert.equal(hung.busy,false);assert.equal(hung.status().reason,'probe_timeout');assert.equal(hung.value,null);
 blocked.ctx=actor.ctx;await hung.sample(blocked,now+16000);assert.equal(hung.status().state,'baseline','a timed out read with hanging detach cannot permanently suppress new probes');await hung.close();
 const invalid=new RuntimeCost();let reads=0;const bad={...actor,ctx:{newCDPSession:async()=>({send:async n=>n==='Performance.enable'?{}:{metrics:Object.entries(reads++?{...after,Timestamp:100}:before).map(([name,value])=>({name,value}))},detach:async()=>{}})}};
 await invalid.sample(bad,now);await invalid.sample(bad,now+16000);assert.equal(invalid.view(),null);assert.equal(invalid.status().reason,'invalid_or_overlong_metric_window','unknown CPU is not zero');await invalid.close();
 const {ActionScheduler}=require('../src/runtime/action-scheduler');let clock=now;const measuredQueue=new ActionScheduler({now:()=>clock});
 await measuredQueue.run('tick',async()=>{clock+=10;await measuredQueue.run('returnToTown',async()=>{clock+=30;});clock+=10;});
 let timing=measuredQueue.view().timings;assert.equal(timing.find(r=>r.kind==='tick').lastMs,50);assert.equal(timing.find(r=>r.kind==='returnToTown').lastMs,30);assert.equal(timing.find(r=>r.kind==='tick').samples,1);
 let finish;const first=measuredQueue.run('tick',()=>new Promise(r=>finish=r)),second=measuredQueue.run('purchase',async()=>{clock+=5;});clock+=20;finish();await first;await second;assert.equal(measuredQueue.view().timings.find(r=>r.kind==='purchase').queueMs,20);
 await assert.rejects(measuredQueue.run('failedProbe',async()=>{clock+=7;throw Error('test');}),/test/);assert.equal(measuredQueue.view().timings.find(r=>r.kind==='failedProbe').failed,1);
 for(let n=0;n<70;n++)await measuredQueue.run('tick',async()=>clock++);assert.equal(measuredQueue.view().timings.find(r=>r.kind==='tick').samples,64,'histogram window bounded');
 for(let n=0;n<25;n++)await measuredQueue.run('kind'+n,async()=>clock++);assert.equal(measuredQueue.view().timings.length,16,'kind cardinality bounded');
 const snap={levelProgress:{build:'b1',expPerHour:100},questOutcomes:{build:'b1',rows:[{kind:'main_quest',at:now-1000},{kind:'daily_reward',at:now-500},{kind:'board_reward',at:now+1}]},developmentProgress:{stage:'gather',reason:'missing'}},r={...i,slot:0,credentials:{charName:'PUBLIC'},reports:{data:{slots:{0:{name:'PUBLIC',buckets:[{build:'b1',at:now-1000,observedMs:300000,kills:10,deaths:1,materialNet:{'materials:Ore':-2}},{build:'old',at:now-1000,kills:999}]}}}}};
 let p=progress.view(r,snap,now);assert.equal(p.kills,10);assert.equal(p.killsPerHour,120);assert.equal(p.questTransitionsObserved,1);assert.equal(p.netMaterials[0].net,-2);assert(!p.serverVerified);assert.equal(progress.view({...r,lastSaveAt:now-31000},snap,now).expPerHour,null);assert.equal(progress.view({...r,credentials:{charName:'OTHER'}},snap,now).kills,0,'slot reuse cannot leak another character history');
 assert.equal(progress.view({catalog:()=>({build:'b1'})},{},now).kills,0,'unidentified boot snapshot cannot match an undefined history row');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-runtime-health-'));
 try{
  const {PersonalHistory}=require('../src/personal-history');const h=new PersonalHistory(root,{machine:'vps'});assert.equal(h.machine,'vps');assert.notEqual(h.identity('PUBLIC'),new PersonalHistory(root,{machine:'tum'}).identity('PUBLIC'));
  const {LevelProgress}=require('../src/observability/level-progress');let t=now;const l=new LevelProgress(root,'PUBLIC'),a={catalog:()=>({build:'b1',world:{MAX_LV:120,expToNext:()=>100,jobToNext:()=>100}}),lastSave:{lv:2,exp:0,job:'mage',jobLv:2,jobExp:0},lastSaveAt:t,livePos:{room:'w1',at:t},status:'playing'};
  l.observe(a,t);for(let n=1;n<=150;n++){t+=5000;a.lastSaveAt=t;a.livePos.at=t;a.lastSave.exp++;l.observe(a,t);}assert.equal(l.samples.length,150,'5s observations retain more than the old ten-minute limit');l.persist(t,true);assert.equal(JSON.parse(fs.readFileSync(l.file)).samples.length,150);
  // Publication must carry coherent native inventory and actual observation
  // timestamps without asking the renderer for another screen/evaluation.
  const pub=Object.create(require('../src/supervisor').Supervisor.prototype);
  const native={lastSaveAt:Date.now()-4000,materials:{Ore:1},fps:20,fpsAt:Date.now()-2000};
  Object.assign(pub,{root,machine:'windows',runtimeV2:true,count:1,deferred:new Set(),instances:[{snapshot:()=>({...native,materials:{...native.materials}}),eval:()=>{throw Error('publication cannot evaluate a page');}}],checkSlotHealth:()=>{},freeMb:()=>1000,performance:{sample:()=>{},data:{}}});
  pub.snapshotToDisk();let published=JSON.parse(fs.readFileSync(path.join(root,'logs/status.json')));
  assert.equal(published.instances[0].lastSaveAt,native.lastSaveAt);assert.equal(published.instances[0].materials.Ore,1);
  native.materials.Ore=2;native.lastSaveAt=Date.now()-1000;pub.lastSnapshotAt=Date.now()-2000;pub.snapshotToDisk();published=JSON.parse(fs.readFileSync(path.join(root,'logs/status.json')));
  assert.equal(published.instances[0].materials.Ore,2);assert.equal(published.instances[0].lastSaveAt,native.lastSaveAt,'publication preserves native evidence time rather than stamping now');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 const vm=require('vm'),ui={Date,fmt:x=>String(x??'–'),esc:x=>String(x??'').replace(/</g,'&lt;'),window:{}};vm.createContext(ui);vm.runInContext(fs.readFileSync('src/public/fleet-layout.js','utf8'),ui);ui.sourceCaption=()=>'';ui.planLayout=()=>'';assert(ui.layoutResult('plan',{meta:{expected:6}},'vps').includes('vps · 6 ตัว'));assert(!ui.actualProgressLayout({fresh:true,saveAt:Date.now(),expPerHour:3,netMaterials:[{key:'materials:<img>',net:1}]}).includes('<img>'));
 assert(ui.runtimeHealthLayout({at:Date.now(),state:'working',reason:'fresh',costProbe:{at:Date.now(),state:'unavailable',reason:'probe_timeout'}},null).includes('ตัววัดตอบช้า'),'older Windows controller carries probe through existing health projection');
 assert(ui.runtimeProbeLayout({at:Date.now(),state:'unavailable',reason:'probe_timeout',roundTripMs:2500},{timings:[{kind:'returnToTown',at:Date.now(),lastMs:42000,p95Ms:45000,samples:3,failed:1}]}).includes('P95'));assert(!ui.runtimeProbeLayout(null,{timings:[{kind:'<img>',at:Date.now(),lastMs:1,p95Ms:1,samples:1,failed:0}]}).includes('<img>'));
 assert(fs.readFileSync('src/supervisor.js','utf8').includes('setInterval(()=>healthRound.pulse(),1000)'),'standalone VPS and primary hosts use the same paced observer rail');
 const python=process.platform==='win32'?'python':'python3';
 require('child_process').execFileSync(python,['-c',`import ast,pathlib
tree=ast.parse(pathlib.Path('scripts/fleet-panel-bridge.py').read_text())
overview=next(ast.literal_eval(n.value) for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='member_fields' for t in n.targets))
detail=next(ast.literal_eval(n.iter) for n in ast.walk(tree) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='field')
fields={'runtimeHealth','runtimeCost','runtimeCostStatus','actualProgress'}
assert fields.issubset(overview) and fields.issubset(detail), 'tum overview/detail must carry the same health/progress contract'
clean=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='clean')
namespace={};exec(compile(ast.Module(body=[clean],type_ignores=[]),'bridge-clean','exec'),namespace)
row={'actualProgress':{'expPerHour':100,'credentials':{'password':'hidden'}},'account':'hidden','runtimeCost':{'scope':'main_thread'}}
public=namespace['clean'](row)
assert public['actualProgress']=={'expPerHour':100} and 'account' not in public
`],{stdio:'pipe'});
 console.log('PASS staggered health, stale/session/ownership gates, per-page task scopes/reset, current-build observed progress, VPS history identity and hour retention');
})().catch(e=>{console.error(e);process.exitCode=1});
