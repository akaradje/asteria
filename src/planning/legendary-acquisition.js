'use strict';
// A missing slot is an acquisition objective, never a receipt or spend permit.
const economy=require('../economy'),gear=require('../gear-value');
function gaps(save,cat){
 if(!require('../equipment-goal').policy(cat).enabled)return [];
 return (require('../equipment-goal').assess(save,cat)?.rows||[]).filter(r=>!r.rarityMet);
}
function fills(save,cat,id,slot){
 const it=cat.items?.[id];if(!it||it.rarity!=='legendary')return false;
 if(economy.ownedNames(save).includes(id)||(save.storage?.gear||[]).some(g=>g.id===id))return false;
 const missing=gaps(save,cat);if(!missing.length)return false;
 const c=gear.compare(save,cat,id);
 return c.upgrade&&c.gain>0&&(!slot||slot===c.slot)&&missing.some(r=>r.slot===c.slot);
}
function prioritize(rows,save,cat){
 if(!require('../equipment-goal').policy(cat).dynamicProgression)return rows;
 return rows.map((g,n)=>({g:{...g,legendarySlotGap:!!g.legendaryParty||fills(save,cat,g.itemId||g.id,g.slot)},n})).sort((a,b)=>Number(b.g.ownsOperation===true)-Number(a.g.ownsOperation===true)||Number(!!b.g.legendaryParty)-Number(!!a.g.legendaryParty)||Number(b.g.legendarySlotGap)-Number(a.g.legendarySlotGap)||a.n-b.n).map(x=>x.g);
}
function materialObjective(i,now=Date.now()){
 const p=i.developmentProgress,cat=i.catalog(),s=i.lastSave||{},c=p?.craftPortfolio?.selected;
 if(!['tum','vps'].includes(i.machine)||!require('../runtime/legacy-material-reserve').verified(i))return null;
 if(!p||p.build!==cat.build||now<p.at||now-p.at>=30000||!c||c.ready||!fills(s,cat,c.id,c.slot)||!c.recipeVerified||c.verifiedBuild!==cat.build||p.executionGates?.craft)return null;
 const held=require('../runtime/paid-actions').heldResources(i),reserve=require('../upgrade-reserve').reserve(s,cat.world)+(c.cost.Copper||0),free=Math.max(0,(s.coins||0)-reserve-(held.Copper||0));
 // One material listing consumes at most 5% of genuinely unreserved Copper.
 const cap=Math.min(100000,Math.floor(free*.05));if(cap<1)return null;
 const missing=Object.entries(c.cost||{}).filter(([name,n])=>Number.isSafeInteger(n)&&n>0&&!['Copper','tokens','runeDust','Guild Token','Rune Dust'].includes(name)&&!s.locks?.includes(name)&&!Object.values(cat.items).some(it=>it.id===name||it.name===name)).map(([name,n])=>({name,want:n+(held[name]||0),have:s.materials?.[name]||0})).filter(n=>Number.isSafeInteger(n.want)&&n.want>n.have);
 if(!missing.length)return null;
 return {equipment:true,goalId:c.id,slot:c.slot,missing:missing.map(n=>[n.name,n.want]),reserve:Math.max(reserve,(s.coins||0)-(held.Copper||0)-cap),maxSpend:cap};
}
function view(i,wiki,p,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),missing=gaps(s,cat),rows=[];
 for(const g of p?.gear||[]){if(!fills(s,cat,g.itemId,g.comparison?.slot)||rows.some(r=>r.itemId===g.itemId))continue;
  const item=cat.items[g.itemId],sources=[];for(const m of wiki?.monsters?.monsters||[])for(const d of m.dropTable||[])if(d.item===item.name&&d.ratePct>0)sources.push({monsterId:m.id,level:m.level,kind:m.kind,soloLevelAllowed:m.level<=(m.kind==='normal'?s.lv:s.lv-10)});
  const market=i.socialInbox?.market,b=market?.board,fresh=!!b&&b.generation===market.generation&&b.rowsValid&&now>=b.at&&now-b.at<=10000;
  const quotes=fresh?(b.list||[]).filter(q=>q.kind==='gear'&&q.item===item.id&&q.mine===false&&(!q.status||q.status==='open')).slice(0,3).map(q=>({listingId:q.id,price:q.price,n:q.n})):[];
  const partyRequired=sources.length>0&&sources.every(r=>!r.soloLevelAllowed),checks=[];
  if(partyRequired)for(const source of sources.slice(0,6)){const map=wiki?.maps?.maps?.find(m=>m.monsters?.[source.kind]?.includes(source.monsterId));if(!map)continue;
   checks.push(require('./legendary-party').proof(i,{monsterId:source.monsterId,mapId:map.id,legendaryParty:{host:i.machine,build:cat.build,recipient:i.actorIdentity?.actorId,itemId:item.id,slot:g.comparison.slot}},now,{route:true,wiki}));
  }
  const ready=checks.find(c=>c.allowed);
  rows.push({itemId:item.id,name:item.name,slot:g.comparison.slot,gain:g.comparison.gain,estimated:true,sources:sources.slice(0,6),partyRequired,party:{routeAllowed:!!ready,reason:ready?.reason||checks[0]?.reason||(partyRequired?'party_source_unverified':'solo_level_path_exists'),combatAllowed:false},market:{state:'requires_verified_gear_purchase_receipt_contract',quotes,freshBoard:fresh,executable:false}});
 }
 const c=p?.craftPortfolio?.selected;
 return {at:now,build:cat.build,missing:missing.map(r=>({slot:r.slot,id:r.id,rarity:r.rarity,refine:r.refine})),targets:rows.slice(0,4),craft:c&&fills(s,cat,c.id,c.slot)?{id:c.id,slot:c.slot,ready:c.ready,missing:c.missing,verified:c.recipeVerified&&c.verifiedBuild===cat.build}:null,craftState:c&&fills(s,cat,c.id,c.slot)?'reviewed_missing_slot_recipe':'no_selected_verified_positive_missing_slot_recipe',materialMarket:'existing_serialized_v2_material_receipt_executor_only',party:'same_host_three_native_members_with_tank_support_and_current_boss_proof',benefitMeasured:false,paymentAuthority:false};
}
module.exports={gaps,fills,prioritize,materialObjective,view};
