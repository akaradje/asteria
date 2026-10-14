'use strict';
const economy=require('../economy'),gear=require('../gear-value');
const slots=['weapon','offhand','head','armor','boots','wing','acc1','acc2'];
function assess(save,cat,wiki,at=Date.now()){
 wiki=economy.withNativeRecipes(wiki,cat);
 const budget=Math.max(0,(save.coins||0)-require('../upgrade-reserve').reserve(save,cat.world));
 const refine=economy.refinePlan({...save,coins:budget,items:cat.items,world:cat.world,wiki});
 const goal=require('../equipment-goal').assess(save,cat);let firstAccessoryTarget=null;
 const rows=slots.map(slot=>{
  const id=save.equip?.[slot],item=cat.items[id],type=slot.startsWith('acc')?'acc':slot,refineCapability=require('../knowledge/refine-capability').support(slot,cat.world);
  const comparisonSave=slot==='acc2'&&!save.equip?.acc1&&firstAccessoryTarget?{...save,equip:{...save.equip,acc1:firstAccessoryTarget}}:save;
  const choices=Object.values(cat.items).filter(it=>it.slot===type&&economy.canUse(it,save.job,cat.world)&&(it.reqLv||1)<=(save.lv||1)&&!it.warOnly&&!Object.values(comparisonSave.equip||{}).includes(it.id)).map(it=>({it,c:gear.compare(comparisonSave,cat,it.id)})).filter(x=>x.c.upgrade&&x.c.slot===slot).sort((a,b)=>require('../equipment-goal').priority(b.c)-require('../equipment-goal').priority(a.c));
  const target=choices[0],fg=cat.world?.FORGE,stage=save.stage?save.stage[id]||0:null,stageMax=item&&fg?.canStage(item)?fg.STAGE.max:0;
  if(slot==='acc1')firstAccessoryTarget=target?.it.id;
  const maxHoles=item&&typeof cat.world.maxHoles==='function'?cat.world.maxHoles(item):null;
  const row={slot,id:id||null,name:item?.name||'ช่องว่าง',tier:item?.tier||0,rarity:item?.rarity||null,target:target?{id:target.it.id,name:target.it.name,tier:target.it.tier,gain:target.c.gain,goalPromotion:target.c.goalPromotion,confirmedBest:false}:null,refine:save.refine?.[id]||0,refineMax:item&&refineCapability.state==='supported'?refineCapability.max:null,refineState:refineCapability.state,stage,stageMax,holes:save.holes?save.holes[id]||0:null,holesMax:maxHoles,sockets:save.sockets?save.sockets[id]||[]:null,options:type==='weapon'?save.weaponOpts?.[id]??null:null,optionStarsMax:type==='weapon'?5:0,missing:[]};
  if(stage!==null&&stageMax>stage){const cost=fg.stageCost(fg.tierOf(item),stage+1),frag=fg.frag(fg.tierOf(item)),core=cost.core?.find(k=>(save.materials?.[k]||0)>=cost.coreN)||cost.core?.[0];row.stageNext={to:stage+1,chance:cost.chance,cost:{Copper:cost.coin,[frag]:cost.frag,...(core?{[core]:cost.coreN}:{})},copy:cost.copy};for(const [name,want]of Object.entries(row.stageNext.cost)){const have=name==='Copper'?budget:save.materials?.[name]||0;if(have<want)row.missing.push({name,have,want});}if(cost.copy){const copies=(save.bag||[]).filter(b=>(typeof b==='string'?b:b.id)===id).length,locks=save.plk?.[id],locked=Array.isArray(locks)?locks[0]:0;const proof=save.plk&&Number.isInteger(locked)&&locked>=0&&locked<=copies&&!save.locks?.includes(id)&&!locks?.[1];row.stageNext.copyProof=!!proof&&copies-locked>=1;if(!row.stageNext.copyProof)row.missing.push({name:'ชิ้นซ้ำไม่ล็อก (ค่าลงทุนอยู่กับชิ้นที่สวม)',have:proof?copies-locked:null,want:1});}row.stageNext.ready=!row.missing.length;}
  if(row.target){const recipe=wiki?.crafting?.recipes?.find(r=>r.resultId===row.target.id);if(recipe){const have=require('../runtime/paid-actions').inventory(save,cat);row.target.recipe={source:recipe.source||'wiki_snapshot',verifiedBuild:recipe.verifiedBuild||null,cost:recipe.cost};row.target.missing=Object.entries(recipe.cost).map(([name,want])=>({name,want,have:have[name==='tokens'?'Guild Token':name==='runeDust'?'Rune Dust':name]||0})).filter(x=>x.have<x.want);}}
  const rf=refine.steps.find(x=>x.id===id);if(rf&&!rf.can)row.missing.push(...(rf.oreHave<rf.oreNeed?[{name:rf.oreName,have:rf.oreHave,want:rf.oreNeed}]:[]),...(budget<rf.coinCost?[{name:'Copper',have:budget,want:rf.coinCost}]:[]));
  row.goal=goal?.rows.find(r=>r.slot===slot)||null;row.goalComplete=row.goal?.complete??null;row.complete=(!goal||row.goalComplete)&&!!item&&!target&&row.refine>=row.refineMax&&stage>=stageMax&&maxHoles!==null&&row.holes>=maxHoles&&(maxHoles===0||Array.isArray(row.sockets)&&row.sockets.filter(Boolean).length>=maxHoles)&&(type!=='weapon'||Array.isArray(row.options)&&row.options.length===3&&row.options.every(o=>o?.s===5));return row;
 });
 return {at,build:cat.build,budget,rows,goal,complete:rows.every(r=>r.complete),drill:save.drill??null,method:'loaded world rules and saved equipment; targets are loadout estimates, not proven optimal',reason:'ตรวจครบ 8 ช่อง · ไม่ถือว่าสีไอเทมหรือคลิกสำเร็จคือถึงเพดาน'};
}
module.exports={assess,slots};
