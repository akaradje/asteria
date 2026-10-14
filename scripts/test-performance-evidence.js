'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {FleetPerformance}=require('../src/fleet-performance');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-perf-evidence-')),rename=fs.renameSync;
try{
 const p=new FleetPerformance(root);let now=1000000;
 const actor={status:'playing',runtimeV2:true,lastSaveAt:now,lastFps:0,lastFpsAt:now,v2:{lastScreenAt:now-200000}};
 const first=p.sample([actor],1,4000,now);assert.equal(first.minFps,0);assert.equal(first.fpsSamples,1,'fresh observer FPS remains valid during a long route');
 const original=fs.readFileSync(p.file,'utf8');fs.renameSync=(a,b)=>{if(b===p.file)throw Object.assign(Error('locked'),{code:'EPERM'});return rename(a,b);};
 now+=6000;actor.lastSaveAt=now;actor.lastFpsAt=now;assert.doesNotThrow(()=>p.sample([actor],1,4000,now));assert.equal(p.persistence.ok,false);assert.equal(fs.readFileSync(p.file,'utf8'),original);
 fs.renameSync=rename;now+=16000;actor.lastSaveAt=now;const stale=p.sample([actor],1,4000,now);assert.equal(stale.minFps,null,'stale FPS is unknown');assert.equal(p.persistence.ok,true);assert.equal(JSON.parse(fs.readFileSync(p.file)).current.at,now);
 assert.equal(fs.readdirSync(path.dirname(p.file)).filter(n=>n.endsWith('.tmp')).length,0);
 console.log('PASS zero FPS/fresh observation timestamps, stale exclusion and locked performance telemetry retry without crashing');
}finally{fs.renameSync=rename;assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}
