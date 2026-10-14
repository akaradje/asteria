'use strict';
function hpPots(s){return (s.potions||0)+['Orange Potion','Yellow Potion','White Potion'].reduce((n,k)=>n+(s.consumables?.[k]||0),0);}
function criticalHpRatio(i,now=Date.now()){
 const m=i.catalog().world.MONSTERS?.find(m=>m.id===i.goal?.monsterId),v=i.vitals;
 if(m?.kind!=='normal'||i.v2?.sourceCoherence?.matches!==true||!require('./freshness').fresh(v?.at,15000,now)||!Number.isFinite(v.maxHp)||v.maxHp<=0||!Number.isFinite(m.atk)||m.atk<=0)return .35;
 return Math.max(.35,Math.min(.85,m.atk*2/v.maxHp));
}
function recentDeaths(i,now=Date.now()){
 const policy=require('./room-policy');
 return Object.entries(i.brain?.data?.deaths||{}).filter(([map])=>map!=='town'&&!policy.isGuildHall(map)&&!policy.roomPolicy(map).dungeon).flatMap(([map,rows])=>rows.filter(at=>Number.isFinite(at)&&at<=now&&now-at<1800000).map(at=>({map,at}))).sort((a,b)=>a.at-b.at);
}
function selectRecoveryTraining(i,candidates,now=Date.now()){
 const build=i.v2?.learningRevision||i.catalog().build,e=i.v2?.sourceCoherence?.matches===true?i.v2?.expRouteEvidence:null;
 const rows=e?e.decorate(candidates,i.lastSave,build):candidates;
 const trial=i.v2?.trial?.active?.();
 if(trial){
  const key=require('../learning/exp-route-evidence').key,target=trial.phase==='confirmation'?trial.baselineGoal:trial.candidateGoal;
  if(!rows.some(g=>key(g)===key(target)))i.v2.trial.finish('safety_abort','route removed by recovery safety gates');
 }
 // Recovery candidates already exclude death maps and require native HP and
 // personal kills. Use the same bounded zero-spend learner rather than pinning
 // the only measured (possibly very slow) route forever.
 const choice=require('../planning/training-route').choose(i,rows,now),pick=choice.goal;
 i.survivalTrainingRoute={...choice.status,selected:pick?pick.mapId+':'+pick.monsterId:null,reason:choice.status.reason,selectedFieldExpPerHour:choice.status.selectedFieldExpPerHour};
 return pick;
}

