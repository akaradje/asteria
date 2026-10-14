'use strict';
function support(slot,world){
 const itemSlot=slot.startsWith('acc')?'acc':slot;
 if(!['weapon','offhand','head','armor','boots','acc','wing'].includes(itemSlot)&&!world?.REFINE?.slots?.includes(itemSlot))return {state:'unsupported',reason:'unknown equipment slot'};
 const rules=world?.REFINE&&Number.isSafeInteger(world.REFINE.maxRefineLevel??world.REFINE.max)?{max:world.REFINE.maxRefineLevel??world.REFINE.max}:null;if(!rules)return {state:'unknown',reason:'native refinement rules unavailable'};
 if(itemSlot==='wing'){
  const wingMax=world.REFINE.maxBySlot?.wing??rules.max;if(!Number.isSafeInteger(wingMax)||wingMax<0||wingMax>rules.max)return {state:'unknown',reason:'native wing limit invalid'};
  if(world.REFINE_STAR?.slots?.includes('wing')&&Number.isFinite(world.REFINE_HIGH?.wing)||world.REFINE.slots?.includes('wing'))return {state:'supported',max:wingMax,evidence:'native slot and refinement rules'};
  return {state:'unknown',reason:'wing refinement eligibility has not been observed for this ruleset'};
 }
 const max=world.REFINE.maxBySlot?.[itemSlot]??rules.max;
 if(!Number.isSafeInteger(max)||max<0||max>rules.max)return {state:'unknown',reason:'native slot limit invalid'};
 return {state:'supported',max,evidence:'native equipment refinement rules'};
}
function nativeRules(world){
 const r=world?.REFINE,max=r?.maxRefineLevel??r?.max;
 if(!Number.isSafeInteger(max)||max<1||!Array.isArray(r.chance)||r.chance.length<max||!r.chance.slice(0,max).every(n=>Number.isFinite(n)&&n>=0&&n<=100)||![r.cost,r.ore,r.need].every(f=>typeof f==='function'))return null;
 if(r.high!==undefined&&(!Number.isSafeInteger(r.high)||r.high<0||r.high>max||typeof r.starNeed!=='function'||typeof r.star!=='string'))return null;
 return {...r,max,maxRefineLevel:max,destructiveFrom:r.high??null};
}
function step(save,cat,id,{materials=save.materials||{},consumables=save.consumables||{},coins=save.coins||0}={}){
 const r=nativeRules(cat.world),it=cat.items[id],slot=Object.entries(save.equip||{}).find(([,v])=>v===id)?.[0];
 if(!r||!it||!slot)return null;
 const cap=support(slot,cat.world),from=save.refine?.[id]??0;
 if(cap.state!=='supported'||!Number.isSafeInteger(from)||from<0||from>=cap.max)return null;
 const high=r.destructiveFrom!==null&&from>=r.destructiveFrom,oreName=r.ore(it.tier),oreNeed=r.need(from),coinCost=r.cost(it.tier,from),starNeed=high?r.starNeed(from):0;
 if(typeof oreName!=='string'||![oreNeed,coinCost,starNeed].every(n=>Number.isSafeInteger(n)&&n>=0))return null;
 const guardName=cat.world.STONES?.guard?.name,guard=high&&typeof guardName==='string'&&(consumables[guardName]||0)>0;
 const spare=(save.bag||[]).filter(x=>(typeof x==='string'?x:x?.id)===id).length>0&&!save.locks?.includes(id);
 const chance=r.chance[from]/100;
 const cost={Copper:coinCost,[oreName]:oreNeed,...(starNeed?{[r.star]:starNeed}:{}),...(guard?{[guardName]:1}:{})};
 const ready=coins>=coinCost&&(materials[oreName]||0)>=oreNeed&&(!starNeed||(materials[r.star]||0)>=starNeed);
 return {slot,id,from,to:from+1,max:cap.max,coinCost,oreName,oreNeed,starName:starNeed?r.star:null,starNeed,guard,guardName:guard?guardName:null,destructive:high&&!guard,spare,breakChance:high&&!guard?1-chance:0,chancePct:chance*100,guaranteed:chance===1,cost,ready,riskVerified:true};
}
module.exports={support,nativeRules,step};
