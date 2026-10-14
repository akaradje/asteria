'use strict';
// One-shot external read-only scorecard. Continuity never resets for a patch.
const fs=require('fs'),path=require('path');
function score(report,fleet,now){
 const rows=[...(fleet.members||[]),...(fleet.expansion?.members||[])],byKey=new Map(rows.map(r=>[r.key,r]));
 const dt=report.lastAt==null?0:Math.max(0,now-report.lastAt),knownInterval=dt<=60000;
 report.lastAt=now;report.observedMs+=dt;report.samples++;
 let healthy=0;const builds={};
 const feedFresh=Number.isFinite(fleet.at)&&now>=fleet.at&&now-fleet.at<15000;
 for(const expected of report.roster){const m=byKey.get(expected.key),d=m?.details,fresh=feedFresh&&m?.online===true;
  const dataFresh=fresh&&m?.detailsFresh===true&&Number.isFinite(d?.lastSaveAt)&&now>=d.lastSaveAt&&now-d.lastSaveAt<30000;
  const p=report.actors[expected.key] ||= {name:expected.name,onlineMs:0,expectedMs:0,fps:[],fpsSamples:0,lowFpsSamples:0,firstLv:null,lastLv:null,recoveries:[],lastSaveAt:null};
  p.expectedMs+=dt;if(fresh){healthy++;if(knownInterval&&p.previousHealthy)p.onlineMs+=dt;}
  if(dataFresh){p.firstLv ??= d.lv;p.lastLv=d.lv;p.lastSaveAt=d.lastSaveAt;}
  p.previousHealthy=fresh;
  if(fresh&&m?.detailsFresh===true&&Number.isFinite(d?.fpsAt)&&d.fpsAt<=now&&now-d.fpsAt<15000&&Number.isFinite(d.fps)&&d.fps>=0){p.fpsSamples++;p.lowFpsSamples+=Number(d.fps<15);p.fps.push(d.fps);p.fps=p.fps.slice(-1000);}
  const recovery=d?.recovery?.[0];if(recovery?.id&&recovery.startedAt>=report.startedAt&&!p.recoveries.includes(recovery.id))p.recoveries.push(recovery.id);
  const build=d?.levelProgress?.build||null;builds[expected.key]=build;
 }
 const complete=healthy===report.roster.length&&fleet.complete===true&&fleet.expansion?.complete===true;
 if(knownInterval&&report.previousComplete&&complete)report.completeMs+=dt;report.previousComplete=complete;
 if(dt>60000)report.gaps.push({at:now,ms:dt});
 const epoch=JSON.stringify(builds);const e=report.epochs[epoch] ||= {firstAt:now,lastAt:now,ms:0,samples:0};e.lastAt=now;e.ms+=dt;e.samples++;
 const hosts={...fleet.machines,vps:{host:fleet.expansion?.host}};
 for(const machine of ['windows','tum','vps']){const free=hosts[machine]?.host?.freeMb;if(Number.isFinite(free)){const h=report.memory[machine] ||= {samples:0,lowSamples:0,minMb:free};h.samples++;h.lowSamples+=Number(free<500);h.minMb=Math.min(h.minMb,free);}}
 report.completePct=report.observedMs?report.completeMs/report.observedMs*100:null;
 const expectedMs=Object.values(report.actors).reduce((n,r)=>n+r.expectedMs,0),healthyMs=Object.values(report.actors).reduce((n,r)=>n+r.onlineMs,0);
 report.actorAvailabilityPct=expectedMs?healthyMs/expectedMs*100:null;
 report.lastSample={at:now,online:healthy,expected:report.roster.length,complete};return report.lastSample;
}
function conclude(r,now){r.status='completed';r.finishedAt=now;const actors=Object.values(r.actors),fps=actors.reduce((n,p)=>n+p.fpsSamples,0),low=actors.reduce((n,p)=>n+p.lowFpsSamples,0);r.fpsCoveragePct=fps/(r.samples*r.roster.length)*100;r.lowFpsPct=fps?low/fps*100:null;r.longTermVerified=r.observedMs>=10800000*.95&&r.completePct>=99.5&&r.actorAvailabilityPct>=99.5&&r.gaps.length===0&&r.failures===0&&r.fpsCoveragePct>=90&&r.lowFpsPct!==null&&r.lowFpsPct<=2&&['windows','tum','vps'].every(m=>r.memory[m]?.samples/r.samples>=.9&&r.memory[m].lowSamples/r.memory[m].samples<=.01);return r;}
async function main(){
 const root=path.resolve(__dirname,'..'),dir=path.join(root,'logs/system-audit'),file=path.join(dir,'v3-soak.json'),lock=file+'.lock';fs.mkdirSync(dir,{recursive:true});
 try{const old=JSON.parse(fs.readFileSync(lock));try{process.kill(old.pid,0);throw Error('V3 recorder already has a live owner');}catch(e){if(e.code!=='ESRCH')throw e;}fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
 const runId=String(Date.now()),fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,runId}));fs.closeSync(fd);
 const cleanup=()=>{try{const l=JSON.parse(fs.readFileSync(lock));if(l.runId===runId)fs.unlinkSync(lock);}catch{}};process.once('exit',cleanup);process.once('SIGTERM',()=>process.exit(0));
 if(fs.existsSync(file)){const previous=JSON.parse(fs.readFileSync(file));fs.copyFileSync(file,path.join(dir,'v3-soak-'+previous.runId+'.json'));}
 const config=require('../src/planning/cross-party').roster(root),startedAt=Date.now(),report={version:3,runId,startedAt,targetEndAt:startedAt+10800000,status:'running',sourceRevision:require('../src/knowledge/system-version').inventory(root).revision,roster:config.members.map(r=>({key:r.machine+':'+r.slot,name:r.charName})),actors:{},memory:{},epochs:{},observedMs:0,completeMs:0,samples:0,failures:0,gaps:[],longTermVerified:false,limits:'native outgoing snapshots; continuity includes patch/reload outages; no planned offline excluded without explicit schedule; version epochs are separate from continuity; no causal performance claim'};
 let busy=false;const save=()=>{const r=require('../src/runtime/telemetry-file').writeTelemetry(file,report);if(!r.ok)throw Error('V3 recorder could not persist report');};
 const tick=async()=>{if(busy)return;busy=true;try{let fleet;try{const response=await fetch('http://127.0.0.1:4712/api/fleet',{signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('fleet unavailable');fleet=await response.json();}catch{report.failures++;fleet={};}const sample=score(report,fleet,Date.now());fs.appendFileSync(path.join(dir,'v3-soak-samples.jsonl'),JSON.stringify({runId,...sample,builds:Object.keys(report.epochs).at(-1)})+'\n');if(Date.now()>=report.targetEndAt){conclude(report,Date.now());clearInterval(timer);}save();}catch(e){report.status='recorder_failed';report.longTermVerified=false;report.error='read-only recorder persistence failed';clearInterval(timer);try{save();}catch{}process.exitCode=1;}finally{busy=false;}};
 save();const timer=setInterval(tick,30000);await tick();console.log(JSON.stringify({runId,expected:report.roster.length,status:report.status,targetEndAt:report.targetEndAt}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={score,conclude};
