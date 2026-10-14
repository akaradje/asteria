'use strict';
const a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {RepairHost}=require('../src/learning/repair-host'),pure=require('../src/learning/repair-pure-source'),version=require('../src/knowledge/system-version');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-repair-host-'));
(async()=>{try{
 const pipeline=require('../src/learning/repair-pipeline');
 a.equal(pipeline.classifyTest({status:1,stderr:'EACCES permission denied'}),'unavailable');
 a.equal(pipeline.classifyTest({status:1,stderr:'MODULE_NOT_FOUND'}),'unavailable');
 a.equal(pipeline.classifyTest({status:1,stderr:'AssertionError [ERR_ASSERTION]'}),'defect');
 a.equal(pipeline.classifyTest({status:null,stderr:'AssertionError'}),'unavailable');
 a.equal(pipeline.classifyTest({status:0}),'pass');
 const publicDir=path.join(root,'public');fs.mkdirSync(publicDir,{mode:0o700});fs.writeFileSync(path.join(publicDir,'test.js'),'test',{mode:0o600});pipeline.readableBundle(publicDir);
 if(process.platform!=='win32'){a.equal(fs.statSync(publicDir).mode&0o777,0o755);a.equal(fs.statSync(path.join(publicDir,'test.js')).mode&0o777,0o644);}
 for(const source of ["module['require']('fs');", "const x=module;", "module.exports=(()=>{}).constructor('return process')();", "module.exports=Object['con'+'structor'];", "module.exports=this;", "module.exports=globalThis;", "module.exports=Reflect.get({},'x');", "module.exports=Object.getPrototypeOf({});"])a.throws(()=>pure.validate(source),source);
 a(pure.validate("function run(x){return Number.isFinite(x)?Math.max(0,x):null;}module.exports={run};"));
 const file='src/planning/dependency-time.js',original='module.exports={x:1};',candidate='module.exports={x:2};';fs.mkdirSync(path.join(root,'src/planning'),{recursive:true});fs.writeFileSync(path.join(root,file),original);fs.mkdirSync(path.join(root,'logs/system-audit'),{recursive:true});fs.writeFileSync(path.join(root,'logs/system-audit/architecture-release.json'),'{}');
 const base=version.inventory(root);fs.writeFileSync(path.join(root,file),candidate);const after=version.inventory(root);fs.writeFileSync(path.join(root,file),original);
 const host=Object.create(RepairHost.prototype);host.root=root;host.policy={automaticDeploy:true};let h={service:'asteria-panel',machine:'tum',running:true,intentRevision:10,farmPid:1},calls=[];
 host.health=async()=>({...h});host.ready=async()=>({allowed:true,intentRevision:h.intentRevision});host.snapshot=()=>({gameKnowledge:{systemVersion:{loadedSystemRevision:sha(fs.readFileSync(path.join(root,file)))===sha(original)?base.revision:after.revision}}});
 host.control=async action=>{calls.push(action);h.intentRevision++;h.running=action==='start';if(action==='start'){h.farmPid=2;throw Error('ACK lost after native start');}};
 const j={id:'a'.repeat(64),file,sourceRevision:base.revision,packet:{beforeHash:sha(original)},proposal:{content:candidate},candidateRevision:after.revision,candidateFullRevision:after.fullRevision};fs.mkdirSync(host.dir(j),{recursive:true});fs.writeFileSync(host.local(j,'regression.json'),JSON.stringify({release:{sourceRevision:after.revision}}));
 await a.rejects(()=>host.deploy(j),/ACK lost/);const r=await host.deploy(j);a.equal(r.loaded,true);a.deepEqual(calls,['stop','start'],'readback resumes lost ACK without replay');j.loaded=r;
 // A later manual stop must never be turned into an automatic resume.
 h.running=false;h.intentRevision++;const rolled=await host.rollback(j);a.equal(rolled.verified,true);a.equal(rolled.operatorStopPreserved,true);a.deepEqual(calls,['stop','start']);a.equal(fs.readFileSync(path.join(root,file),'utf8'),original);
 // A concurrent human edit is preserved even after a failed canary.
 fs.writeFileSync(path.join(root,file),'module.exports={x:3};');a.equal((await host.rollback(j)).verified,undefined);a.equal(fs.readFileSync(path.join(root,file),'utf8'),'module.exports={x:3};');
 console.log('PASS restricted pure JS, actual source CAS, lost native start ACK readback, code-only rollback, manual stop and concurrent edit preservation');
}finally{if(!fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep))throw Error('Wrong temp root');fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
