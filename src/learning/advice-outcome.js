'use strict';
function metrics(m){return {actorId:m.actorId||null,build:m.build,level:m.level,exp:m.exp,job:m.job,astralStar:m.astral?.state?.s??null,astralExp:m.astral?.state?.exp??null,astralGeneration:m.astral?.generation??null,equipment:(m.development?.equipment||[]).map(e=>({slot:e.slot,id:e.id,refine:e.refine})),legendary:m.legendaryCount??null,wing:m.wing||null,pet:m.petActive||null,receipts:m.confirmedReceiptCount??null};}
function compare(a,b){if(!a||typeof a!=='object')return {comparable:false,effects:[],reason:'missing_baseline'};const after=metrics(b),effects=[];if(a.actorId&&a.actorId!==after.actorId||a.build!==after.build)return {comparable:false,effects:[],reason:'identity_or_rules_changed'};
 if(typeof a.job==='string'&&typeof after.job==='string'&&a.job!==after.job)effects.push({kind:'class',before:a.job,after:after.job});if(after.wing&&a.wing!==after.wing)effects.push({kind:'wing',before:a.wing,after:after.wing});if(!a.pet&&after.pet)effects.push({kind:'pet',after:after.pet});
 if(Number.isInteger(a.legendary)&&after.legendary>a.legendary)effects.push({kind:'legendary',delta:after.legendary-a.legendary});
 for(const e of after.equipment){const old=a.equipment?.find(x=>x.slot===e.slot);if(old?.id===e.id&&e.refine>old.refine)effects.push({kind:'refine',slot:e.slot,delta:e.refine-old.refine});else if(old&&old.id!==e.id)effects.push({kind:'equipment_changed',slot:e.slot,benefitMeasured:false});}
 if(a.astralGeneration===after.astralGeneration&&a.astralStar!==null&&after.astralStar!==null){if(after.astralStar>a.astralStar)effects.push({kind:'Astral-star',delta:after.astralStar-a.astralStar});else if(after.astralStar===a.astralStar&&after.astralExp>a.astralExp)effects.push({kind:'Astral-EXP',delta:after.astralExp-a.astralExp});}
 return {comparable:true,effects,confirmationState:after.receipts>a.receipts?'native_receipts_increased':'observed',causalVerified:false,benefitMeasured:false};
}
module.exports={metrics,compare};
