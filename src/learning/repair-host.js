'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const pipeline=require('./repair-pipeline');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const put=(f,x)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(x));fs.renameSync(f+'.tmp',f);};
class RepairHost {
 constructor(root,policy){
  this.root=fs.realpathSync(root);this.policy=policy;
  if(!({tum:'/opt/asteria-node-a/asteria',vps:'/opt/asteria-node-b/asteria'}[policy?.host]===this.root)||policy.dockerHost!=='unix:///run/asteria-repair/docker.sock'||!/^sha256:[a-f0-9]{64}$/.test(policy.image||''))throw Error('Registered host and pinned dedicated runner required');
 }
 dir(j){if(!/^[a-f0-9]{64}$/.test(j.id))throw Error('Repair identity required');return path.join(this.root,'logs/ai-repair/jobs',j.id);}
 local(j,n){return path.join(this.dir(j),n);}
 audit(j,stage,reason){const f=path.join(this.root,'LATEST-DEVELOPMENT-STATUS.md'),at=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Bangkok'});const entry=`## Automatic scoped repair ${j.id.slice(0,12)} — ${at} Asia/Bangkok\n\nStage ${stage}; ${reason}. File ${j.file}. Baseline ${j.sourceRevision}; candidate ${j.candidateRevision||'not tested'}. Isolated/full tests ${j.tests?.fullRegressionPassed===true?'passed':'not confirmed'}; native loaded ${j.loaded?.loaded===true?'confirmed':'not confirmed'}. Combat benefit ${j.result?.combatBenefitVerified===true?'verified':'not verified'}. Host ${this.policy.host} only; Windows/other host not changed. Original source and journals retained; details in logs/ai-repair/jobs/${j.id}.\n\n`;fs.writeFileSync(f,entry+(fs.existsSync(f)?fs.readFileSync(f,'utf8'):''));}
 run(program,args,options={}){const r=cp.spawnSync(program,args,{cwd:this.root,encoding:'utf8',timeout:120000,maxBuffer:2000000,windowsHide:true,...options});return {ok:r.status===0,exit:r.status,outputHash:sha((r.stdout||'')+(r.stderr||'')),stdout:r.stdout||''};}
 docker(work,code,{full=false}={}){
  pipeline.readableBundle(work);
  const name='asteria-repair-'+crypto.randomUUID(),args=['--host',this.policy.dockerHost,'run','--name',name,'--label','asteria.scope=repair-test','--rm','--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=96','--memory='+ (full?'1024m':'384m'),'--cpus='+ (full?'1.5':'0.5'),'--user=65534:65534','--tmpfs=/tmp:rw,nosuid,nodev,size='+ (full?'768m':'64m'),'--mount','type=bind,src='+work+',dst=/work,readonly'];
  if(full)args.push('--mount','type=bind,src='+path.join(this.root,'node_modules')+',dst=/deps/node_modules,readonly');
  const r=this.run('docker',[...args,this.policy.image,'node','-e',code],{timeout:full?900000:120000});if(r.exit===null)this.run('docker',['--host',this.policy.dockerHost,'rm','--force',name],{timeout:15000});return r;
 }
 async reproduce(j){
  if(!require('./repair-scope').pure.includes(j.file)){const bundle=this.local(j,'baseline-bundle');fs.mkdirSync(bundle,{recursive:true});if(!this.run(process.execPath,['scripts/build-expansion-release.js']).ok)return {unavailable:true};fs.copyFileSync(path.join(this.root,'logs/system-audit/expansion-release.tar.gz'),path.join(bundle,'source.tar.gz'));put(path.join(bundle,'baseline.json'),{file:j.file,beforeHash:j.packet.beforeHash,testHashes:j.packet.testHashes,fixtureHash:j.packet.fixture?.hash||null});if(j.packet.fixture)fs.writeFileSync(path.join(bundle,'fixture.json'),j.packet.fixture.content);const code="const fs=require('fs'),cp=require('child_process');fs.mkdirSync('/tmp/repo');if(cp.spawnSync('tar',['-xzf','/work/source.tar.gz','-C','/tmp/repo']).status!==0)process.exit(11);process.chdir('/tmp/repo');fs.symlinkSync('/deps/node_modules','node_modules');const m=JSON.parse(fs.readFileSync('/work/baseline.json')),h=b=>require('crypto').createHash('sha256').update(b).digest('hex');if(h(fs.readFileSync(m.file))!==m.beforeHash)process.exit(11);for(const [file,hash]of Object.entries(m.testHashes))if(h(fs.readFileSync(file))!==hash)process.exit(11);if(m.fixtureHash&&h(fs.readFileSync('/work/fixture.json'))!==m.fixtureHash)process.exit(11);const classify="+pipeline.classifyTest.toString()+";const result="+JSON.stringify(j.packet.tests)+".map(t=>classify(cp.spawnSync('node',[t],{encoding:'utf8',timeout:120000,env:{...process.env,...(require('fs').existsSync('/work/fixture.json')?{ASTERIA_REPAIR_FIXTURE:'/work/fixture.json'}:{})}})));process.exit(result.includes('unavailable')?11:result.includes('defect')?10:0);";const r=this.docker(bundle,code,{full:true});return {baselineFailed:r.exit===10,unavailable:![0,10].includes(r.exit),outputHash:r.outputHash};}
  const d=this.local(j,'baseline');fs.mkdirSync(d,{recursive:true});
  for(const f of [j.file,...j.packet.tests]){const body=fs.readFileSync(path.join(this.root,f));if(sha(body)!==(f===j.file?j.packet.beforeHash:j.packet.testHashes[f]))return {baselineFailed:false,reason:'baseline_changed'};const dest=path.join(d,f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body);}
  const r=this.docker(d,"const c=require('node:child_process'),classify="+pipeline.classifyTest.toString()+";const r="+JSON.stringify(j.packet.tests)+".map(t=>classify(c.spawnSync('node',['/work/'+t],{encoding:'utf8',timeout:30000})));process.exit(r.includes('unavailable')?11:r.includes('defect')?10:0);");
  return {baselineFailed:r.exit===10,unavailable:![0,10].includes(r.exit),outputHash:r.outputHash};
 }
 async propose(j){return pipeline.propose(new(require('../ai-advisor').Advisor)(this.root),j.packet);}
 async test(j){
  const stage=this.local(j,'candidate'),files=Object.fromEntries([j.file,...j.packet.tests].map(f=>[f,fs.readFileSync(path.join(this.root,f),'utf8')]));
  const broad=!require('./repair-scope').pure.includes(j.file);
  if(!broad&&!fs.existsSync(stage))pipeline.stage(stage,j.packet,j.proposal,files);
  const isolated=broad?{baselineFailedAndCandidatePassed:j.reproduction?.baselineFailed===true}:pipeline.testIsolated(stage,{image:this.policy.image,dockerHost:this.policy.dockerHost});if(!isolated.baselineFailedAndCandidatePassed)return {...isolated,unavailable:isolated.exit===125||isolated.exit===11||isolated.exit===null};
  const before=require('../knowledge/system-version').inventory(this.root);
  if(before.revision!==j.sourceRevision)return {baselineFailedAndCandidatePassed:true,fullRegressionPassed:false,reason:'source_changed'};
  const built=this.run(process.execPath,['scripts/build-expansion-release.js']);if(!built.ok)return {fullRegressionPassed:false};
  const bundle=this.local(j,'bundle');fs.mkdirSync(bundle,{recursive:true});fs.copyFileSync(path.join(this.root,'logs/system-audit/expansion-release.tar.gz'),path.join(bundle,'source.tar.gz'));
  fs.writeFileSync(path.join(bundle,'candidate.js'),j.proposal.content);if(j.packet.fixture)fs.writeFileSync(path.join(bundle,'fixture.json'),j.packet.fixture.content);put(path.join(bundle,'manifest.json'),{file:j.file,beforeHash:j.packet.beforeHash,testHashes:j.packet.testHashes,fullRevision:before.fullRevision});
  const program="const f=require('node:fs'),c=require('node:child_process'),h=x=>require('node:crypto').createHash('sha256').update(x).digest('hex');f.mkdirSync('/tmp/repo');if(c.spawnSync('tar',['-xzf','/work/source.tar.gz','-C','/tmp/repo']).status!==0)process.exit(12);process.chdir('/tmp/repo');f.symlinkSync('/deps/node_modules','node_modules');const m=JSON.parse(f.readFileSync('/work/manifest.json'));if(h(f.readFileSync(m.file))!==m.beforeHash)process.exit(13);for(const [p,v] of Object.entries(m.testHashes))if(h(f.readFileSync(p))!==v)process.exit(14);f.copyFileSync('/work/candidate.js',m.file);for(const t of Object.keys(m.testHashes)){if(c.spawnSync('node',[t],{timeout:120000,env:{...process.env,...(require('fs').existsSync('/work/fixture.json')?{ASTERIA_REPAIR_FIXTURE:'/work/fixture.json'}:{})}}).status!==0)process.exit(17);}const r=c.spawnSync('node',['scripts/v32-checks.js'],{timeout:780000});const report=f.existsSync('logs/system-audit/v32-checks-current.json')?JSON.parse(f.readFileSync('logs/system-audit/v32-checks-current.json')):null;if(r.status!==0||!report){console.log(JSON.stringify({report,exit:r.status}));process.exit(15);}if(!report.offlinePassed)process.exit(16);const release=require(process.cwd()+'/scripts/build-architecture-release').buildRelease(process.cwd(),report.build,report);console.log(JSON.stringify({report,release}));";
  const full=this.docker(bundle,program,{full:true});if(!full.ok){let report;try{report=JSON.parse(full.stdout).report;}catch{}return {baselineFailedAndCandidatePassed:true,fullRegressionPassed:false,exit:full.exit,failedSuites:report?.rows?.filter(r=>r.exit!==0||r.error).map(r=>r.suite)||[],outputHash:full.outputHash};}
  const result=JSON.parse(full.stdout);if(!result.report.offlinePassed||result.report.rows.length!==require('../../scripts/v32-checks').suites.length)throw Error('Full suite evidence missing');put(this.local(j,'regression.json'),result);j.candidateRevision=result.report.sourceRevision;j.candidateFullRevision=result.report.fullSourceRevision;j.baselineFullRevision=before.fullRevision;
  return {baselineFailedAndCandidatePassed:true,fullRegressionPassed:true,testsUnchanged:true,sourceRevision:j.candidateRevision,fullSourceRevision:j.candidateFullRevision,outputHash:full.outputHash};
 }
 async health(){const r=await fetch(this.policy.host==='tum'?'http://192.0.2.11:4711/api/panel-health':'http://127.0.0.1:4711/api/panel-health',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Native controller unavailable');const h=await r.json();if(h.service!=='asteria-panel'||h.machine!==this.policy.host)throw Error('Controller identity mismatch');return h;}
 snapshot(){const s=read(path.join(this.root,'logs/status.json'));if(Date.now()-Date.parse(s.at)<0||Date.now()-Date.parse(s.at)>30000)throw Error('Fresh native snapshot required');return s;}
 async ready(j){
  const v=require('../knowledge/system-version').inventory(this.root),build=read(path.join(this.root,'machines/fleet-client-release.json')).build;
  if(v.fullRevision!==j.baselineFullRevision||build!==j.build)return {superseded:true};
  if(this.policy.automaticDeploy!==true)return {allowed:false,reason:'automatic_deployment_disabled'};
  const h=await this.health(),s=this.snapshot(),actors=s.instances||[];
  if(!h.running||h.operatorStopped||actors.length!==3||actors.some(x=>!require('../runtime/rolling-client-refresh').safe(x)||x.runtimeV3?.controller?.owner&&['team','trade','maintenance'].includes(x.runtimeV3.controller.owner)||(x.activityState&&Object.values(x.activityState).some(a=>a?.run&&!a.run.done))))return {allowed:false,reason:'preserve_stopped_or_owned_operation'};
  return {allowed:true,host:this.policy.host,farmPid:h.farmPid,intentRevision:h.intentRevision,actors:actors.map(x=>({actorId:x.identity?.actorId,deathCount:x.deaths??null})),at:Date.now()};
 }
 async control(action){const r=this.run('python3',[this.policy.host==='tum'?'scripts/fleet-panel-bridge.py':'scripts/vps-panel-bridge.py',Buffer.from(JSON.stringify({route:action})).toString('base64')]);if(!r.ok)throw Error('Verified controller operation failed');let x=JSON.parse(r.stdout);if(x.encoding==='gzip-base64')x=JSON.parse(require('node:zlib').gunzipSync(Buffer.from(x.data,'base64')));if(x.ok===false||x.error)throw Error('Controller rejected operation');return x;}
 async deploy(j){
  const receipt=this.local(j,'deployment.json'),file=path.join(this.root,j.file),current=sha(fs.readFileSync(file)),after=sha(j.proposal.content);let r=fs.existsSync(receipt)?read(receipt):{stage:'NEW'};
  if(r.stage==='NEW'){
   const allowed=await this.ready(j);if(!allowed.allowed)return {ambiguous:true};
   if(current!==j.packet.beforeHash)throw Error('Source compare-and-swap failed');fs.copyFileSync(file,this.local(j,'original.js'));fs.copyFileSync(path.join(this.root,'logs/system-audit/architecture-release.json'),this.local(j,'original-release.json'));r={stage:'STOP_SENT',beforeHash:current,afterHash:after,expectedStopRevision:allowed.intentRevision+1,at:Date.now()};put(receipt,r);await this.control('stop');
  }
  let h=await this.health();
  if(r.stage==='STOP_SENT'){
   if(h.running||h.intentRevision!==r.expectedStopRevision)return {ambiguous:true};r.stopRevision=h.intentRevision;r.stage='STOPPED';put(receipt,r);
  }
  if(r.stage==='STOPPED'){
   if(h.running||h.intentRevision!==r.stopRevision)return {ambiguous:true};const actual=sha(fs.readFileSync(file));if(![j.packet.beforeHash,after].includes(actual))throw Error('Concurrent source edit');
   this.audit(j,'COPY_PENDING','source-only candidate, native reload pending');fs.writeFileSync(file+'.repair-tmp',j.proposal.content);fs.renameSync(file+'.repair-tmp',file);const v=require('../knowledge/system-version').inventory(this.root);if(v.fullRevision!==j.candidateFullRevision)throw Error('Tested candidate differs');
   put(path.join(this.root,'logs/system-audit/architecture-release.json'),read(this.local(j,'regression.json')).release);r.stage='START_SENT';put(receipt,r);await this.control('start');
  }
  h=await this.health();const s=this.snapshot();if(!h.running||s.gameKnowledge?.systemVersion?.loadedSystemRevision!==j.candidateRevision)return {ambiguous:true};r.stage='LOADED';r.loadedAt=Date.now();put(receipt,r);return {loaded:true,sourceRevision:j.candidateRevision,farmPid:h.farmPid,at:r.loadedAt};
 }
 async observe(j){
  const h=await this.health(),s=this.snapshot(),actors=s.instances||[],identity=actors.length===3&&actors.every(x=>j.deployment.actors.some(a=>a.actorId&&a.actorId===x.identity?.actorId));
  if(h.operatorStopped)return {reason:'operator_stop_preserved'};
  if(!identity||s.gameKnowledge?.systemVersion?.loadedSystemRevision!==j.candidateRevision)return {rollback:true,reason:'native_identity_or_source_changed'};
  const unhealthy=actors.some(x=>x.status!=='playing'||x.runtimeV3?.controller?.recovery?.blockedNodes?.includes('health')||(x.survivalStatus?.deaths||[]).some(d=>d.at>=j.canaryStartedAt));
  if(unhealthy)return {rollback:true,reason:'native_health_regression_or_unavailable'};
  // The repair's terminal witness is its immutable previously-failing fixture.
  // This is scoped code correctness plus native liveness, not combat gain.
  return {terminalVerified:j.tests?.baselineFailedAndCandidatePassed===true,identityMatches:true,noRegression:true,measuredMs:Date.now()-j.canaryStartedAt,evidence:'immutable_defect_fixture_fixed_and_native_source_liveness',combatBenefitVerified:false};
 }
 async rollback(j){
  const file=path.join(this.root,j.file),before=j.packet.beforeHash,after=sha(j.proposal.content),actual=sha(fs.readFileSync(file)),receipt=this.local(j,'rollback.json');
  if(![before,after].includes(actual))return {reason:'concurrent_source_change_requires_review'};
  let h=await this.health(),r=fs.existsSync(receipt)?read(receipt):null;
  if(!r){
   if(h.running&&j.loaded?.farmPid&&h.farmPid!==j.loaded.farmPid)return {reason:'different_farm_owner_requires_review'};
   r={stage:h.running?'STOP_SENT':'STOPPED',resume:h.running,expectedStopRevision:h.intentRevision+(h.running?1:0)};put(receipt,r);
   if(r.resume)await this.control('stop');
  }
  h=await this.health();
  if(r.stage==='STOP_SENT'){if(h.running||h.intentRevision!==r.expectedStopRevision)return {reason:'stop_result_or_new_intent_unconfirmed'};r.stage='STOPPED';put(receipt,r);}
  if(r.stage==='STOPPED'){
   if(h.running||h.intentRevision!==r.expectedStopRevision)return {reason:'new_operator_intent_preserved'};
   const original=fs.readFileSync(this.local(j,'original.js'));if(sha(original)!==before)throw Error('Backup changed');this.audit(j,'ROLLBACK_COPY','restore original code only; native reload pending');fs.writeFileSync(file+'.repair-tmp',original);fs.renameSync(file+'.repair-tmp',file);fs.copyFileSync(this.local(j,'original-release.json'),path.join(this.root,'logs/system-audit/architecture-release.json'));
   r.stage=r.resume?'START_SENT':'RESTORED_STOPPED';put(receipt,r);if(r.resume)await this.control('start');
  }
  if(r.stage==='RESTORED_STOPPED')return {verified:sha(fs.readFileSync(file))===before,operationalStatePreserved:true,farmRestarted:false,operatorStopPreserved:true};
  h=await this.health();const s=this.snapshot();return {verified:h.running&&s.gameKnowledge?.systemVersion?.loadedSystemRevision===j.sourceRevision,operationalStatePreserved:true,farmRestarted:h.running};

 }
}
module.exports={RepairHost};
