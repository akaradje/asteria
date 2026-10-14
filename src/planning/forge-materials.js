'use strict';
function next(save,cat,wiki,ceiling){
 const fg=cat.world?.FORGE;if(!fg||!save.materials)return null;
 wiki=require('../economy').withNativeRecipes(wiki,cat);
 const available=require('../runtime/paid-actions').inventory(save,cat),hold={};
 // These reservations are conservative across known recipes. Do not consume quest,
 // class, wing or boss ingredients merely because the forge accepts mixed materials.
 for(const r of wiki?.crafting?.recipes||[])for(const [k,n]of Object.entries(r.cost||{}))if(Number.isFinite(n))hold[k]=Math.max(hold[k]||0,n);
 for(const m of cat.world.MONSTERS||[])if(m.kind!=='normal')for(const d of m.dropTable||[])hold[d.itemName]=Infinity;
 for(const r of ceiling.rows){
  if(r.target||!r.stageNext||r.stageNext.copy||r.stageNext.ready||r.tier<6)continue;
  const t=fg.tierOf(cat.items[r.id]),frag=fg.frag(t);if((save.materials[frag]||0)>=r.stageNext.cost[frag])continue;
  const c=fg.fragCost(t),ess=fg.essence(t),low=t>1?fg.essence(t-1):null,cost={Copper:c.coin,[ess]:c.ess,[fg.ore(t)]:c.ore,...(low?{[low]:c.low}:{})};
  if(Object.entries(cost).every(([k,n])=>(available[k]||0)>=n))return {kind:'forge-fragment',tier:t,name:frag,cost,key:'f'+t};
  for(const et of [t,t-1].filter(x=>x>0)){
   const name=fg.essence(et);if((save.materials[name]||0)>=(et===t?c.ess:c.low))continue;
   const recipe=fg.ESSENCES.find(e=>e.tier===et);if(!recipe)continue;
   const mats=recipe.mats.filter(k=>!save.locks?.includes(k)).sort((a,b)=>(save.materials[b]||0)-(save.materials[a]||0));let remaining=fg.MATS_PER_ESS;const spend={Copper:fg.essCoin(et)};
   for(const k of mats){const n=Math.min(remaining,save.materials[k]||0);if(n){spend[k]=n;remaining-=n;}if(!remaining)break;}
   if(!remaining&&Object.entries(spend).every(([k,n])=>(available[k]||0)>=n&&(k==='Copper'||(save.materials[k]||0)-n>=(hold[k]||20))))return {kind:'forge-essence',tier:et,name,cost:spend,key:'e'+et};
  }
 }
 return null;
}
module.exports={next};
