'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto');
const ctl=require('../src/planning/activity-control'),{DailyActivities}=require('../src/planning/daily-team-activities'),{FleetActivity}=require('../src/planning/fleet-activity');
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-activity-control-'));let now=Date.now(),server;
 const json=(file,value)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));};
 try{
  const build='fd417f6',policy={...JSON.parse(fs.readFileSync('machines/daily-team-activities.json')),enabled:false};json('machines/daily-team-activities.json',policy);json('logs/fleet/local.json',{build});
  const cache=path.join(root,'cache',build,'asteria-online.io');fs.mkdirSync(cache,{recursive:true});fs.copyFileSync('cache/'+build+'/asteria-online.io/asteria-online-visual-polish.html',path.join(cache,'asteria-online-visual-polish.html'));
  const config={leader:'C0',members:Array.from({length:6},(_,n)=>({charName:'C'+n,machine:n<3?'tum':'windows',slot:n%3}))};
  const members=config.members.map(r=>({...r,lv:10,status:'playing',lastSaveAt:now,teamPartyId:2,livePos:{room:'town',at:now},vitals:{hp:1,mp:1,at:now},readiness:{ready:true,at:now},activityState:{tw:{at:now,build,minLv:15,left:3,starts:[1],run:null},gd:{at:now,build,minLv:15,left:1,guildLeft:1,guildId:5,rank:r.charName==='C0'?'leader':'member',run:null},dg:{at:now,build,minLv:15,left:1,open:true,run:null}}}));
  const party=()=>({id:2,leader:'C0',checkedAt:now,members:members.map(m=>m.charName)}),sources=()=>['tum','windows'].map(machine=>({machine,at:now,build,members:members.filter(m=>m.machine===machine),party:party()}));
  const daily=new DailyActivities(root,config,{now:()=>now}),a=new FleetActivity(root,config,'tum',{now:()=>now});
  const send=(action,extra={})=>ctl.command(root,{id:crypto.randomUUID(),revision:ctl.state(root,policy,now).revision,action,...extra},{now});
  daily.reconcile(sources(),a,build);assert.equal(a.state.phase,'IDLE');assert.equal(daily.view.enabled,false);assert.equal(daily.view.workPolicy.ownsNavigation,false);
  let out=send('rally',{kind:'tower'}),id=out.control.request.id;daily.reconcile(sources(),a,build);assert.equal(a.state.phase,'IDLE','low level keeps farming instead of gathering');assert.equal(daily.view.controls.request.status,'WAITING');assert(daily.view.controls.request.reason.includes('เลเวล'));
  assert.throws(()=>send('rally',{kind:'guild'}),/งานระดมพล/);assert.throws(()=>ctl.command(root,{id:crypto.randomUUID(),revision:'old',action:'cancel'},{now}),/สถานะปุ่ม/);assert.throws(()=>send('rally',{kind:'pvp'}),/Invalid activity/);assert.throws(()=>send('set-auto',{enabled:true,credentials:'forbidden'}),/Invalid activity/);
  for(const m of members)m.lv=15;members[4].lastSaveAt=now-40000;daily.reconcile(sources(),a,build);assert.equal(a.state.phase,'IDLE','stale member prevents gathering');members[4].lastSaveAt=now;
  daily.reconcile(sources(),a,build);assert.equal(a.state.phase,'GATHERING');assert.equal(a.state.requestId,id);const workflowId=a.state.id;daily.reconcile(sources(),a,build);assert.equal(a.state.id,workflowId,'one request begins once');
  assert(ctl.command(root,{id,revision:'initial',action:'rally',kind:'tower'},{now}).duplicate,'response loss retry with same ID does not start another run');
  now++;send('cancel');daily.reloadControls(a);assert.equal(a.state.phase,'WITHDRAWN');assert(!a.state.openAt);assert.equal(daily.reconcile(sources(),a,build).workPolicy.ownsNavigation,false);
  now+=60001;for(const m of members){m.lastSaveAt=m.livePos.at=m.vitals.at=m.readiness.at=now;for(const s of Object.values(m.activityState))s.at=now;}
  send('rally',{kind:'rift'});members[2].activityState.dg.open=false;daily.reconcile(sources(),a,build);assert.equal(a.state.phase,'WITHDRAWN');assert(daily.view.controls.request.reason.includes('Eclipse Rift'));members[2].activityState.dg.open=true;daily.reconcile(sources(),a,build);assert.equal(a.state.kind,'rift');assert.equal(a.state.phase,'GATHERING');
  a.state.phase='RUNNING';a.state.openAt=now-1;a.state.runId=99;a.persist();now++;send('set-auto',{enabled:false});daily.reloadControls(a);assert.equal(a.state.phase,'RUNNING','pause never discards a run whose quota has been spent');assert.equal(daily.policy.enabled,false);
  a.state={phase:'FINISHED'};a.persist();now++;send('rally',{kind:'guild'});now+=600001;daily.reconcile(sources(),a,build);assert.equal(a.state.phase,'FINISHED');assert.equal(daily.view.controls.request.status,'EXPIRED','request does not linger forever');
  now++;send('rally',{kind:'tower'});daily.reconcile(sources(),a,'different');assert.equal(daily.view.controls.request.status,'CANCELLED','build changed invalidates explicit request');
  const {start}=require('../src/fleet-dashboard');let calls=0;server=start(0,{activityCall:async body=>{calls++;return {ok:true,control:body||{autoEnabled:false}};}});await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  let response=await fetch(base+'/api/activity-control',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'});assert.equal(response.status,403);assert.equal(calls,0);
  response=await fetch(base+'/api/activity-control',{method:'POST',headers:{Origin:base},body:'x'.repeat(2050)});assert.equal(response.status,413);assert.equal(calls,0);
  response=await fetch(base+'/api/activity-control',{method:'POST',headers:{Origin:base},body:'null'});assert.equal(response.status,400);
  response=await fetch(base+'/api/activity-control',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',id:crypto.randomUUID(),revision:'initial'})});assert.equal(response.status,200);assert.equal(calls,1);
  const vm=require('vm'),text=fs.readFileSync('src/public/fleet-activities.js','utf8'),context={document:{getElementById:()=>null},setInterval:()=>{},api:async()=>{throw Error('unused');}};vm.createContext(context);vm.runInContext(text.replace('setInterval(readActivityControls,10000);readActivityControls();',''),context);assert(context.activityControlsText({controls:{autoEnabled:false}}).includes('ฟาร์ม'));assert(context.activityControlsText({controls:{request:{status:'WAITING',reason:'เลเวลไม่ถึง'}}}).includes('เลเวลไม่ถึง'));
  console.log('PASS activity pause, explicit six-player rally, fresh/minLv/open gates, idempotent request, stale revision, expiry/build cancellation, spent-run preservation, local-origin/size guards and fixed UI state');
 }finally{if(server)await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
