'use strict';
// Reviewed source only; never copy accounts, journals or learning between jobs.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),review=require('../src/learning/game-release-review');
const request=JSON.parse(Buffer.from(process.argv[2]||'','base64').toString());
if(!['windows','tum','vps'].includes(request.machine)||!require('../src/knowledge/build-id').valid(request.build))throw Error('Registered review request required');
const folder=path.join(root,'logs/ai-system');fs.mkdirSync(folder,{recursive:true});
const lock=path.join(folder,'review.lock'),status=path.join(folder,'review.json');let descriptor;
function publish(stage,extra={}){require('../src/runtime/telemetry-file').writeTelemetry(status,{at:Date.now(),stage,build:request.build,...extra});}
function run(args,cwd){const r=cp.spawnSync(process.execPath,args,{cwd,encoding:'utf8',windowsHide:true,timeout:1200000,maxBuffer:2000000});if(r.status!==0)throw Error('Reviewed child task failed: '+args[0]);return r;}
(async()=>{
 try{descriptor=fs.openSync(lock,'wx');fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,at:Date.now()}));}catch(e){if(e.code==='EEXIST'){const old=JSON.parse(fs.readFileSync(lock));let alive=true;try{process.kill(old.pid,0);}catch(x){if(x.code==='ESRCH')alive=false;}if(alive)throw Error('Existing review worker owns queue');fs.unlinkSync(lock);descriptor=fs.openSync(lock,'wx');fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,at:Date.now()}));}else throw e;}
 const source=review.permitted(root,request);publish('STAGING');run(['scripts/build-expansion-release.js'],root);
 const archive=path.join(root,'logs/system-audit/expansion-release.tar.gz'),stage=path.join(folder,'jobs',crypto.randomUUID(),'source');fs.mkdirSync(stage,{recursive:true});
 const entries=cp.execFileSync('tar',['-tzf',archive],{encoding:'utf8',windowsHide:true,maxBuffer:2000000}).trim().split(/\r?\n/);
 if(entries.some(p=>path.isAbsolute(p)||p.split('/').includes('..')||/^(?:\.env|team\.json|logs|private|profiles|data\/learning)(\/|$)/.test(p)))throw Error('Archive contains operational or invalid paths');
 cp.execFileSync('tar',['-xzf',archive,'-C',stage],{windowsHide:true,timeout:60000});
 const visit=p=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const file=path.join(p,e.name);if(e.isSymbolicLink())throw Error('Source archive symlink');if(e.isDirectory())visit(file);}};visit(stage);
 fs.symlinkSync(path.join(root,'node_modules'),path.join(stage,'node_modules'),process.platform==='win32'?'junction':'dir');
 if(require('../src/knowledge/system-version').inventory(stage).fullRevision!==source.fullRevision)throw Error('Staged application differs');
 const release=await require('../src/runtime/fleet-client-release').stage(stage);if(release.build!==request.build)throw Error('Server changed while staging');
 await require('../src/knowledge/wiki-sync').refresh(stage,{build:release.build});publish('TESTING',{workspace:stage});
 run(['scripts/v32-checks.js'],stage);run(['scripts/build-architecture-release.js','--evidence=logs/system-audit/v32-checks-current.json'],stage);
 publish('PROMOTING');const result=await review.promote(root,stage,request,{confirm:async()=>{
  const probe=path.join(path.dirname(stage),'confirmation');fs.mkdirSync(probe,{recursive:true});
  const current=await require('../src/runtime/fleet-client-release').stage(probe);
  const identity=require('../src/knowledge/loaded-source').capture(probe,current.build);return {ok:true,build:current.build,sourceHashes:identity.sourceHashes};
 }});
 // Source promotion is an audited code/public-data change, not a native result.
 const file=path.join(root,'LATEST-DEVELOPMENT-STATUS.md'),at=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Bangkok'});
 const entry=`## Integrated AI game source review — ${at} Asia/Bangkok\n\nHost ${request.machine}; public game ${result.build} staged outside the farm. ${result.passed}/${result.passed} complete frozen offline suites passed. Only verified public cache files, fleet-client-release.json, wiki.json and architecture-release.json promoted; exact source ${result.sourceRevision}. Originals retained under logs/ai-system/backups; evidence ${result.evidence}. No farm/controller restart performed by reviewer; loaded game identity and actual combat outcome remain pending. Windows/tum/VPS other hosts not copied or started. Operational learning, payment journals and owner/stop intent preserved. AST structural transaction contracts auto-approved; source hashes bind integrity only. Native per-actor rolling refresh pending; unsafe contract changes stay domain-blocked without blanket farm stop.\n\n`;
 fs.writeFileSync(file,entry+(fs.existsSync(file)?fs.readFileSync(file,'utf8'):''));publish('REVIEWED_AWAITING_NATIVE_RELOAD',result);
 })().catch(e=>{publish('FAILED',{errorHash:crypto.createHash('sha256').update(String(e.message)).digest('hex'),reason:String(e.message).startsWith('Reviewed child')?e.message:'review requirements not met; originals and running farm retained'});process.exitCode=1;}).finally(()=>{if(descriptor!==undefined){fs.closeSync(descriptor);fs.unlinkSync(lock);}});
