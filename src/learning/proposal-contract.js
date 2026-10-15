'use strict';
const crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,20);
function facts(m){
 const scope=m.actorId||'legacy-slot:'+m.slot,values={identity:{actorId:m.actorId,build:m.build},observation:{saveAgeSeconds:m.saveAgeSeconds,status:m.status},goal:m.currentGoal||null,budget:{reserve:m.personalBrain?.reserve??null,coins:m.personalBrain?.coins??null},progress:m.measuredProgress||null,milestones:m.personalBrain?.milestones||null};
 if(m.equipmentExecution)values.equipmentExecution=m.equipmentExecution;
 if(m.executionGates)values.executionGates=m.executionGates;
 if(m.paymentRecovery)values.paymentRecovery=m.paymentRecovery;
 if(m.intelligence)values.intelligence=m.intelligence;
 if(m.system)values.system=m.system;
 if(m.vitals||m.independentStrategy)values.strategyScope={vitals:m.vitals||null,independentStrategy:m.independentStrategy===true,paymentAuthority:false};
 return Object.entries(values).map(([kind,value])=>({id:scope+':'+kind+':'+digest(value),kind,value,authority:kind==='identity'&&m.actorId?'authenticated_native_identity':'observed_snapshot_not_transaction_receipt'}));
}
const effects=['net_EXP','class','wing','pet','Legendary_slots','refine','Astral','survival','evidence'];
function verify(proposal,m,{snapshotAt,now=Date.now()}={}){
 const evidence=facts(m),ids=new Set(evidence.map(e=>e.id)),at=Date.parse(snapshotAt),rich=proposal.evidenceIds!=null;
 if(!Number.isFinite(at)||now<at||now-at>90000)throw Error('Proposal facts are stale or clock moved');
 if(rich&&(!Array.isArray(proposal.evidenceIds)||!proposal.evidenceIds.length||proposal.evidenceIds.length>12||proposal.evidenceIds.some(id=>!ids.has(id))))throw Error('AI cited unavailable evidence');
 const assumptions=proposal.assumptions||['Outcome and benefit are not measured yet'];if(!Array.isArray(assumptions)||assumptions.length>6||assumptions.some(x=>typeof x!=='string'||x.length>160))throw Error('Invalid bounded assumptions');
 const predicted=proposal.effects||[{kind:m.level>=120?'Legendary_slots':'net_EXP',direction:'improve',basis:'proposal_only'}];
 if(!Array.isArray(predicted)||predicted.length>6||predicted.some(x=>!effects.includes(x.kind)||!['improve','observe'].includes(x.direction)||x.basis!=='proposal_only'||Object.keys(x).some(k=>!['kind','direction','basis'].includes(k))))throw Error('Invented quantitative effect or unsupported objective');
 const stop=proposal.stopRule||{maxActiveMs:900000,maxDeaths:0,stopOnUncertain:true};if(!Number.isSafeInteger(stop.maxActiveMs)||stop.maxActiveMs<1000||stop.maxActiveMs>900000||stop.maxDeaths!==0||stop.stopOnUncertain!==true)throw Error('Exploration stop rule exceeds safe budget');
 return {version:2,actorId:m.actorId||null,build:m.build||null,evidenceIds:rich?proposal.evidenceIds:evidence.filter(e=>['identity','observation','goal'].includes(e.kind)).map(e=>e.id),assumptions,effects:predicted,stopRule:stop,maxSpend:0,expiresAt:at+120000,at,mode:rich?'verified_bounded_proposal':'normalized_legacy_choice',rules:['fresh_identity','native_milestone_order','no_ai_payment_authority','no_unknown_replay','single_executor'],confirmed:false,benefitMeasured:false};
}
module.exports={facts,verify,effects};
