'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {promote}=require('../src/learning/game-release-review'),{suites}=require('./v32-checks');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-source-review-')),root=path.join(folder,'host'),stage=path.join(folder,'stage');
 const write=(base,p,v)=>{fs.mkdirSync(path.dirname(path.join(base,p)),{recursive:true});fs.writeFileSync(path.join(base,p),typeof v==='string'?v:JSON.stringify(v));};
 try{
  for(const base of [root,stage]){write(base,'src/fixture.js','module.exports={}');for(const suite of suites)write(base,'scripts/test-'+suite+'.js','// isolated contract fixture');}
  write(root,'logs/host-intent.json',{mode:'running',revision:7});write(root,'logs/ai-auto.json',{enabled:true});write(root,'data/learning/character/private-memory.json','PRESERVE_ACTOR_MEMORY');write(root,'logs/payments.json','UNCERTAIN_DO_NOT_REPLAY');
  const build='fixture',urls=['https://asteria-online.io/asteria-online-visual-polish.html','https://asteria-online.io/asteria-world-system.js','https://asteria-online.io/asteria-net.js'],bodies=[fs.readFileSync(path.join(__dirname,'../cache/add136aa/asteria-online.io/asteria-online-visual-polish.html'),'utf8'),'AsteriaWorld','AsteriaNet'];
  const release={version:1,build,files:urls.map((url,i)=>({url,sha256:hash(bodies[i])})),dependencies:['https://asteria-online.io/asteria-i18n.js','https://asteria-online.io/asteria-audio.js','https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'].map(url=>({url,sha256:hash('boot dependency')}))};
  for(const [i,file]of release.files.entries())write(stage,'cache/'+build+'/'+require('../src/assetcache').keyFor(file.url),bodies[i]);for(const d of release.dependencies)write(stage,'cache/'+build+'/'+require('../src/assetcache').keyFor(d.url),'boot dependency');
  write(stage,'cache/'+build+'/asteria-online.io/_root.json',{target:urls[0]});write(stage,'machines/fleet-client-release.json',release);write(stage,'data/wiki.json',{_source:{verifiedBuild:build}});
  const inventory=require('../src/knowledge/system-version').inventory(root),identity=require('../src/knowledge/loaded-source').capture(stage,build);
  const report={at:Date.now(),sourceRevision:inventory.revision,fullSourceRevision:inventory.fullRevision,gameSourceSignature:identity.signature,offlinePassed:true,failed:0,rows:suites.map(suite=>({suite,exit:0,testSha256:hash('// isolated contract fixture')}))};
  const request={machine:'windows',build,sourceRevision:inventory.revision,intentRevision:7},confirm=async()=>({ok:true,build,sourceHashes:identity.sourceHashes});
  const evidence=()=>{write(stage,'logs/system-audit/v32-checks-current.json',report);write(stage,'logs/system-audit/architecture-release.json',{sourceRevision:inventory.revision,build,stages:{sourceChecks:'PASSED'}});};evidence();
  await assert.rejects(()=>promote(root,stage,request,{confirm:async()=>({ok:true,build:'changed',sourceHashes:identity.sourceHashes})}),/Server changed/);
  await assert.rejects(()=>promote(root,stage,request,{confirm:async()=>({ok:true,build,sourceHashes:{...identity.sourceHashes,client:'0'.repeat(64)}})}),/Server changed/,'same-build source change cannot use old test result');
  write(root,'logs/host-intent.json',{mode:'operator_stopped',revision:8});await assert.rejects(()=>promote(root,stage,request,{confirm}),/intent changed/);write(root,'logs/host-intent.json',{mode:'running',revision:7});
  write(root,'logs/ai-auto.json',{enabled:false});await assert.rejects(()=>promote(root,stage,request,{confirm}),/intent changed/);write(root,'logs/ai-auto.json',{enabled:true});
  const old=report.rows[0];report.rows[0]={...old,exit:1};evidence();await assert.rejects(()=>promote(root,stage,request,{confirm}),/immutable/);report.rows[0]=old;
  const last=report.rows.at(-1);report.rows[report.rows.length-1]=old;evidence();await assert.rejects(()=>promote(root,stage,request,{confirm}),/immutable/);report.rows[report.rows.length-1]=last;evidence();
  await assert.rejects(()=>promote(root,stage,request,{confirm,beforeCopy:()=>write(root,'src/fixture.js','changed source')}),/source changed/i);write(root,'src/fixture.js','module.exports={}');
  const result=await promote(root,stage,request,{confirm});assert.equal(result.loaded,false);assert.equal(result.nativeOutcome,false);assert.equal(result.passed,suites.length);assert.equal(fs.readFileSync(path.join(root,'logs/payments.json'),'utf8'),'UNCERTAIN_DO_NOT_REPLAY');assert.equal(fs.readFileSync(path.join(root,'data/learning/character/private-memory.json'),'utf8'),'PRESERVE_ACTOR_MEMORY');
  assert(result.files.every(f=>!f.path.startsWith('data/learning')&&!/\.env|team\.json|profiles/.test(f.path)));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'logs/system-audit/architecture-release.json'))).build,build);
  console.log('PASS frozen complete-suite/test hashes, app drift, build/same-build source drift, operator/AI pause, public-only promotion, exact readback and retained operational journals');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
