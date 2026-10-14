'use strict';
// These are diagnostic contracts over existing adapters, never a second executor.
const registry=Object.freeze({
 capacity:{adapter:'admission_reconcile',maxAttempts:2,verifyMs:60000,fallback:'observe_native_capacity'},
 supplies_travel:{adapter:'supplies',maxAttempts:2,verifyMs:180000,fallback:'independent_safe_work'},
 inventory:{adapter:'inventory',maxAttempts:2,verifyMs:180000,fallback:'independent_safe_work'},
 team:{adapter:'owner_reconcile',maxAttempts:2,verifyMs:120000,fallback:'observe_activity_checkpoint'},
 ambiguous:{adapter:'reobserve',maxAttempts:1,verifyMs:60000,fallback:'independent_resource_scope_only'},
 unknown:{adapter:'reobserve',maxAttempts:1,verifyMs:60000,fallback:'collect_specific_evidence'}
});
function select(m){
 const nodes=m.recovery?.blockedNodes||[],reason=m.recovery?.reason||'';
 const kind=nodes.includes('native-result')?'ambiguous':nodes.includes('space')?'inventory':nodes.includes('supplies')||nodes.includes('health')?'supplies_travel':m.recovery?.owner?'team':/admission|capacity.*grant|memory/i.test(reason)?'capacity':'unknown';
 const c=m.development?.campaign,campaign=['class','wing','pet','equipment'].includes(c?.phase)?c:null,upgrade=m.upgradeGoal;
 return {kind,...registry[kind],goal:{phase:campaign?.phase||upgrade?.objective||null,target:campaign?.target||upgrade?.target||null,goalId:m.currentGoal?.id||null,mapId:m.currentGoal?.mapId||null},owner:'local_progression_controller',dispatched:false};
}
function terminal(contract,effects,member,baseline){
 const {phase,target}=contract?.goal||{};
 if(!member||!baseline||!target)return [];
 if(phase==='class')return member.job===target?effects.filter(e=>e.kind==='class'):[];
 if(phase==='wing')return member.wing===target?effects.filter(e=>e.kind==='wing'):[];
 if(phase==='pet')return member.petActive===target?effects.filter(e=>e.kind==='pet'):[];
 if(phase==='equipment'){
  if(target==='Legendary-8-refine-10')return member.personalBrain?.combatObjective?.equipment?.complete===true?effects.filter(e=>['legendary','refine'].includes(e.kind)):[];
  const equipped=member.development?.equipment?.find(e=>e.id===target),old=baseline.equipment?.find(e=>e.slot===equipped?.slot);
  // Acquired-but-not-equipped, changes on another slot and generic receipt
  // counts cannot complete this task. A target refine step is progress only.
  if(equipped&&old?.id!==target)return effects.filter(e=>e.kind==='equipment_changed'&&e.slot===equipped.slot);
 }
 return [];
}
function gate(contract,attempts,now){
 const rows=(attempts||[]).filter(r=>r.result!=='REJECTED');
 const last=rows.at(-1);
 if(last&&now-last.at<contract.verifyMs)return {allow:false,reason:'awaiting_native_result',nextCheck:last.at+contract.verifyMs};
 if(rows.length>=contract.maxAttempts)return {allow:false,reason:'attempt_budget_exhausted',fallback:contract.fallback,nextCheck:now+contract.verifyMs};
 return {allow:true};
}
module.exports={registry,select,terminal,gate};
