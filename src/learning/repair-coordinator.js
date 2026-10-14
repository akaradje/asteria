'use strict';
// Durable orchestration; models never choose commands, tests, or deployment scope.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const terminal=new Set(['COMPLETE','ROLLED_BACK','REJECTED','SUPERSEDED']);
class RepairCoordinator {
 constructor(root,adapters,{now=Date.now}={}){this.root=root;this.adapters=adapters;this.now=now;this.file=path.join(root,'logs/ai-repair/state.json');this.busy=false;try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.data={version:1,jobs:[]};}}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2));fs.renameSync(this.file+'.tmp',this.file);}
 view(){return {version:1,busy:this.busy,jobs:this.data.jobs.map(({id,stage,updatedAt,reason,nextAt,attempts,sourceRevision,build,file,result})=>({id,stage,updatedAt,reason,nextAt,attempts,sourceRevision,build,file,result}))};}
 enqueue(packet){if(!packet?.id||!packet.build||!packet.sourceRevision||!require('./repair-pipeline').scopes[packet.file])throw Error('Reviewed repair packet required');const id=hash([packet.build,packet.sourceRevision,packet.file,packet.beforeHash,packet.testHashes]);let j=this.data.jobs.find(j=>j.id===id);if(j)return j; j={id,stage:'QUEUED',packet,build:packet.build,sourceRevision:packet.sourceRevision,file:packet.file,attempts:0,createdAt:this.now(),updatedAt:this.now(),events:[]};this.data.jobs.push(j);this.save();return j;}
 transition(j,stage,reason){j.events.push({at:this.now(),from:j.stage,to:stage,reason});j.stage=stage;j.reason=reason;j.updatedAt=this.now();j.nextAt=0;this.save();this.adapters.audit?.(j,stage,reason);}
 async tick(){
  if(this.busy)return false;let j=this.data.jobs.find(j=>!terminal.has(j.stage));if(!j||this.now()<(j.nextAt||0))return false;
  this.busy=true;let lock;const lockPath=this.file+'.lock';
  try{
   fs.mkdirSync(path.dirname(this.file),{recursive:true});
   if(fs.existsSync(lockPath)){const pid=Number(fs.readFileSync(lockPath,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return false;}catch(e){if(e.code!=='ESRCH')return false;fs.unlinkSync(lockPath);}}
   try{lock=fs.openSync(lockPath,'wx');fs.writeFileSync(lock,String(process.pid));}catch(e){if(e.code==='EEXIST')return false;throw e;}
   this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));j=this.data.jobs.find(j=>!terminal.has(j.stage));if(!j||this.now()<(j.nextAt||0))return false;
   const a=this.adapters;
   if(j.stage==='QUEUED'){
    const r=await a.reproduce(j);j.reproduction=r;
    if(r.unavailable){j.nextAt=this.now()+300000;j.reason=r.reason||'isolated_runner_unavailable';this.save();return false;}
    if(r.baselineFailed!==true)return this.transition(j,'REJECTED','original_defect_not_reproduced');
    this.transition(j,'PROPOSING','isolated_baseline_failed');
   }else if(j.stage==='PROPOSING'){
    if(j.attempts>=2)return this.transition(j,'REJECTED','bounded_model_attempts_exhausted');
    j.attempts++;this.save();j.proposal=await a.propose(j);require('./repair-pipeline').validate(j.packet,j.proposal);this.transition(j,'TESTING','candidate_validated_not_executed');
   }else if(j.stage==='TESTING'){
    const r=await a.test(j);j.tests=r;
    if(r.unavailable){j.reason=r.reason||'isolated_runner_unavailable';j.nextAt=this.now()+300000;this.save();return false;}
    if(r.baselineFailedAndCandidatePassed!==true||r.fullRegressionPassed!==true||r.testsUnchanged!==true)return this.transition(j,'REJECTED','isolated_or_full_regression_failed');
    this.transition(j,'READY','immutable_tests_and_full_regression_passed');
   }else if(j.stage==='READY'){
    const r=await a.ready(j);
    if(r.superseded)return this.transition(j,'SUPERSEDED','source_or_build_changed');
    if(!r.allowed){j.reason=r.reason||'waiting_for_native_idle';j.nextAt=this.now()+30000;this.save();return false;}
    j.deployment=r;this.transition(j,'DEPLOYING','deployment_intent_persisted');
    // The adapter must inspect its own durable receipt before retrying after a crash.
   }else if(j.stage==='DEPLOYING'){
    const r=await a.deploy(j);j.loaded=r;
    if(r.ambiguous){j.reason='deployment_result_ambiguous_readback_only';j.nextAt=this.now()+30000;this.save();return false;}
    if(!r.loaded){this.transition(j,'ROLLING_BACK','candidate_not_verified_loaded');return false;}
    j.canaryStartedAt=this.now();this.transition(j,'OBSERVING','candidate_loaded_not_repaired');
   }else if(j.stage==='OBSERVING'){
    const r=await a.observe(j);j.observation=r;
    if(r.rollback===true||this.now()-j.canaryStartedAt>600000){this.transition(j,'ROLLING_BACK',r.reason||'canary_deadline_without_terminal_proof');return false;}
    if(r.terminalVerified===true&&r.identityMatches===true&&r.noRegression===true&&r.measuredMs>=Math.max(60000,j.packet?.minimumCanaryMs||60000)){j.result={terminalVerified:true,evidence:r.evidence,combatBenefitVerified:r.combatBenefitVerified===true};this.transition(j,'COMPLETE','verified_scoped_repair');}
    else{j.nextAt=this.now()+15000;j.reason=r.reason||'awaiting_terminal_canary';this.save();}
   }else if(j.stage==='ROLLING_BACK'){
    const r=await a.rollback(j);j.rollback=r;
    if(r.verified===true&&r.operationalStatePreserved===true)this.transition(j,'ROLLED_BACK','original_code_verified_operational_journals_preserved');
    else{j.nextAt=this.now()+30000;j.reason=r.reason||'rollback_readback_pending';this.save();}
   }else throw Error('Unknown repair stage');
   return true;
  }catch(e){j.lastError={at:this.now(),code:'repair_step_failed',hash:hash(String(e.message))};j.nextAt=this.now()+60000;
   if(j.stage==='PROPOSING'&&j.attempts>=2)this.transition(j,'REJECTED','model_failed_or_invalid_twice');else this.save();return false;
  }finally{if(lock!==undefined){fs.closeSync(lock);fs.unlinkSync(lockPath);}this.busy=false;}
 }
}
module.exports={RepairCoordinator};
