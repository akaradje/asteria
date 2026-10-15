'use strict';
const economy=require('../economy');
function refineOpportunity(i,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),wiki=economy.loadWiki(i.root),campaign=i.endgameCampaign;
 const milestones=require('../planning/progression-priority').assess(s,cat);
 const classPreparation=milestones.stage==='class'&&milestones.pet&&campaign?.phase==='class'&&campaign.ready===false&&s.lv>=(cat.world.ASCEND?.lv||99)&&i.v2?.sourceCoherence?.matches===true;
 const wingPreparation=milestones.stage==='wing'&&milestones.pet&&campaign?.phase==='wing'&&campaign.ready===false&&campaign.wing?.recipeVerified&&i.v2?.sourceCoherence?.matches===true;
 if(!milestones.equipmentAllowed&&!classPreparation&&!wingPreparation)return null;
 const early=require('../equipment-goal').policy(cat).top10Progression===true&&Number.isFinite(s.lv)&&s.lv>=20&&s.lv<cat.world?.MAX_LV&&(!campaign?.active||classPreparation);
 // An ancient potion purchase from a closed session keeps its no-replay lock,
 // but cannot refine equipment. Reuse the narrowly scoped inventory policy.
 if(!Number.isInteger(cat.world?.MAX_LV)||s.lv<cat.world.MAX_LV&&!early&&!wingPreparation||i.developmentLedger?.blocking('refine'))return null;
 const gearWindow=require('../planning/campaign-equipment').window(i,now);
 let reserve=require('../upgrade-reserve').reserve(s,cat.world),extraReserveCoins=0,reservedMaterials={},prepareBoss=false;
 if(classPreparation){
  // A small guaranteed step on already-equipped gear is preparation for the
  // missing class boss, not an endgame shopping queue. Promotion costs stay reserved.
  prepareBoss=true;
  for(const [name,n]of Object.entries(cat.world.ASCEND?.items||{}))reservedMaterials[name]=n;
 }else if(campaign?.phase==='wing'){
  // Recovery also needs equipment: waiting for a wing must not freeze the
  // guaranteed improvements that can make the next boss attempt survivable.
  // This exception only retreats to town, never overrides recovery with a hunt.
  const recovery=i.goal?.kind==='survival'&&i.survivalStatus?.until>now&&i.survivalStatus?.deaths?.length;
  const weapon=cat.items[s.equip?.weapon];
  // Solo boss preparation is a prerequisite, not idle work: an unrefined
  // endgame weapon or +0 body piece must not wait indefinitely behind a boss.
  // Only the small guaranteed foundation qualifies, never a random roll.
  prepareBoss=!gearWindow&&(weapon?.tier>=6&&weapon.rarity==='legendary'&&(s.refine?.[weapon.id]||0)<3||['head','armor','boots'].some(slot=>{const it=cat.items[s.equip?.[slot]];return it?.tier>=4&&['epic','legendary'].includes(it.rarity)&&!(s.refine?.[it.id]>0);}));
  const w=i.bossWindow;
  if(campaign.ready!==false||!campaign.wing?.recipeVerified)return null;
  if(!recovery&&!prepareBoss&&!gearWindow){
   if(w?.phase!=='side-work'||!w.boss||!Number.isFinite(w.spawnAt)||!Number.isFinite(w.assignedAt)||now-w.assignedAt<0||now-w.assignedAt>120000)return null;
   const travel=require('../planning/boss-window').travelBudget('town',w.boss.mapId,wiki),home=i.livePos?.room==='town'?0:155000;
   if(!Number.isFinite(travel.ms)||now+home+90000>=w.spawnAt-(w.leadMs||90000)-travel.ms)return null;
  }
  const wingCash=campaign.wing.coinsNeeded;
  if(!Number.isFinite(wingCash)||wingCash<0)return null;
  extraReserveCoins=wingCash;reserve+=wingCash;
  for(const [name,n]of Object.entries(campaign.wing.needs||{}))if(Number.isFinite(n)&&n>0)reservedMaterials[name]=n;
 }else if(campaign?.phase!=='complete'&&!early)return null;
 // Before cap, Legendary foundations and one guaranteed step on owned Epic
 // gear can improve survival without changing the final Legendary +10 goal.
 // Keep every promotion core and all known wing requirements out of this queue.
 if(early){
  for(const name of require('../upgrade-reserve').cores)reservedMaterials[name]=Math.max(reservedMaterials[name]||0,1);
  for(const [name,n]of Object.entries(campaign?.wing?.needs||{}))if(Number.isFinite(n)&&n>0)reservedMaterials[name]=Math.max(reservedMaterials[name]||0,n);
 }
 // Refinement cannot consume the partial stock for the next missing Legendary
 // slot. Recompute against this save; stale dashboard targets cannot reserve it.
 if(milestones.equipmentAllowed){
  const profile=require('../character-brain').profile(s,cat,wiki,{reserved:require('./paid-actions').heldResources(i),...require('./craft-scope').profileOptions(i),equipmentOnly:true});
  const bill=require('../equipment-goal').policy(cat).dynamicProgression&&profile.craft?.ready!==true?{}:require('../planning/combat-priority').legendaryBill(profile,cat.build);
  extraReserveCoins+=bill.Copper||0;reserve+=bill.Copper||0;
  for(const [name,n]of Object.entries(bill))if(name!=='Copper')reservedMaterials[name]=(reservedMaterials[name]||0)+n;
 }
 const materials=Object.fromEntries(Object.entries(s.materials||{}).map(([name,n])=>[name,Math.max(0,n-(reservedMaterials[name]||0))]));
 const foundation=early&&require('../equipment-goal').policy(cat).bridgeOwned===true;
 const plan=economy.refinePlan({equip:s.equip,refine:s.refine,materials,coins:Math.max(0,(s.coins||0)-reserve),items:cat.items,world:cat.world,wiki,foundation,state:s});
 // Legacy mode allows only guaranteed foundations. The explicit Legendary
 // goal permits one native roll up to +10 after class/wing completion; paid
 // outcome, reserves and current owners are still checked before every roll.
 const strictGoal=require('../equipment-goal').policy(cat).enabled&&(campaign?.phase==='complete'||gearWindow);
 const rows=plan.doable.filter(r=>(require('../equipment-goal').policy(cat).dynamicProgression?r.to<=require('../equipment-goal').target(cat,r.slot):early?r.guaranteed&&(r.foundation?r.to===1:r.to<=3&&cat.items[r.id]?.rarity==='legendary'):strictGoal?r.to<=require('../equipment-goal').target(cat,r.slot)&&(require('../equipment-goal').policy(cat).dynamicProgression||cat.items[r.id]?.rarity==='legendary'):r.guaranteed&&r.to<=4&&r.tier>=4)&&(require('../equipment-goal').policy(cat).dynamicProgression||['epic','legendary'].includes(cat.items[r.id]?.rarity))&&(!prepareBoss||r.slot==='weapon'&&r.to<=3||['head','armor','boots'].includes(r.slot)&&r.from===0));
 const gear=require('../gear-value'),before=gear.totals(s,cat);
 for(const r of rows){
  const after=gear.totals({...s,refine:{...s.refine,[r.id]:r.to}},cat);
  r.expectedGain=r.valuation?.expectedGain??(before.unknown.length||after.unknown.length?null:Math.max(0,after.score-before.score)*r.chancePct/100);
  r.valuePerCopper=r.expectedGain===null?null:r.expectedGain/Math.max(1,r.coinCost);
 }
 // A costly low-odds weapon roll must not starve a cheaper guaranteed step.
 // These are role-weighted estimates; only a fresh native save proves success.
 rows.sort((a,b)=>(b.valuePerCopper??-1)-(a.valuePerCopper??-1)||a.oreNeed-b.oreNeed||a.from-b.from||a.coinCost-b.coinCost);
 const gates=rows.map(r=>require('./refinement-gates').check(i,r.id,{guaranteedOnly:r.guaranteed,extraReserveCoins,reservedMaterials,...(r.foundation?{foundation:true}:{})}));
 i.refinementGates={at:now,eligible:gates.filter(g=>g.allowed).length,blocked:gates.filter(g=>!g.allowed).slice(0,8)};
 const next=rows.find((r,n)=>gates[n].allowed);return next?{...next,early,strictGoal,reserve,extraReserveCoins,reservedMaterials,prepareBoss,classPreparation,wingPreparation,campaignPhase:campaign?.phase||'training'}:null;
}
async function tick(i,screen,{townOnly=false}={}){
 if(townOnly&&i.livePos?.room!=='town')return null;
 if(!i.lastSave||!i.autoChores||screen.death||screen.panelOpen||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||require('./team-trade').blocksNavigation(i)||i.pendingTravel||i.choresBusy||i.recycling||i.survivalRecovery||i.lastSave.developmentDefensive&&i.livePos?.room!=='town'||i.v2?.trial?.active()||require('./room-policy').roomPolicy(i.livePos?.room).dungeon||!require('./freshness').decisionGate(i).allowed)return null;
 if(!i.canDo('developmentReadyCheck',30000))return null;
 if(i.capacityGoal?.kind==='trade-gear'&&require('./capacity-recovery').readyCraft(i)&&i.livePos?.room==='town'&&i.canDo('nativeTradeHeadroom',30000)){const space=await require('./wing-inventory').prepare(i,{minimum:2});if(space.ok)i.capacityGoal=null;return 'native receive headroom: '+(space.ok?'verified':space.reason);}
 if((await require('./refine-scope').refreshReadback(i)).attempted)return 'equipment native ownership readback: replan on next fresh tick';
 const p=require('../planning/development-progress').view(i);i.developmentProgress=p;
 if(p.stage==='verify')return null;
 // Retreat may start at safe farming HP; payment still requires 95% after
 // reading a fresh native screen in town. Do not wait for a lucky full-HP
 // field frame while recovery gear remains unprepared.
 if(!Number.isFinite(i.vitals?.hp)||i.vitals.hp<(i.livePos?.room==='town'?.95:.85)||!require('./freshness').fresh(i.vitals?.at,15000))return null;
 const parallel=require('../planning/campaign-equipment').window(i),target=parallel?p.equipmentWork?.selected:p.target;
 const readyCraft=!i.endgameCampaign?.active||i.endgameCampaign.phase==='complete'||parallel;
 if(readyCraft&&target?.ready&&p.stage!=='verify'&&!require('./craft-scope').blocking(i,target?.id)&&require('./paid-actions').preflight(i,'craftAtExchange',[target.name,target.type||'gear']).allowed&&i.livePos?.room!=='town'&&i.canDo('developmentCraftReturn',120000)){
  await i.expeditionAuto(false);await i.returnToTown();return 'ready development craft: returned to town for validated chores';
 }
 if(readyCraft&&target?.ready&&i.livePos?.room==='town'&&!require('./craft-scope').blocking(i,target?.id)&&require('./wing-inventory').space(i)?.free===0&&i.canDo('developmentCraftSpace',60000)){
  const result=await require('./wing-inventory').prepare(i);
  i.equipmentMaintenanceStatus={at:Date.now(),kind:'inventory',id:target.id,name:target.name,status:result.ok?'space_observed':'blocked',reason:result.reason||'เปิดพื้นที่สำหรับสูตร Legendary ที่พร้อมแล้ว',result};
  if(!result.ok)return 'ready equipment craft: '+result.reason;
  // Keep the freshly opened slot in this owned town cycle. Recompute the bill.
  const freshTarget=require('../planning/development-progress').view(i).target;
  if(!require('../equipment-goal').policy(i.catalog()).dynamicProgression||parallel||!freshTarget?.ready||freshTarget.id!==target.id)return 'ready equipment craft: inventory space observed';
 }
 const dynamicChoice=require('../equipment-goal').policy(i.catalog()).dynamicProgression?require('../planning/combat-roi').townChoice(i):null;
 if(require('../equipment-goal').policy(i.catalog()).dynamicProgression&&dynamicChoice==='craft'&&readyCraft&&target?.ready&&!parallel&&i.livePos?.room==='town'&&require('./wing-inventory').space(i)?.free>=1&&i.canDo('dynamicReadyCraft',30000)){
  const current=require('../planning/development-progress').view(i).target;
  if(!current?.ready||current.id!==target.id||require('./craft-scope').blocking(i,current.id)||!require('./paid-actions').preflight(i,'craftAtExchange',[current.name,current.type||'gear']).allowed)return null;
  await i.expeditionAuto(false);const result=await i.craftAtExchange(current.name,current.type||'gear');
  await i.closeGamePanel();const owned=require('../economy').ownedNames(i.lastSave).includes(current.id);
  i.equipmentMaintenanceStatus={at:Date.now(),kind:'craft',id:current.id,name:current.name,status:owned?'change_observed':result?.ok?'awaiting_outcome':'not_sent',reason:result?.reason||'native ready craft after bounded headroom; receipt required'};
  if(owned){const bag=await i.planBag(i.roster);if(bag.equip?.length)await i.equipItems(bag.equip);}return 'native ready equipment: '+i.equipmentMaintenanceStatus.status;
 }
 if(parallel&&target?.ready&&i.livePos?.room==='town'&&!require('./craft-scope').blocking(i,target?.id)){
  // Avoid the broad town-chores queue: one verified Legendary recipe only,
  // with the wing bill, supply budget and uncertain claims still protected.
  const pick=require('../planning/campaign-equipment').profile(i)?.craft;
  if(pick?.ready&&pick.id===target.id&&i.catalog().items[pick.id]?.rarity==='legendary'&&pick.recipeVerified&&pick.verifiedBuild===i.catalog().build&&require('./wing-inventory').space(i)?.free>=1&&require('./paid-actions').preflight(i,'craftAtExchange',[pick.name,pick.type]).allowed&&i.canDo('campaignEquipmentCraft',120000)){
   await i.expeditionAuto(false);
   try{
    const current=require('../planning/campaign-equipment').profile(i)?.craft;
    if(!require('../planning/campaign-equipment').window(i)||!current?.ready||current.id!==pick.id)return 'equipment side-work: deadline or bill changed';
    const result=await i.craftAtExchange(pick.name,pick.type);
    const observed=require('../economy').ownedNames(i.lastSave).includes(pick.id);
    i.equipmentMaintenanceStatus={at:Date.now(),kind:'craft',id:pick.id,name:pick.name,status:observed?'change_observed':result?.ok?'awaiting_outcome':'not_sent',reason:result?.reason||'คราฟ Legendary หนึ่งชิ้นระหว่างรอบอส โดยกันของและเงินปีก',evidence:observed?'outgoing_client_save':'no_confirmed_item'};
    if(observed){await i.closeGamePanel();const bag=await i.planBag(i.roster);if(bag.equip?.length)await i.equipItems(bag.equip);}
    return 'equipment side-work: '+pick.name+' '+i.equipmentMaintenanceStatus.status;
   }finally{await i.closeGamePanel();}
  }
  return null; // A ready replacement owns this budget before another refine roll.
 }
 // Executable craft keeps priority. A fenced historical craft cannot own all
 // other work forever; refinement still preserves its bill and native holds.
 if((!require('../equipment-goal').policy(i.catalog()).dynamicProgression||dynamicChoice==='craft')&&readyCraft&&target?.ready&&!require('./craft-scope').blocking(i,target?.id)&&require('./paid-actions').preflight(i,'craftAtExchange',[target.name,target.type||'gear']).allowed)return null;
 if(require('../equipment-goal').policy(i.catalog()).dynamicProgression&&i.livePos?.room==='town'&&!refineOpportunity(i)&&!['craft','astral'].includes(require('../planning/combat-roi').townChoice(i))){const supplied=await require('./refine-supplies').tick(i);if(supplied)return supplied;}
 const next=refineOpportunity(i);
 // Early training must not spend repeated travel/NPC waits on a small +1.
 // Take this opportunity during an existing supply/quest/town visit instead.
 if(next?.early&&i.livePos?.room!=='town')return null;
 if(['boss','miniboss'].includes(i.goal?.monsterKind)&&i.goal.mapId===i.livePos?.room&&!next?.prepareBoss)return null;
 if(!next||!i.canDo('developmentFoundationRefine',i.livePos?.room==='town'?30000:120000))return null;
 i.equipmentMaintenanceStatus={at:Date.now(),status:'preparing',kind:'refine',id:next.id,name:next.name,from:next.from,to:next.to,reserve:next.reserve,reason:next.foundation?'เพิ่ม Epic ที่สวมอยู่ +0 → +1 เฉพาะขั้นรับประกันระหว่างเข้าเมือง; เป้า Legendary +10 ยังไม่สำเร็จ':next.strictGoal?'เป้า native max: ทดลองหนึ่งขั้นตามผลตอบแทนและความเสี่ยงจริง กันงบยาและไม่ส่งรายการผลไม่ชัดซ้ำ':next.prepareBoss?'เตรียมอาวุธ/ชุดขั้นรับประกันก่อนล่าบอสเดี่ยว กันเงินและวัสดุปีกไว้':'ตีบวกขั้นรับประกันของ Epic/Legendary ที่สวมอยู่ โดยกันเงินและวัสดุปีก ไม่รอจนปีกเสร็จ'};
 await i.expeditionAuto(false);
 const home=i.livePos?.room==='town'?{ok:true}:await i.returnToTown();
 if(!home.ok){i.equipmentMaintenanceStatus.status='route_wait';return 'equipment readiness: town route not confirmed';}
 // Travel can outlast the HP freshness window. Read current native evidence;
 // extending the old timestamp would falsely authorize a paid upgrade.
 const arrived=typeof i.screen==='function'?await i.screen():null;
 if(arrived)i.vitals=require('../team-readiness').vitals(arrived);
 const current=refineOpportunity(i);
 if(!current||current.id!==next.id||current.from!==next.from||i.livePos?.room!=='town'||arrived?.death||arrived?.panelOpen||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.v2?.trial?.active()||i.v2?.sourceCoherence?.matches===false||require('./team-trade').blocksNavigation(i)||!require('./freshness').fresh(i.vitals?.at,15000)||!Number.isFinite(i.vitals?.hp)||i.vitals.hp<.95||!require('./freshness').decisionGate(i).allowed){i.equipmentMaintenanceStatus.status='replanned';return 'equipment readiness: resources or boss deadline changed';}
 const at=Date.now();
 try{
  const result=await i.refineEquipped({targetId:current.id,maxAttempts:1,guaranteedOnly:current.guaranteed,extraReserveCoins:current.extraReserveCoins,reservedMaterials:current.reservedMaterials,...(current.foundation?{foundation:true}:{})});
  const observed=i.lastSaveAt>at&&(i.lastSave.refine?.[current.id]||0)>current.from;
  i.equipmentMaintenanceStatus=require('./equipment-outcome').bind(i,{...i.equipmentMaintenanceStatus,at:Date.now(),status:observed?'change_observed':result?.refined?'awaiting_outcome':'not_sent',evidence:observed?'outgoing_client_save':'no_confirmed_increase',result:{attempted:result?.refined||0,reason:result?.reason||result?.open?.reason||null}},at);
  return 'equipment readiness: '+current.name+' '+i.equipmentMaintenanceStatus.status;
 }finally{await i.closeGamePanel();}
}
module.exports={tick,refineOpportunity};