function goal(i,wiki,now=Date.now()){
 const s=i.lastSave||{},maps=wiki?.maps?.maps||[];if(!s.lv||!i.catalog().world?.MAX_LV)return null;
 const recent=recentDeaths(i,now);
 if(!recent.length)return null;
 const nativeMaps=i.catalog().world.MAPS||[];
 if(recent.some(r=>{const m=maps.find(m=>m.id===r.map),native=nativeMaps.find(m=>m.id===r.map);return !Number.isFinite(m?.levelMin)||!(m.kind==='field'||m.kind==='dungeon'&&native?.kind==='dungeon');}))return {at:now,until:recent.at(-1).at+1800000,deaths:recent,goal:{kind:'survival',mapId:'town',label:'พักฟื้นและตรวจพื้นที่เสี่ยง',reason:'มีประวัติตายในพื้นที่ที่ข้อมูลปัจจุบันยังไม่ยืนยัน ไม่ส่งกลับไปล่า'}};
 const until=Math.max(...recent.map(r=>r.at))+1800000,blocked={...(i.brain.blocked(now)||{})};for(const r of recent)blocked[r.map]={until};
 const ceiling=Math.max(1,Math.min(s.lv-20,...recent.map(r=>maps.find(m=>m.id===r.map).levelMin-20)));
 const work=require('../planning/progression-work'),earlyCeiling=Math.min(s.lv-5,...recent.map(r=>maps.find(m=>m.id===r.map).levelMin-3));
 const candidates=require('../planning/level-training').candidates(s,wiki,i.catalog(),{blocked,room:i.livePos?.room,recovery:true,ceiling:earlyCeiling,provenOnly:true,maxHp:require('./freshness').fresh(i.vitals?.at,15000,now)?i.vitals.maxHp:null});
 const training=selectRecoveryTraining(i,i.v2?.farmEvidence?i.v2.farmEvidence.rank(candidates,s,i.v2.learningRevision||i.catalog().build):candidates,now);
 const alternatives=[work.fallback(s,wiki,i.livePos?.room,blocked,ceiling),work.recoveryFallback(s,wiki,i.livePos?.room,blocked,earlyCeiling)].filter(Boolean);
 const fallback=(i.v2?.farmEvidence?alternatives.filter(g=>i.v2.farmEvidence.rank([g],s,i.v2.learningRevision||i.catalog().build).length):alternatives)[0];
 const pick=training||fallback;
 if(!pick)return {at:now,until,deaths:recent,goal:{kind:'survival',mapId:'town',label:'พักฟื้นและเตรียมอุปกรณ์ในเมือง',reason:'ไม่มีมอนปกติ/เส้นทางที่ผ่านหลักฐานความปลอดภัย ไม่ส่งกลับพื้นที่ที่ตาย'}};
 return {at:now,until,deaths:recent,potions:hpPots(s),goal:{...pick,kind:'survival',label:pick.label+' · ฟื้นตัว',reason:'พักพื้นที่เสี่ยงหลังตายที่ '+recent.at(-1).map+' 30 นาที · พัฒนาในเมืองหรือเก็บโบนัส/เงินจากมอนปกติที่เคยฆ่าได้'}};
}
async function improveInTown(i){
 if(i.livePos?.room!=='town'||!require('./freshness').fresh(i.vitals?.at,15000)||!Number.isFinite(i.vitals?.hp)||i.vitals.hp<.95)return null;
 if(!i.autoChores||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||require('./team-trade').blocksNavigation(i)||i.v2?.trial?.active()||i.v2?.sourceCoherence?.matches===false||!require('./freshness').decisionGate(i).allowed||require('./equipment-headroom').journalBlocks(i)||i.developmentLedger?.blocking('equip')||typeof i.planBag!=='function'||!i.canDo('survivalOwnedGear',120000))return null;
 const plan=await i.planBag(i.roster),rows=(plan.equip||[]).filter(r=>r.slot!=='wing').slice(0,2);if(!rows.length)return null;
 if(i.livePos?.room!=='town'||!require('./freshness').decisionGate(i).allowed||!require('./freshness').fresh(i.vitals?.at,15000)||i.vitals.hp<.95||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||require('./team-trade').blocksNavigation(i)||i.v2?.trial?.active()||i.v2?.sourceCoherence?.matches===false||require('./equipment-headroom').journalBlocks(i)||i.developmentLedger?.blocking('equip'))return null;
 await i.expeditionAuto(false);const at=Date.now();try{const result=await i.equipItems(rows);const observed=i.lastSaveAt>at&&rows.some(r=>i.lastSave.equip?.[r.slot]===r.id);i.equipmentMaintenanceStatus={at:Date.now(),kind:'equip',name:rows.map(r=>r.name||r.id).join(', '),status:observed?'change_observed':result?.equipped?'awaiting_outcome':'not_sent',reason:'สวมของพร้อมใช้ระหว่างพักพื้นที่เสี่ยง ไม่จ่ายเงิน',evidence:observed?'outgoing_client_save':'no_confirmed_equipment_change'};return 'survival gear: '+i.equipmentMaintenanceStatus.status;}finally{await i.closeGamePanel();}
}
async function prepareField(i,state,screen){
 const fresh=require('./freshness'),now=Date.now(),room=i.livePos?.room,goal=state?.goal;
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.recycling||i.choresBusy||i.pendingTravel||require('./team-trade').blocksNavigation(i)||room==='town'||room!==goal?.mapId||goal?.monsterKind!=='normal'||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed||!fresh.fresh(i.vitals?.at,15000,now)||!Number.isFinite(i.vitals.hp)||i.vitals.hp<.35||i.vitals.hp>=.85||hpPots(i.lastSave)<13||screen.panelOpen||screen.death||typeof i.screen!=='function'||typeof i.eval!=='function')return null;
 const key=[i.catalog().build,room,goal.monsterId].join(':');
 let p=i.survivalFieldPreparation;if(!p||p.key!==key)p=i.survivalFieldPreparation={key,attempts:0};
 if(p.uncertain||p.attempts>=3)return null;
 if(!i.canDo('survivalFieldPotion',5000))return 'survival: waiting for native potion cooldown before normal target';
 const before=i.vitals.currentHp,beforeCount=hpPots(i.lastSave),sentAt=Date.now();
 const clicked=await i.eval(`(() => {const b=Array.from(document.querySelectorAll('#hotbar .slot')).find(b=>b.querySelector('.k')?.textContent==='R');if(!b||b.hidden||b.disabled||b.querySelector('.cdn')?.textContent.trim()||Number(b.style.opacity||1)<1)return false;b.click();return true;})()`);
 if(!clicked)return null;
 p.attempts++;p.at=sentAt;
 const end=Date.now()+3500;
 while(Date.now()<end){
  await new Promise(r=>setTimeout(r,350));const live=await i.screen();i.vitals=require('../team-readiness').vitals(live);
  if(live.death||i.livePos?.room!==room)break;
  if(i.vitals.currentHp>before||i.lastSaveAt>sentAt&&hpPots(i.lastSave)<beforeCount){p.observed=true;return 'survival: field potion observed; recheck HP before normal target';}
 }
 p.uncertain=true;return 'survival: field potion outcome unconfirmed; no replay';
}
async function tick(i,screen,{supply}={}){
 const s=i.lastSave||{};if(!i.lastSaveAt||Date.now()-i.lastSaveAt>30000||!i.catalog().world?.MAX_LV||Date.now()-i.lastSaveAt< -5000||i.recycling||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||require('./team-trade').blocksNavigation(i)||i.pendingTravel||i.choresBusy||screen.death||require('./room-policy').roomPolicy(i.livePos?.room).dungeon)return null;
 // Retire the old assistance cancellation before this fresh, unowned
 // recovery/refill starts walking. Otherwise routeExpired cancels the shop
 // walk, and refill ownership prevents the later assistance tick clearing it.
 if(i.assistanceReleasePending){await i.expeditionAuto(false);i.assistanceReleasePending=false;}
 const capped=s.lv>=i.catalog().world.MAX_LV,wiki=require('../economy').loadWiki(i.root);let state=goal(i,wiki);i.survivalStatus=state;
 const supplyBatch=require('./supply-recovery').hpBatch(i);
 const hp=require('../team-readiness').ratio(screen.hp);
 if(i.livePos?.room==='town'&&hp!==null&&hp>=.95)i.survivalFieldPreparation=null;
 const critical=criticalHpRatio(i);
 if(hp!==null&&!screen.panelOpen&&(hp<critical||i.livePos?.room==='town'&&hp<.85))i.survivalRecovery=true;
 if(i.survivalRecovery){
  if(hp===null)return 'survival: waiting for current HP before leaving recovery';
  if(hp>=.85){
   // A town-only native potion threshold must be restored before hunting.
   // Also restore a persisted recovery setting after a farm-process restart.
   if(i.recoveryPotionSettings||s.autoOpt?.potPct===90){
    if(s.autoOpt?.potPct===i.potPct&&s.autoOpt?.ph===true)i.recoveryPotionSettings=false;
    else{
     await i.expeditionAuto(false);
     if(!screen.panelOpen&&typeof i.configureAutomation==='function'&&i.v2?.sourceCoherence?.matches!==false&&require('./freshness').decisionGate(i).allowed&&i.canDo('restoreRecoverySettings',60000))await i.configureAutomation();
     return 'survival: waiting for native field potion settings before leaving recovery';
    }
   }
   i.survivalRecovery=false;
  }
  else{
   const recovery={kind:'survival',mapId:'town',label:'พักฟื้น HP ก่อนออกล่า',reason:'HP ต่ำกว่าเกณฑ์ถอนตัว '+Math.round(critical*100)+'% จากพลังโจมตีมอนจริง · รอฟื้นถึง85%ก่อนกลับไปฟาร์ม'};i.campaignGoal=null;i.goal=recovery;i.huntMap='town';i.teamGoal=null;i.survivalStatus={at:Date.now(),goal:recovery,hp,criticalHpRatio:critical,recovering:true};await i.expeditionAuto(false);
   if(i.livePos?.room!=='town'&&i.canDo('survivalRetreat',45000)){const result=await i.returnToTown();return 'survival: low HP retreat '+(result.ok?'town confirmed':'awaiting verified escape');}
   // Native town recovery consumes potions; it cannot recover an empty bag.
   // Refill while withdrawn instead of returning forever before the normal
   // supply branch. Keep native purchase/no-replay and protected cash guards.
   if(i.livePos?.room==='town'&&!screen.panelOpen&&hpPots(s)<10&&i.v2?.sourceCoherence?.matches===true&&require('./freshness').decisionGate(i).allowed&&i.canDo('survivalSupply',120000)){
    const supply=require('./supply-recovery'),reserve=supply.essentialReserve(i),item=supply.choice(i,10,{reserveCoins:reserve});
    if(item){
     const held=Number(require('./paid-actions').heldResources(i).Copper)||0;
     const result=await i.restockPotions(item.name,Math.max(0,10-hpPots(i.lastSave)),{essential:true,minimum:10,reserveCoins:reserve+held});
     await i.closeGamePanel();i.survivalSupply={at:Date.now(),item:item.name,budget:supplyBatch,milestone:null,result};
     return 'survival: withdrawn town refill '+(result.ok?'confirmed '+item.name:result.reason||result.skip||'awaiting save');
    }
    i.survivalSupply={at:Date.now(),budget:supplyBatch,milestone:null,result:{ok:false,sent:false,status:'CANCELLED',reason:'no affordable unreserved native recovery potion'}};
   }
   if(i.livePos?.room==='town'&&!screen.panelOpen&&hpPots(s)>=10&&typeof i.configureAutomation==='function'&&i.v2?.sourceCoherence?.matches!==false&&require('./freshness').decisionGate(i).allowed&&(s.autoOpt?.ph!==true||s.autoOpt?.potPct!==90)&&i.canDo('recoveryPotionSettings',60000)){
    await i.configureAutomation({recovery:true});i.recoveryPotionSettings=true;return 'survival: native town potion recovery enabled; awaiting HP/save';
   }
   return 'survival: recovering HP '+Math.round(hp*100)+'%';
  }
 }
 if(state){i.campaignGoal=null;i.goal=state.goal;i.huntMap=state.goal.mapId;i.teamGoal=null;}
 // Endgame source/helper readiness requires twenty HP potions. Refill below
 // that threshold so actors with 10–19 cannot farm cash forever while every
 // equipment/boss candidate remains blocked by readiness.
 const rawBossSupply=supply===undefined?require('./class-boss-probe').supplyRequirement(i):supply,refill=require('./supply-recovery').hpRefill(i,rawBossSupply);
 const bossSupply=rawBossSupply?{...rawBossSupply,...refill}:null;
 if(bossSupply)i.hpOrdinaryRefill=null;
 const ordinary=bossSupply?null:require('./supply-recovery').ordinaryRefill(i,supplyBatch);
 const supplyMinimum=bossSupply?.minimum||ordinary?.minimum||(capped?20:10);
 const confirmedSupply=i.survivalSupply?.result?.status==='CONFIRMED'&&i.lastSaveAt>=i.survivalSupply.at;
 if(hpPots(s)<supplyMinimum&&i.canDo('survivalSupply',(bossSupply||ordinary)&&confirmedSupply?15000:120000)){
  // Buy the first ten necessary HP potions before optional group stock.
  // The upkeep envelope is for these supplies, not a reason to strand an
  // actor with zero potions. Actual promotion/ready-craft and paid holds stay.
  const essential=hpPots(s)<10,purchaseMinimum=essential?10:supplyMinimum;
  const heldCopper=Number(require('./paid-actions').heldResources(i).Copper)||0;
  const supplyReserve=essential?require('./supply-recovery').essentialReserve(i):bossSupply?.reserve??ordinary?.reserve??(supplyBatch.potsPerMinute!==null&&Number.isFinite(supplyBatch.potsPerMinute)?require('../upgrade-reserve').reserve(s,i.catalog().world):1000);
  const item=require('./supply-recovery').choice(i,purchaseMinimum,{reserveCoins:supplyReserve})?.name||(bossSupply?null:s.lv>=60?'White Potion':s.lv>=40?'Yellow Potion':s.lv>=20?'Orange Potion':'Red Potion');
  if(!item){i.survivalSupply={at:Date.now(),budget:supplyBatch,milestone:bossSupply,result:{ok:false,sent:false,status:'CANCELLED',reason:'no affordable unreserved native potion'}};}
  else{
  await i.expeditionAuto(false);const home=i.livePos?.room==='town'?{ok:true}:await i.returnToTown();if(!home.ok)return 'survival: awaiting safe town route for HP supplies';
  const limit=essential?Math.max(0,10-hpPots(i.lastSave)):bossSupply||ordinary?Math.min(20,Math.max(0,supplyMinimum-hpPots(i.lastSave))):supplyBatch.limit;
  const result=await i.restockPotions(item,limit,{essential:essential||!bossSupply,minimum:purchaseMinimum,reserveCoins:supplyReserve+heldCopper,observedStock:!essential&&!bossSupply&&supplyBatch.potsPerMinute!==null&&Number.isFinite(supplyBatch.potsPerMinute)});await i.closeGamePanel();i.survivalSupply={at:Date.now(),item,budget:supplyBatch,milestone:bossSupply,result};
  if(hpPots(i.lastSave)<10){i.goal={kind:'survival',mapId:'town',label:'เติมยา HP ก่อนฟาร์ม',reason:result.reason||result.skip||'รอจำนวนยาในเซฟจริง'};i.huntMap='town';i.teamGoal=null;}
  else if(!state&&i.goal?.kind==='survival'){i.goal=null;i.huntMap=null;i.refreshGoal?.();}
  return 'survival supplies: '+(result.ok?'confirmed '+item:result.reason||result.skip||'awaiting save');
  }
 }
 // Keep a mandatory multi-batch refill out of the field until its real
 // stock is ready. An existing uncertain payment is never replayed.
 const teamCashMissing=Number.isFinite(bossSupply?.requiredCopper)&&i.lastSave.coins<bossSupply.requiredCopper;
 if(bossSupply&&(hpPots(i.lastSave)<supplyMinimum||teamCashMissing)){
  const income=require('./supply-recovery').milestoneIncome(i,wiki,bossSupply);
  if(income){state=income;i.survivalStatus=state;i.campaignGoal=null;i.goal=state.goal;i.huntMap=state.goal.mapId;i.teamGoal=null;}
  else{
  await i.expeditionAuto(false);i.goal={kind:'milestone-supply',mapId:'town',label:'เตรียมเสบียงและเงินก่อนรวมพล',reason:'ยา '+hpPots(i.lastSave)+'/'+supplyMinimum+(teamCashMissing?' · Copper '+i.lastSave.coins+'/'+bossSupply.requiredCopper:'')+' · รอข้อมูลหรือการเตรียมที่ยืนยันแล้ว'};i.huntMap='town';i.teamGoal=null;
  if(i.livePos?.room!=='town'&&i.canDo('survivalRetreat',45000))await i.returnToTown();
  return 'survival: mandatory supplies preparation owns navigation';
  }
 }
 else i.milestoneIncomeState=null;
 if(ordinary?.refilling&&hpPots(i.lastSave)>=10&&hpPots(i.lastSave)<ordinary.minimum){
  await i.expeditionAuto(false);i.teamGoal=null;i.goal={kind:'survival',mapId:'town',label:'เติมยาเป็นชุดก่อนฟาร์ม',reason:'ยา '+hpPots(i.lastSave)+'/'+ordinary.minimum+' · ตามการใช้จริงและงบที่กันไว้'};i.huntMap='town';
  if(i.livePos?.room!=='town'&&i.canDo('survivalRetreat',45000))await i.returnToTown();
  return 'survival: bounded ordinary supply refill; waiting for confirmed stock';
 }
 if(i.goal?.kind==='milestone-supply'){i.goal=null;i.huntMap=null;i.refreshGoal?.();}
 if(hpPots(i.lastSave)<10){
  let cash;try{cash=require('./supply-recovery').bootstrap(i,wiki);}catch{}
  if(!cash){await i.expeditionAuto(false);i.teamGoal=null;i.goal={kind:'survival',mapId:'town',label:'เติมยา HP ก่อนฟาร์ม',reason:'รอเสบียงที่ยืนยันแล้ว ไม่ออกล่าโดยไม่มียา'};i.huntMap='town';return 'survival: waiting for confirmed HP supplies';}
  state=cash;i.survivalStatus=state;i.campaignGoal=null;i.teamGoal=null;i.goal=cash.goal;i.huntMap=cash.goal.mapId;
 }
 if(capped&&!state){if(i.goal?.kind==='survival'){i.goal=null;i.huntMap=null;i.refreshGoal?.();}return null;}
 if(!state&&!i.survivalRecovery&&i.goal?.kind==='survival'){i.goal=null;i.huntMap=null;i.refreshGoal?.();}
 // Ten confirmed HP potions already satisfy the supply policy above. Requiring
 // twenty here stranded actors with 10–19 in a town/field loop even though
 // preparation is safe town work, not permission to enter a boss fight.
 if(state&&!screen.panelOpen&&i.livePos?.room==='town'&&hp!==null&&hpPots(i.lastSave)>=10){
  const development=require('./development-progress');
  if(hp>=.95){const upgrade=await improveInTown(i);if(upgrade)return upgrade;if(!state.milestoneIncome){const refine=await development.tick(i,screen);if(refine)return refine;}}
  // Recovery must not send the character back to a field between foundation
  // steps (or at 85% HP before the 95% payment guard is satisfied).
  if(!state.milestoneIncome&&i.autoChores&&!i.v2?.trial?.active()&&development.refineOpportunity(i)?.prepareBoss){
   // A possible upgrade is not an active action. During its cooldown a
   // reviewed safe normal recovery route can earn EXP instead of owning town
   // indefinitely. Actual payment uncertainty and low/stale HP still hold.
   const now=Date.now(),safe=hp>=.95&&state.goal.mapId!=='town'&&state.goal.monsterKind==='normal'
    &&i.v2?.sourceCoherence?.matches===true&&require('./freshness').decisionGate(i,now).allowed
    &&require('./freshness').fresh(i.vitals?.at,15000,now)
    &&!require('../learning/experiment-governor').routePaymentBlocks(i,now)
    &&!require('./equipment-headroom').developmentBlocks(i,now);
   if(!safe){await i.expeditionAuto(false);return 'survival: guarded equipment preparation in town; waiting for fresh HP or payment outcome';}
   i.survivalStatus.equipmentPreparationDeferred={at:now,reason:'upgrade did not dispatch; safe normal recovery until next town visit'};
  }
 }
 if(state?.goal.mapId==='town'){await i.expeditionAuto(false);if(i.livePos?.room!=='town'&&i.canDo('survivalRetreat',45000))await i.returnToTown();return 'survival: safe field unavailable; preparing equipment in town';}
 if(state&&i.canDo('survivalSettings',60000)&&!screen.panelOpen){
  if(s.autoOpt?.potPct!==70||s.autoOpt?.heal===false||s.autoOpt?.basic===false){i.potPct=70;await i.configureAutomation();return 'survival: heal and potions at 70% HP';}
 }
 if(state&&!screen.panelOpen){
  if(i.livePos?.room!==state.goal.mapId){
   i.survivalHuntReady=null;await i.expeditionAuto(false);
   if(i.livePos?.room!=='town'&&i.canDo('survivalRetreat',45000)){
    const home=await i.returnToTown();return home.ok?'survival: town confirmed before safe field route':'survival: waiting for verified home route before safe field';
   }
  }
  // The 85% entry gate must not cancel an already verified hunt after normal
  // damage. Critical HP is handled above with 35% -> 85% recovery hysteresis.
  else if(hp===null||hp<.85&&!(screen.autoOn==='true'&&i.survivalHuntReady===[i.catalog().build,state.goal.mapId,state.goal.monsterId].join(':'))){
   await i.expeditionAuto(false);
   const prepared=await prepareField(i,state,screen);if(prepared)return prepared;
   if(hp!==null&&i.livePos?.room!=='town'&&i.canDo('survivalRetreat',45000)){const home=await i.returnToTown();return home.ok?'survival: town recovery before normal target':'survival: awaiting verified HP recovery route';}
   return 'survival: waiting for HP before normal target';
  }
  else{
   i.survivalFieldPreparation=null;
   const key=[i.catalog().build,state.goal.mapId,state.goal.monsterId].join(':');
   if(i.survivalHuntReady!==key||screen.autoOn!=='true'){
    const selected=await require('./main-quest').selectTarget(i,state.goal);
    if(!selected){i.survivalHuntReady=null;await i.expeditionAuto(false);return 'survival: normal target unavailable; AUTO remains off';}
    i.survivalHuntReady=key;await i.expeditionAuto(true);return 'survival: confirmed normal target '+state.goal.monsterId;
   }
  }
 }
 if(state&&state.goal.mapId!=='town'&&i.livePos?.room==='town'&&!screen.panelOpen&&i.canDo('survivalRoute',45000)){
  await i.expeditionAuto(false);i.pendingTravel={mapId:state.goal.mapId,until:Date.now()+180000};const arrived=await i.chainWalkTo(state.goal.mapId);
  if(!arrived){i.pendingTravel=null;return 'survival: safe route not confirmed';}
  i.pendingTravel.until=Date.now()+180000;return 'survival: safe farming route '+state.goal.mapId;
 }
 return null;
}
module.exports={goal,tick,hpPots,improveInTown,recentDeaths,selectRecoveryTraining,prepareField,criticalHpRatio};
