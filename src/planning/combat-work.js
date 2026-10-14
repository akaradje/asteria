'use strict';
const economy=require('../economy');
// Missing inputs for an actual equipped upgrade, not a general collection list.
function requirements(i,wiki,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),out=[];
 if(!require('../runtime/freshness').fresh(i.lastSaveAt,30000,now)||i.v2?.sourceCoherence?.matches!==true||wiki?._source?.verifiedBuild!==cat.build||!require('./progression-priority').assess(s,cat).equipmentAllowed)return out;
 const held=require('../runtime/paid-actions').heldResources(i),materials=Object.fromEntries(Object.entries(s.materials||{}).map(([k,n])=>[k,Math.max(0,n-(held[k]||0))]));
 const refine=economy.refinePlan({...s,materials,coins:Math.max(0,(s.coins||0)-(held.Copper||0)-require('../upgrade-reserve').reserve(s,cat.world)),items:cat.items,world:cat.world,wiki,state:s});
 for(const r of refine.steps||[]){
  if(!require('../equipment-goal').policy(cat).dynamicProgression&&cat.items[r.id]?.rarity!=='legendary'||r.to>require('../equipment-goal').target(cat,r.slot)||!r.worthIt||r.oreHave>=r.oreNeed&&(!r.starNeed||(materials[r.starName]||0)>=r.starNeed))continue;
  out.push({id:r.id,name:r.name+' +'+r.to,purpose:'refine',expectedCombatGain:r.valuation?.expectedGain,missing:[...(r.oreHave<r.oreNeed?[{name:r.oreName,have:r.oreHave,want:r.oreNeed}]:[]),...(r.starNeed&&(materials[r.starName]||0)<r.starNeed?[{name:r.starName,have:materials[r.starName]||0,want:r.starNeed}]:[])]});
 }
 const a=i.astralObjective;
 if((require('../equipment-goal').policy(cat).dynamicProgression||!require('./astral-path').equipmentPending(i))&&a?.build===cat.build&&require('../runtime/freshness').fresh(a.at,30000,now)&&(a.state==='gate_blocked'||a.gate===true)){
  for(const n of a.missing||[]){
   if(n.kind!=='material'||!Number.isFinite(n.want)||!Number.isFinite(n.have)||n.want<=n.have)continue;
   // Alternatives are interchangeable: collect only the remaining group deficit.
   for(const name of n.id?[n.id]:n.alternatives||[])out.push({id:'astral-gate-'+a.star,name:'ทะลุขีดดาว '+a.star,purpose:'astral',missing:[{name,have:0,want:n.want-n.have}]});
  }
 }
 return out;
}
function matchesFocus(g,focus){
 const purpose=g.purpose||(g.kind==='craft-work'?'craft':null);
 return focus==='focus_refine'?g.kind==='refine'||purpose==='refine':focus==='focus_craft'?g.kind==='craft'||g.kind==='craft-work'&&purpose==='craft':focus==='focus_gear'?['gear','gear-hunt','equipment-drill'].includes(g.kind):focus==='focus_income'?g.kind==='income':false;
}
function rank(rows,focus,i){
 if(i&&require('../equipment-goal').policy(i.catalog()).dynamicProgression)return require('./combat-roi').decorate(i,rows);
 // Preserve learned ordering within each class. A collector's high kill rate
 // cannot outrank an executable input to equipment or breakthrough progress.
 const tier=g=>g.kind==='craft-wait'||g.kind==='craft-work'||g.kind==='gear-hunt'||g.kind==='team-gather'?0:g.kind==='astral-training'?1:g.kind==='card-collection'||g.kind==='development-side'?2:1;
 const protectedGoal=g=>['craft-wait','team-gather'].includes(g.kind)?2:g.goalPromotion===true?1:0;
 return rows.map((g,n)=>({g,n})).sort((a,b)=>tier(a.g)-tier(b.g)||protectedGoal(b.g)-protectedGoal(a.g)||Number(matchesFocus(b.g,focus))-Number(matchesFocus(a.g,focus))||a.n-b.n).map(x=>x.g);
}
function strategyView(rows,focus){
 const selected=rows[0],matching=rows.filter(g=>matchesFocus(g,focus)).length;
 return {action:focus||null,eligible:rows.length,matching,selected:selected?{kind:selected.kind,itemId:selected.itemId||null,material:selected.material||null,mapId:selected.mapId}:null,state:!focus?'local':selected&&matchesFocus(selected,focus)?'matched':matching?'protected_priority':'no_eligible_focus_target',benefitMeasured:false};
}
module.exports={requirements,rank,matchesFocus,strategyView};
