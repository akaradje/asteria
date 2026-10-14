'use strict';
const economy=require('../economy'),gear=require('../gear-value');
function objective(save,cat,wiki,{build,now=Date.now()}={}){
 wiki=economy.withNativeRecipes(wiki,cat);
 const role=require('../character-brain').profile(save,cat,wiki),reserve=role.reserve,held=role.held;
 const nodes=[],reserved={Copper:reserve},recipes=new Map((wiki?.crafting?.recipes||[]).map(r=>[r.resultId,r]));
 const monsters=Array.isArray(wiki?.monsters)?wiki.monsters:Object.values(wiki?.monsters||{}).flat();
 function add(id,seen=new Set()){
  if(seen.has(id))return;seen.add(id);const item=cat.items?.[id],recipe=recipes.get(id);if(!item)return;
  const dependencies=[];
  for(const[name,amount]of Object.entries(recipe?.cost||{})){
   const ingredient=Object.values(cat.items||{}).find(i=>i.id===name||i.name===name);
   if(ingredient&&recipes.has(ingredient.id)){dependencies.push(ingredient.id);add(ingredient.id,seen);}
   if(!held.includes(id))reserved[name]=Math.max(reserved[name]||0,amount+(name==='Copper'?reserve:0));
  }
  nodes.push({id,name:item.name,slot:item.slot,reqLv:item.reqLv||1,owned:held.includes(id),dependencies,cost:recipe?.cost||null,source:recipe?'craft':monsters.some(m=>m.dropTable?.some(d=>(d.itemName||d.item)===item.name))?'drop':'catalog_only'});
 }
 const targets=[];
 for(const slot of ['weapon','offhand','armor','head','boots','wing','acc1','acc2']){
  const candidates=Object.values(cat.items||{}).filter(i=>i.slot===(slot.startsWith('acc')?'acc':slot)&&economy.canUse(i,save.job,cat.world)&&(i.reqLv||1)<=(save.lv||1)&&!i.warOnly&&(require('../equipment-goal').policy(cat).dynamicProgression||!require('../equipment-goal').policy(cat).enabled||i.rarity==='legendary')&&(slot!=='acc2'||i.id!==targets.find(t=>t.slot==='acc1')?.id));
  candidates.sort((a,b)=>economy.score(b,save.job,cat.world)-economy.score(a,save.job,cat.world));
  const current=cat.items?.[save.equip?.[slot]],completeSlot=require('../equipment-goal').assess(save,cat)?.rows.find(r=>r.slot===slot)?.rarityMet;
  const owned=candidates.filter(c=>held.includes(c.id)&&!Object.entries(save.equip||{}).some(([other,id])=>other!==slot&&id===c.id));
  const dynamic=require('../equipment-goal').policy(cat).dynamicProgression;const best=dynamic?candidates.map(it=>({it,g:gear.compare(save,cat,it.id)})).filter(r=>r.g.upgrade).sort((a,b)=>b.g.gain-a.g.gain)[0]?.it||current:completeSlot?current:owned[0]||candidates[0];if(best){targets.push({slot,id:best.id,name:best.name,reqLv:best.reqLv||1,method:completeSlot?'preserve_legendary_milestone':owned.length?'equip_owned_first':'catalog_weighted_target',confirmedBest:false,milestonePriority:completeSlot?1:0});add(best.id);}
 }
 if(role.craft)add(role.craft.id);
 targets.sort((a,b)=>a.milestonePriority-b.milestonePriority);
 return {at:now,build,progression:role.progression,equipmentGoal:require('../equipment-goal').assess(save,cat),role:role.role,targets,nodes,reserved,spendableCopper:Math.max(0,(save.coins||0)-(reserved.Copper||reserve)),next:role.lowFunds?{kind:'income',reason:'restore reserve'}:role.craft?{kind:'craft',id:role.craft.id,ready:role.craft.ready,missing:role.craft.missing}:role.gear[0]?{kind:'gear',...role.gear[0]}:{kind:'growth'},loadoutScore:gear.totals(save,cat).score,caveat:'Weighted catalog target, not a proven optimal endgame loadout; recipe graph uses available wiki evidence'};
}
module.exports={objective};
