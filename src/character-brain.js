'use strict';
const economy=require('./economy');
const FOCUSES={focus_growth:'เก็บเลเวลและปลดล็อก',focus_income:'สะสมเงินสำรอง',focus_gear:'หาอุปกรณ์ที่ดีกว่าของที่ถือ',focus_craft:'เก็บวัตถุดิบคราฟ',focus_refine:'พัฒนาอุปกรณ์ที่ใส่'};
function profile(save,cat,wiki,{reserved={},equipmentOnly=false,blockedCraftIds=new Set()}={}){
 wiki=economy.withNativeRecipes(wiki,cat);
 const {items={},world}=cat,job=save.job||'novice',lv=save.lv||1;
 const ingredientIndex=new Map();for(const it of Object.values(items)){ingredientIndex.set(it.id,it);if(!ingredientIndex.has(it.name))ingredientIndex.set(it.name,it);}
 const chain=economy.jobChain(job,world),role=chain.includes('knight')?'แนวหน้า':chain.includes('priest')?'สนับสนุน':chain.includes('mage')?'โจมตีเวท':chain.includes('ranger')?'โจมตีระยะไกล':chain.includes('assassin')?'โจมตีเป้าหมายเดี่ยว':chain.includes('monk')?'ต่อสู้ระยะประชิด':'ฝึกพื้นฐาน';
 const held=economy.ownedNames(save),best=economy.bestPerSlot(held,job,lv,world,items);
 const reserve=require('./upgrade-reserve').reserve(save,world);
 const spendableCoins=Math.max(0,(save.coins||0)-(reserved.Copper||0));
 const milestones=require('./planning/progression-priority').assess(save,cat);
 const crafts=[];
 const benchmarks=new Set(); // Progression uses native rules and our outcomes, not private competitor loadouts.
 for(const r of wiki?.crafting?.recipes||[]){
  if(equipmentOnly&&r.type==='wing')continue;
  if(!milestones.equipmentAllowed&&(milestones.stage!=='wing'||r.type!=='wing'))continue;
  const it=items[r.resultId];if(r.verified===false||r.verifiedBuild&&cat.build&&r.verifiedBuild!==cat.build||(r.type==='wing'&&(!it?.recipeVerified))||!it||!['gear','wing','unique'].includes(r.type)||r.reqLv>lv||held.includes(r.resultId)||!economy.canUse(it,job,world))continue;
  if(!require('./equipment-goal').policy(cat).dynamicProgression&&r.type!=='wing'&&lv>=100&&it.rarity!=='legendary'&&Object.values(items).some(x=>x.slot===it.slot&&x.rarity==='legendary'&&(x.reqLv||1)<=lv&&economy.canUse(x,job,world)))continue;
  const comparison=require('./gear-value').compare(save,cat,r.resultId);
  const gain=comparison.gain;if(!comparison.upgrade||gain<=0&&!comparison.goalPromotion)continue;
  const missing=[],holdings={};for(const [name,want] of Object.entries(r.cost||{})){
   let have=name==='Copper'?Math.max(0,(save.coins||0)-reserve):name==='tokens'?save.tokens||0:name==='runeDust'?save.runeDust||0:name==='Boar Leaf'?save.leaves||0:(save.materials||{})[name]||0;
   if(require('./upgrade-reserve').cores.includes(name)&&Object.values(world?.HIGH_CLASSES||{}).some(c=>c.from===job))have=Math.max(0,have-1);
   const ingredient=ingredientIndex.get(name);
   if(!['Copper','tokens','runeDust'].includes(name)&&ingredient)have=held.filter(id=>id===ingredient.id).length;
   const claimKey=name==='tokens'?'Guild Token':name==='runeDust'?'Rune Dust':name;
   have=Math.max(0,have-(reserved[claimKey]||0));
   const protectedInput=save.locks?.includes(name)||!!ingredient&&save.locks?.includes(ingredient.id);
   if(protectedInput)have=0;
   holdings[name]=have;
   if(have<want)missing.push({name,want,have,...(protectedInput?{protected:true}:{})});
  }
  crafts.push({id:r.resultId,name:r.result,type:r.type,slot:comparison.slot,fillsEmpty:!save.equip?.[comparison.slot],reqLv:r.reqLv,gain,goalPromotion:comparison.goalPromotion,coinCost:r.cost.Copper||0,cost:r.cost,holdings,missing,ready:missing.length===0&&spendableCoins-(r.cost.Copper||0)>=reserve,recipeVerified:r.verified===true||it.recipeVerified===true,verifiedBuild:r.verifiedBuild||it.recipeVerificationBuild||null});
 }
 for(const c of crafts)c.valuePerCopper=c.gain/Math.max(1,c.coinCost);
 const craftPortfolio=require('./planning/craft-portfolio').portfolio(crafts,save,cat,wiki,benchmarks,{blockedCraftIds});
 // The first usable wing precedes later wing tiers and ordinary equipment.
 if(milestones.stage==='wing'){const first=[craftPortfolio.selected,...craftPortfolio.alternatives].filter(Boolean).sort((a,b)=>a.reqLv-b.reqLv||(cat.items[a.id]?.tier||0)-(cat.items[b.id]?.tier||0))[0];if(first)craftPortfolio.selected=first;}
 const craft=craftPortfolio.selected;
 const gear=milestones.equipmentAllowed?economy.gearFarm({lv,job,world,items,wiki,limit:1000}).map(g=>({...g,comparison:require('./gear-value').compare(save,cat,g.itemId)})).filter(g=>!held.includes(g.itemId)&&g.comparison.upgrade).sort((a,b)=>Number(!save.equip?.[b.comparison.slot])-Number(!save.equip?.[a.comparison.slot])||Number(!!b.comparison.goalPromotion)-Number(!!a.comparison.goalPromotion)||Number(benchmarks.has(b.itemId))-Number(benchmarks.has(a.itemId))||b.score-a.score||b.ratePct-a.ratePct):[];
 const orderedGear=require('./planning/legendary-acquisition').prioritize(gear,save,cat).slice(0,8);gear.splice(0,gear.length,...orderedGear);
 const progression=require('./planning/endgame').assess(save,cat,wiki,{craft,gear});
 const curriculum=require('./learning/mastery-curriculum').focusFromState(save,cat,{craft,gear});
 const top10Mode=require('./equipment-goal').policy(cat).top10Progression===true;
 const top10Focus=milestones.stage==='pet'?'focus_growth':milestones.stage==='class'?'focus_promotion':milestones.stage==='wing'?'focus_craft':top10Mode&&!progression.capped?(craft?.ready?'focus_craft':gear.length?'focus_gear':craft?.fillsEmpty&&craft.acquisition?.tier===1?'focus_craft':'focus_growth'):null;
 const availableFocuses=[...(progression.capped?[]:['focus_growth']),'focus_income',...(milestones.equipmentAllowed&&gear.length?['focus_gear']:[]),...(craft?['focus_craft']:[]),...(milestones.equipmentAllowed?['focus_refine']:[])];
 const combatObjective=require('./planning/combat-priority').objective(save,cat,{role,milestones,craft,reserve,spendableCoins});
 return {combatObjective,milestones,role,reserve,progression,top10Mode,top10Focus,curriculum,curriculumFocus:curriculum?.focus||null,measuredFocus:save.measuredFocus||null,coins:save.coins||0,spendableCoins,reservedResources:{...reserved},lowFunds:spendableCoins<reserve,craft,craftPortfolio,gear,held,best,availableFocuses};
}
function prioritize(candidates,focus,personal){
 if(personal?.progression?.capped)candidates=candidates.filter(c=>c.kind!=='exp');
 candidates=require('./planning/progression-priority').filter(candidates,personal?.milestones,personal?.craft);
 if(personal?.nightTraining?.active&&personal?.milestones?.pet){return [...candidates].sort((a,b)=>Number(b.kind==='exp')-Number(a.kind==='exp')||a.priority-b.priority||b.score-a.score);}
 if(personal?.milestones&&!personal.milestones.equipmentAllowed){const primary={pet:['pet','income','exp','bestiary'],class:['promotion','income','exp','bestiary'],wing:['wing','craft','income','exp','bestiary']}[personal.milestones.stage];return [...candidates].sort((a,b)=>(primary.indexOf(a.kind)<0?99:primary.indexOf(a.kind))-(primary.indexOf(b.kind)<0?99:primary.indexOf(b.kind))||a.priority-b.priority||b.score-a.score);}
 if(personal?.progression?.capped)candidates=candidates.filter(c=>c.kind!=='exp');
 const order={focus_promotion:['promotion','craft','wing','gear','refine','income'],focus_growth:['exp','bestiary','pet'],focus_income:['income','exp'],focus_gear:['gear','refine','exp'],focus_craft:['craft','wing','income','exp'],focus_refine:['refine','income','gear','exp']};
 const effective=personal?.lowFunds?'focus_income':focus||(personal?.progression?.capped?personal.progression.focus:personal?.top10Focus||personal?.measuredFocus||personal?.curriculumFocus||(personal?.craft?.ready?'focus_craft':personal?.gear?.length?'focus_gear':personal?.craft?'focus_craft':'focus_refine'));
 const kinds=order[effective];if(!kinds)return candidates;
 return [...candidates].sort((a,b)=>{const score=x=>{const n=kinds.indexOf(x.kind);return n<0?99:n;};return score(a)-score(b)||a.priority-b.priority||b.score-a.score;});
}
module.exports={FOCUSES,profile,prioritize};
