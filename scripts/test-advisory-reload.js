'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {AdvisoryReload}=require('../src/runtime/advisory-reload'),{inventory}=require('../src/knowledge/system-version');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-components-')),write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),value);};
try{
 write('src/ai-advisor.js','module.exports={v:1}');write('src/auto-brain.js','module.exports={v:1}');write('src/runtime/ai-command.js','module.exports={}');write('src/public/view.js','// view');write('src/panel.js','// controller');write('machines/fleet-client-release.json',JSON.stringify({build:'b'}));
 const policyFiles=['src/learning/autonomous-policy.js','src/learning/proposal-contract.js'];
 for(const file of policyFiles){write(file,'module.exports={v:1}');assert.equal(require(path.join(root,file)).v,1);}
 const first=inventory(root),loader=new AdvisoryReload(root,'windows'),current={advisor:{busy:false,nextAt:123,last:{id:'old'}},autoBrain:{busy:false,data:{enabled:false,nextAt:456,history:[{id:'keep'}]}}};
 write('src/public/view.js','// different view');assert.equal(inventory(root).revision,first.revision);write('src/panel.js','// different controller');assert.equal(inventory(root).revision,first.revision);
 write('src/ai-advisor.js','module.exports={v:2}');assert.equal(inventory(root).revision,first.revision);
 for(const file of policyFiles)write(file,'module.exports={v:2}');
 let calls=0;const factory=()=>{calls++;assert.equal(require(path.join(root,'src/ai-advisor.js')).v,2);for(const file of policyFiles)assert.equal(require(path.join(root,file)).v,2,'reload must replace cached strategy policy');return {advisor:{},autoBrain:{}};};
 assert.equal(loader.reload(current,factory).status,'review_required');assert.equal(calls,0);
 for(const suite of ['ai-advisor','auto-brain','advisory-reload'])write(`scripts/test-${suite}.js`,'// evidence fixture');
 const code=inventory(root),report={unchanged:true,machine:'windows',build:'b',at:Date.now(),sourceRevision:code.revision,componentRevisions:{ai:code.components.ai.revision},rows:['ai-advisor','auto-brain','advisory-reload'].map(suite=>({suite,exit:0,testSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'scripts',`test-${suite}.js`))).digest('hex')}))};
 write('logs/system-audit/version-upgrade-tests-windows-b.json',JSON.stringify(report));current.autoBrain.busy=true;assert.equal(loader.reload(current,factory).status,'waiting');assert.equal(calls,0);current.autoBrain.busy=false;
 assert.equal(loader.reload(current,factory).status,'loaded');assert.equal(calls,1);assert.equal(current.advisor.nextAt,123);assert.equal(current.autoBrain.data.enabled,false);assert.equal(current.autoBrain.data.history[0].id,'keep');assert.equal(loader.state.farmRestarted,false);
 const oldDependency=loader.state.loadedDependencyRevision,oldAI=inventory(root).components.ai.revision;
 write(policyFiles[0],'module.exports={v:3}');assert.equal(inventory(root).components.ai.revision,oldAI,'shared policy remains a farm dependency too');
 assert.equal(loader.reload(current,factory).status,'review_required','dependency-only edits require fresh frozen evidence');
 const dependencyCode=inventory(root);report.sourceRevision=dependencyCode.revision;report.at=Date.now();write('logs/system-audit/version-upgrade-tests-windows-b.json',JSON.stringify(report));
 assert.equal(loader.reload(current,()=>{assert.equal(require(path.join(root,policyFiles[0])).v,3);return {advisor:{},autoBrain:{}};}).status,'loaded');
 assert.notEqual(loader.state.loadedDependencyRevision,oldDependency,'native AI dependency fingerprint changes without top-level model edits');assert.equal(current.autoBrain.data.enabled,false);assert.equal(current.autoBrain.data.history[0].id,'keep');
 write('src/new-runtime.js','// unknown kernel');assert.notEqual(inventory(root).revision,first.revision,'unknown source remains fail-safe core');
 write('src/runtime/ai-command.js','// changed action validation');assert.notEqual(inventory(root).components.farm.revision,code.revision);
 const panel=fs.readFileSync('src/panel.js','utf8');assert(panel.includes('reloadAdvisory();')&&panel.includes('60000).unref()'));const runtime=fs.readFileSync('src/instance.js','utf8')+fs.readFileSync('src/supervisor.js','utf8');assert(!runtime.includes("require('./auto-brain')"),'farm command guards do not load advisory modules');
 console.log('PASS independent web/AI/controller identities, unknown/guard core invalidation, actual module replacement, test evidence/busy guard, preserved disabled/history/cooldown and no farm restart');
}finally{fs.rmSync(root,{recursive:true,force:true});}
