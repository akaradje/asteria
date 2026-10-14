'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const modules=['src/learning/system-recovery.js','src/ai-advisor.js','src/auto-brain.js','src/learning/knowledge-research.js','src/learning/incident-lifecycle.js','src/learning/incident-playbooks.js','src/learning/advice-outcome.js','src/learning/provider-routing.js','src/learning/autonomous-policy.js','src/learning/proposal-contract.js','src/learning/repair-pipeline.js','src/learning/ai-recovery-fallback.js','src/runtime/recovery-intelligence.js','src/planning/fleet-activity.js'];
function dependencies(root){return sha(JSON.stringify(modules.map(p=>{try{return [p,sha(fs.readFileSync(path.join(root,p)))];}catch(e){if(e.code!=='ENOENT')throw e;return [p,null];}})));}
class AdvisoryReload{
 constructor(root,machine){this.root=root;this.machine=machine;this.loaded=require('../knowledge/system-version').inventory(root).components.ai.revision;this.loadedDependencies=dependencies(root);this.state={status:'loaded',loadedRevision:this.loaded,loadedDependencyRevision:this.loadedDependencies,at:Date.now()};}
 reload(current,factory,now=Date.now()){
  const inventory=require('../knowledge/system-version').inventory(this.root),revision=inventory.components.ai.revision;
  const dependencyRevision=dependencies(this.root);
  if(revision===this.loaded&&dependencyRevision===this.loadedDependencies)return this.state;
  if(current.advisor.busy||current.autoBrain.busy)return {...this.state,status:'waiting',reason:'คำแนะนำเดิมยังทำงานอยู่'};
  let report,build,tested=false;
  try{
   build=JSON.parse(fs.readFileSync(path.join(this.root,'machines/fleet-client-release.json'))).build;
   report=JSON.parse(fs.readFileSync(path.join(this.root,'logs/system-audit',`version-upgrade-tests-${this.machine}-${build}.json`)));
   tested=report.machine===this.machine&&report.build===build&&report.unchanged&&report.sourceRevision===inventory.revision&&report.componentRevisions?.ai===revision&&now-report.at>=0&&now-report.at<3600000&&report.rows?.every(r=>r.exit===0&&!r.error)&&['ai-advisor','auto-brain','advisory-reload'].every(suite=>{const row=report.rows?.find(r=>r.suite===suite);return row?.exit===0&&!row.error&&row.testSha256===sha(fs.readFileSync(path.join(this.root,'scripts',`test-${suite}.js`)));});
  }catch{}
  if(!tested){this.state={...this.state,status:'review_required',reason:'รอผลทดสอบ AI รุ่นนี้จากเครื่องนี้',at:now};return this.state;}
  const files=modules.map(p=>path.join(this.root,p)),cache=new Map(files.map(file=>[file,require.cache[file]]));
  try{
   for(const file of files)delete require.cache[file];
   const replacement=factory();
   if(require('../knowledge/system-version').inventory(this.root).components.ai.revision!==revision||dependencies(this.root)!==dependencyRevision)throw Error('source changed during reload');
   replacement.advisor.last=current.advisor.last;replacement.advisor.nextAt=current.advisor.nextAt;
   replacement.autoBrain.data=current.autoBrain.data;
   current.advisor=replacement.advisor;current.autoBrain=replacement.autoBrain;
   this.loaded=revision;this.loadedDependencies=dependencyRevision;this.state={status:'loaded',loadedRevision:revision,loadedDependencyRevision:dependencyRevision,at:now,farmRestarted:false};
  }catch{for(const [file,module]of cache){if(module)require.cache[file]=module;else delete require.cache[file];}this.state={...this.state,status:'failed',reason:'โหลด AI ไม่สำเร็จ · รักษาสมองเดิมและฟาร์มเดิม',at:now};}
  return this.state;
 }
}
module.exports={AdvisoryReload};
