'use strict';
const contract=require('./proposal-contract'),policy=require('./autonomous-policy');
function choice(m,now){
 if(m.status!=='playing'||!m.actorId||!m.build||m.system?.sourceMatches===false||!Number.isFinite(m.saveAgeSeconds)||m.saveAgeSeconds<0||m.saveAgeSeconds>30)return null;
 const b=m.personalBrain||{},available=b.availableFocuses||[],investment=m.development?.investment?.selected;
 const missing=m.legendaryAcquisition?.missing?.length&&m.legendaryAcquisition?.targets?.length;
 const ordered=[...(b.lowFunds?['focus_income']:[]),...(missing?[m.legendaryAcquisition.craft?.ready?'focus_craft':'focus_gear']:[]),...(investment?.kind==='refine'?['focus_refine']:[]),...(b.craft?.ready?['focus_craft']:[]),...((m.legendaryCount??8)<8?['focus_gear']:[]),...(b.craft?.missing?.length?['focus_craft']:[]),'focus_refine','focus_gear','focus_craft','focus_growth'];
 for(const action of [...new Set(ordered)]){
  if(!available.includes(action)||!policy.feasibleFocus(action,m))continue;
  const proposal=contract.verify({action,evidenceIds:contract.facts(m).filter(f=>['identity','observation','budget'].includes(f.kind)).map(f=>f.id),effects:[{kind:'evidence',direction:'observe',basis:'proposal_only'}],stopRule:{maxActiveMs:180000,maxDeaths:0,stopOnUncertain:true}},m,{snapshotAt:new Date(now).toISOString(),now});
  if(policy.allowed(action,m,proposal,now))return {slot:m.slot,action,reason:'Local deterministic combat priority; native owner/reserve/receipt gates decide execution; no spending authority',proposal};
 }
 return {slot:m.slot,action:'continue',reason:'Preserve productive/protected owner while collecting eligible combat evidence'};
}
function select(result,state,now=Date.now()){
 const planner=result?.plannerProvider||'openrouter';if(result?.plan&&result.providers?.[planner]?.ok)return result;
 const at=Date.parse(state.snapshotAt);if(!Number.isFinite(at)||now<at||now-at>90000)return result;
 const members=state.members.map(m=>choice(m,now)).filter(Boolean);if(!members.length)return result;
 return {...result,at:new Date(now).toISOString(),snapshotAt:state.snapshotAt,plannerProvider:'local',providers:{...result?.providers,local:{ok:true,model:'deterministic-native-strategy-v1'}},fallback:{mode:'deterministic_zero_spend_strategy',unavailableProvider:planner},plan:{summary:'Local strategic review during provider outage; no payment permissions',members}};
}
function route(result,m,state,now=Date.now()){
 const member=state.members.find(x=>x.slot===m.slot);
 return {allowed:result.plannerProvider==='local'&&result.fallback?.mode==='deterministic_zero_spend_strategy'&&!!member&&member.system?.sourceMatches!==false&&policy.allowed(m.action,member,m.proposal,now),route:'deterministic_native_strategy',reason:'verified fresh zero-spend focus; original native gates retained'};
}
module.exports={choice,select,route};
