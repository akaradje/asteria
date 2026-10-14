'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function bind(i){
 const id=i.actorIdentity?.actorId;if(!id||i.actorStateId===id)return;
 const root=path.join(i.root,'logs','actor-state',id);fs.mkdirSync(root,{recursive:true});
 const fields=['brain','learning','outcomes','gearImpact','levelProgress','journeyMemory','developmentLedger','equipmentLedger'];
 // Some ledgers are lazy and did not exist as objects at login. Read their
 // original slot files without rewriting or treating them as native identity.
 const legacyRows=[];const slot=i.storageSlot??i.slot;
 for(const name of [`development-${slot}.json`,`development-equipment-${slot}.json`]){const file=path.join(i.root,'logs',name);if(!fs.existsSync(file))continue;const bytes=fs.readFileSync(file);let data;try{data=JSON.parse(bytes);if(!Array.isArray(data.rows))throw Error('schema');}catch{throw Error('Legacy monetary ledger unreadable; preserve original and quarantine actor');}const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const backup=path.join(i.root,'logs/migration-originals',digest+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.writeFileSync(backup,bytes,{flag:'wx',mode:0o600});
  legacyRows.push(...data.rows.filter(r=>['pending','unresolved','change_observed','spent_without_change'].includes(r.status)).map(r=>({...r,legacyIdentityUnknown:true,originalSha256:digest})));}
 const preview=fields.filter(k=>i[k]?.file&&fs.existsSync(i[k].file)).map(k=>{const b=fs.readFileSync(i[k].file);return {kind:k,sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length,scope:'legacy_namespace_unknown_native_owner',imported:false};});
 const manifest=path.join(root,'namespace.json');if(fs.existsSync(manifest)){const m=JSON.parse(fs.readFileSync(manifest));if(m.version!==1||m.actorId!==id||m.realm!==i.actorIdentity.realm||m.epoch!==i.actorIdentity.epoch)throw Error('Actor namespace identity mismatch; quarantine');}else fs.writeFileSync(manifest,JSON.stringify({version:1,actorId:id,realm:i.actorIdentity.realm,epoch:i.actorIdentity.epoch,at:Date.now(),source:'authenticated_native_character_list',legacyPreview:preview,originalsPreserved:true,policy:'New actor namespace; legacy observations are historical unverified priors, not current actor proof'}),{flag:'wx'});
 // Monetary uncertainty remains in the account journal, separate from personal learning.
 for(const key of ['developmentLedger','equipmentLedger'])if(i[key]?.rows?.length&&i.v2?.journal)i.v2.journal.importLedger(i[key].rows,i.catalog().build);
 if(legacyRows.length&&i.v2?.journal){i.v2.journal.importLedger(legacyRows,i.catalog().build);i.legacyMonetaryQuarantine={actorId:id,rows:legacyRows.length,scope:'legacy_slot_owner_unverified',replayAllowed:false};}
 i.actorStateRoot=root;i.actorStateId=id;
 i.brain=new(require('../brain-memory').BrainMemory)(root,id);
 i.learning=new(require('../director').Learning)(root,id,require('../economy').loadWiki(i.root));
 const legacyObserve=i.learning.observe;i.learning.observe=function(...args){if(!require('../learning/context-learning').farmWindowEligible(i,Date.now())||!i.v2?.learningRevision){this.prev=null;this.prevAt=0;return;}return legacyObserve.apply(this,args);};
 i.outcomes=new(require('../outcome-monitor').OutcomeMonitor)(root,id);
 i.gearImpact=new(require('../gear-impact').GearImpact)(root,id);
 i.manaDisabled=i.outcomes.data.manaDisabled||[];i.manaConserve=i.manaDisabled.length>0;
 for(const key of ['levelProgress','journeyMemory','developmentLedger','equipmentLedger','questOutcomes','activityEvidence','campaignHistory','campaignFile','campaignEvidenceKey','v3','completionMeasurements','acquisitionMeasurements','nativeRouteTravel','goalCycles','wholeCycle'])delete i[key];
 if(i.v2){i.v2.learning=new(require('../learning/context-learning').ContextLearning)(root,id);i.v2.recovery=new(require('../runtime/recovery-history').RecoveryHistory)(root,id);for(const key of ['farmEvidence','expRouteEvidence','goalFeedback','masteryMemory','trial','observations','learningRevision'])delete i.v2[key];}
 return {actorId:id,legacyPreview:preview,originalsPreserved:true};
}
module.exports={bind};
