'use strict';
const economy=require('./economy');
function premiumScore(item,job,world){
 const chain=economy.jobChain(job,world),magic=chain.includes('mage')||chain.includes('priest'),tank=chain.includes('knight');
 const weights={hp:tank?.07:.015,mp:magic?.025:.005,atk:magic?.1:1.5,matk:magic?1.5:.1,atkPct:magic?2:120,matkPct:magic?120:2,hpPct:tank?120:40,def:tank?1:.35,mdef:.3,crit:100,hit:.4,flee:.4};
 let total=0;for(const [k,v] of Object.entries(item?.stats||{}))total+=k.startsWith('st_')?economy.score({stats:{[k]:v}},job,world):v*(weights[k]??.1);
 return total;
}
function premiumPlan(catalog,state,job,world){
 const owned=new Set(state.owned||[]),by=Object.fromEntries(catalog.map(i=>[i.id,i]));
 const slots=['aura','title','name','wing'];let best={score:-1,cost:0,items:[]};
 function visit(n,cost,score,items){
  if(n===slots.length){if(score>best.score||(score===best.score&&cost<best.cost))best={score,cost,items};return;}
  const slot=slots[n],current=by[state.worn?.[slot]],baseline=premiumScore(current,job,world);
  visit(n+1,cost,score+baseline,items);
  for(const it of catalog.filter(i=>i.slot===slot)){
   if(!owned.has(it.id)&&(it.gacha||it.cbt||it.achievement||it.price===0))continue;
   const value=premiumScore(it,job,world),price=owned.has(it.id)?0:it.price;
   if(value<=baseline||!Number.isFinite(price)||price<0||cost+price>state.coins)continue;
   visit(n+1,cost+price,score+value,[...items,{id:it.id,slot,name:it.name,cost:price,score:value}]);
  }
 }
 visit(0,0,0,[]);return best;
}
function ownedPremiumPlan(catalog,state,job,world){
 const by=Object.fromEntries(catalog.map(i=>[i.id,i])),owned=new Set(state.owned||[]),book=new Set(state.book||[]),items=[];
 for(const slot of [...new Set(catalog.map(i=>i.slot))]){
  const current=by[state.worn?.[slot]],baseline=premiumScore(current,job,world);
  const candidates=catalog.filter(i=>i.slot===slot&&owned.has(i.id)&&!book.has(i.id)).sort((a,b)=>premiumScore(b,job,world)-premiumScore(a,job,world)||a.id.localeCompare(b.id));
  const best=candidates[0];if(best&&best.id!==current?.id&&(!current||premiumScore(best,job,world)>baseline))items.push({id:best.id,slot,name:best.name,score:premiumScore(best,job,world),cost:0});
 }
 return {items,method:'role-weighted owned native stats; cosmetic slots add no invented combat power'};
}
// High-tier gear is a long-term investment. Temporary pieces stop at the safe +4.
function refineTarget(item){return (item?.tier||1)>=4||item?.uniqueBoss?10:4;}
module.exports={premiumPlan,premiumScore,ownedPremiumPlan,refineTarget};
