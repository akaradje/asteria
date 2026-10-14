'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
function contractRevision(){return crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'proposal-contract.js'))).digest('hex');}
function decision({planner,judge,action,member,proposal,benchmark,now=Date.now(),revision=contractRevision()}={}){
 if(!planner?.ok)return {allowed:false,route:'local',reason:'planner_unavailable'};
 if(['observe','continue'].includes(action))return {allowed:true,route:'local',reason:'no_action_required'};
 if(judge?.ok&&judge.action===action&&judge.confidence>=.75)return {allowed:true,route:'dual',reason:'agreement_plus_deterministic_gates_required'};
 if(require('./autonomous-policy').allowed(action,member,proposal,now))return {allowed:true,route:'bounded_planner',reason:'validated_existing_strategy; judge_disagreement_recorded; native_executor_and_receipts_required'};
 const b=benchmark;
 // Only already-supported zero-spend route review can use a calibrated single
 // planner. Novel mutations still require their native policy and receipt gates.
 const qualified=action==='review_route'&&b?.evidenceValidated===true&&b?.version===1&&b.provider===planner.provider&&b.model===planner.model&&b.contractRevision===revision&&Number.isFinite(b.at)&&b.at<=now&&now-b.at<=86400000&&b.stage==='held_out_provider_observed'&&b.independentCases>=30&&b.invalidActions===0&&b.identityFailures===0&&b.staleDispatches===0&&b.accuracy>=.95&&b.effectEvaluation==='verified_no_regression'&&Array.isArray(b.evidenceHashes)&&b.evidenceHashes.length>=2&&b.evidenceHashes.every(x=>/^[a-f0-9]{64}$/.test(x));
 return qualified?{allowed:true,route:'calibrated_single',reason:'bounded_route_review_after_held_out_and_effect_evidence'}:{allowed:false,route:'local',reason:'disagreement_or_unqualified_provider; keep verified local policy'};
}
function load(root){try{
 const b=JSON.parse(fs.readFileSync(path.join(root,'logs/ai-routing-benchmark.json'),'utf8'));
 if(!Array.isArray(b.evidence)||b.evidence.length<2||b.evidence.length>8)return null;
 const stages=new Set(),hashes=[];
 for(const ref of b.evidence){
  if(typeof ref.path!=='string'||!/^logs\/system-audit\/[a-zA-Z0-9_-]+\.json$/.test(ref.path)||! /^[a-f0-9]{64}$/.test(ref.sha256))return null;
  const p=path.join(root,ref.path),real=fs.realpathSync(p),base=fs.realpathSync(path.join(root,'logs/system-audit'));
  if(path.dirname(real)!==base||fs.lstatSync(p).isSymbolicLink()||fs.statSync(p).size>2000000)return null;
  const bytes=fs.readFileSync(p);if(crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha256)return null;
  const e=JSON.parse(bytes);if(e.provider!==b.provider||e.model!==b.model||e.contractRevision!==b.contractRevision||!['native_provider_held_out','native_effect_evaluation'].includes(e.stage)||!Number.isFinite(e.at)||e.at>b.at||b.at-e.at>86400000)return null;
  if(e.stage==='native_provider_held_out'&&(e.independentCases!==b.independentCases||e.invalidActions!==0||e.identityFailures!==0||e.staleDispatches!==0||e.accuracy!==b.accuracy))return null;
  if(e.stage==='native_effect_evaluation'&&e.result!=='verified_no_regression')return null;
  stages.add(e.stage);hashes.push(ref.sha256);
 }
 if(stages.size!==2||new Set(hashes).size!==hashes.length)return null;
 return {...b,evidenceHashes:hashes,evidenceValidated:true};
}catch{return null;}}
module.exports={decision,load,contractRevision};
