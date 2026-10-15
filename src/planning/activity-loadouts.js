"use strict";
const economy=require('../economy'),gear=require('../gear-value');
function plan(save,cat,{build,contexts=[]}={}){
 const held=new Set(economy.ownedNames(save)),sets=cat.world?.EQUIPMENT_SETS||{},locked=new Set(save.locks||[]);
 const usable=(id,slot)=>held.has(id)&&cat.items[id]&&cat.items[id].slot===(slot.startsWith('acc')?'acc':slot)&&economy.canUse(cat.items[id],save.job,cat.world)&&(cat.items[id].reqLv||1)<=save.lv;
 return {build,at:Date.now(),activities:['solo','boss','dungeon','support'].map(activity=>{
  const equip={...save.equip},prior=require('../knowledge/modifier-effects').roleWeights(save.job,cat.world,{activity});
  const utility=e=>{const t=gear.totals(save,cat,e);if(t.unknown.length)return -Infinity;return t.score+Object.entries(t.stats).reduce((n,[key,v])=>n+v*(prior.weights[key]||0),0);};
  for(const slot of ['weapon','offhand','armor','head','boots','wing']){if(locked.has(equip[slot]))continue;const candidates=[...held].filter(id=>usable(id,slot)&&!locked.has(id));candidates.sort((a,b)=>utility({...equip,[slot]:b})-utility({...equip,[slot]:a}));if(candidates[0]&&utility({...equip,[slot]:candidates[0]})>utility(equip))equip[slot]=candidates[0];}
  const acc=[...held].filter(id=>usable(id,'acc1')&&!locked.has(id)).sort((a,b)=>utility({...equip,acc1:b})-utility({...equip,acc1:a})).slice(0,8);
  for(const a of acc)for(const b of acc){if(a===b||locked.has(equip.acc1)&&a!==equip.acc1||locked.has(equip.acc2)&&b!==equip.acc2)continue;const c={...equip,acc1:a,acc2:b};if(utility(c)>utility(equip))Object.assign(equip,c);}
  for(const set of Object.values(sets)){if(!Array.isArray(set.pieces)||!set.pieces.every(id=>{const slot=cat.items[id]?.slot;return slot&&slot!=='acc'&&usable(id,slot)&&!locked.has(equip[slot]);}))continue;const c={...equip};for(const id of set.pieces)c[cat.items[id].slot]=id;if(utility(c)>utility(equip))Object.assign(equip,c);}
  const policy=require('./theorycraft').preference(save,cat,equip),score=utility(equip);
  return {activity,equip,role:prior.role,estimatedUtility:Number.isFinite(score)?Math.round(score):null,empiricalPolicy:policy,spend:0,method:policy?'promoted_matched_ABA_owned_loadout':'owned_eight_slot_role_prior_with_set_comparison',measuredOptimal:false,comparableWindows:contexts.filter(c=>c.build===build&&c.samples>=10&&c.elapsedMs>=300000&&c.deaths===0).length};
 }),limits:'Owned usable eight-slot candidates; native ownership/copy/save gates still control swaps. No permanent card insertion, reset or spending permission.'};
}
module.exports={plan};
