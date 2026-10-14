'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ResourcePressure}=require('../src/runtime/resource-pressure');
const {HealthRound,diagnose}=require('../src/observability/runtime-health');
const {Advisor}=require('../src/ai-advisor');
const flush=()=>new Promise(r=>setImmediate(r));
async function main(){
 const p=new ResourcePressure(),i={lastFps:1,lastFpsAt:1,resourceProfileApplied:true,livePos:{room:'town'}};let now=100000;
 assert.equal(p.observe(i,now,2).mode,'reduced','host overload works without FPS');assert.equal(i.resourceHealth.fps,null);assert.equal(i.adaptiveTickMs,8000);
 for(let n=0;n<8;n++)p.observe(i,now+=5000,0);
 assert.equal(i.resourceHealth.mode,'reduced','missing telemetry cannot prove recovery');
 i.lastFps=28;for(let n=0;n<6;n++){i.lastFpsAt=now+=5000;p.observe(i,now,0);}
 assert.equal(i.resourceHealth.mode,'normal');
 i.v2={observation:{nativeBotConsole:true,at:now}};p.observe(i,now+=5000,2);assert.equal(i.resourceHealth.fpsApplicable,false);assert.equal(i.adaptiveTickMs,8000,'text mode also sheds optional work');
 i.livePos.room='gd#1';p.observe(i,now+=5000,2);assert.equal(i.adaptiveTickMs,5000,'combat safety cadence retained');
 p.observe(i,now+=20000,2);assert.equal(i.resourceHealth.fpsApplicable,true,'stale mode cannot hide drawing telemetry');
 let registryResolve,observations=0,registryCalls=0;const actor={status:'playing',observeContinuity:async()=>{observations++;}},other={status:'playing',observeContinuity:async()=>{observations++;}};
 const farm={instances:[actor,other],log(){}};const health=new HealthRound(farm,{now:()=>now,registryPulse:async a=>{registryCalls++;if(a===actor)await new Promise(r=>registryResolve=r);}});
 health.pulse();await flush();assert.equal(observations,1,'native observation does not wait for registry');health.pulse();await flush();health.pulse();await flush();assert.equal(registryCalls,2,'unsettled request is not duplicated');assert.equal(observations,3,'other actor and local probes continue');
 now+=25000;assert.equal(diagnose(actor,now).probes.registry.overdue,true);assert.equal(diagnose(actor,now).recoveryEligible,false,'overdue read cannot authorize restart');registryResolve();await flush();assert.equal(actor.healthProbes.registry.state,'completed');
 farm.stopping=true;health.pulse();await flush();assert.equal(observations,3);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-degrade-'));try{
  fs.mkdirSync(path.join(root,'logs'));fs.writeFileSync(path.join(root,'.env'),'META_API_KEY=fake\nMETA_MODEL=test\nTYPESAFE_API_KEY=fake\n');
  const {IncidentBook}=require('../src/runtime/v3-incidents'),book=new IncidentBook(root,'fixture');const observed={lastSaveAt:now,livePos:{at:now},lastFps:2,lastFpsAt:now,resourceHealth:{mode:'reduced',at:now}};
  book.observe(observed,now);assert(book.view().open.some(r=>r.id==='low_fps'));
  book.observe(observed,now+60000);assert(book.view().open.some(r=>r.id==='low_fps'),'missing samples are not successful self-repair');assert(book.view().open.some(r=>r.id==='resource_pressure'));
  book.observe({...observed,lastFps:25,lastFpsAt:now+60001,resourceHealth:{mode:'normal',at:now+60001}},now+60001);assert(!book.view().open.some(r=>['low_fps','resource_pressure'].includes(r.id)));
  fs.writeFileSync(path.join(root,'logs/status.json'),JSON.stringify({at:new Date().toISOString(),instances:[{slot:0,status:'playing'}]}));
  let calls=0;const pending=[];const advisor=new Advisor(root,async(url,opts)=>{calls++;return await new Promise(resolve=>pending.push({resolve,signal:opts.signal}));},{requestTimeoutMs:15});
  await advisor.generate();assert.equal(advisor.busy,false);assert.equal(advisor.last.plan,null);assert.equal(calls,2);assert(pending.every(p=>p.signal.aborted));assert.equal(advisor.transports.size,2,'unsettled transports remain owned');
  advisor.nextAt=0;await advisor.generate();assert.equal(calls,2,'timeout does not create duplicate paid AI request');
  const persisted=fs.readFileSync(advisor.file,'utf8');for(const r of pending)r.resolve({ok:true,json:async()=>({})});await flush();assert.equal(advisor.transports.size,0);assert.equal(fs.readFileSync(advisor.file,'utf8'),persisted,'late response cannot publish stale advice');
  const body=new Advisor(root,async()=>({ok:true,json:()=>new Promise(()=>{})}),{requestTimeoutMs:15});await assert.rejects(()=>body.request({key:'fake',model:'test',url:'https://api.meta.ai/v1/chat/completions'},{},'api.meta.ai'),/AI/);assert.equal(body.transports.size,1,'body timeout keeps transport fenced');
  const {FleetPerformance}=require('../src/fleet-performance');const fp=new FleetPerformance(root);const lag={status:'playing',runtimeV2:true,lastSaveAt:now,lastFps:30,lastFpsAt:now,livePos:{room:'w1'},v2:{scheduler:{profiler:{view:()=>({at:now,eventLoop:{p95Ms:300}})}}}};
  fp.sample([lag],1,8000,now);now+=5000;lag.lastSaveAt=now;lag.lastFpsAt=now;fp.sample([lag],1,8000,now);assert.equal(lag.resourceHealth.mode,'reduced','event-loop overload reduces work despite high FPS and ample RAM');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 console.log('PASS host/loop degradation without FPS, evidence-based recovery, native console freshness, parallel independent health lanes, AI fetch/body deadline and no late/duplicate advice');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
