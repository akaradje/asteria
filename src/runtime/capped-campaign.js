'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),planner=require('../planning/capped-campaign');
function observe(instance,plan){const name=instance.character?.name;if(!name)return;const now=Date.now(),key=JSON.stringify([instance.lastSave.job,instance.lastSave.equip?.wing,plan.target,...(plan.requirements||[]).map(r=>[r.name,r.have])]);
 if(!instance.campaignHistory){instance.campaignFile=path.join(instance.root,'logs/campaign',crypto.createHash('sha256').update(name).digest('hex').slice(0,24)+'.json');try{const saved=JSON.parse(fs.readFileSync(instance.campaignFile));instance.campaignHistory=saved.history||[];instance.campaignRoutes=saved.routes||{};}catch{instance.campaignHistory=[];}}
 if(key!==instance.campaignEvidenceKey){const previous=instance.campaignHistory.at(-1);const record={at:instance.lastSaveAt,phase:plan.phase,job:instance.lastSave.job,wing:instance.lastSave.equip?.wing||null,target:plan.target,requirements:(plan.requirements||[]).map(r=>({name:r.name,have:r.have,want:r.want})),evidence:'outgoing_client_save'};
  const changed=!previous||previous.job!==record.job||previous.wing!==record.wing||JSON.stringify(previous.requirements)!==JSON.stringify(record.requirements);if(changed){instance.campaignHistory.push(record);instance.campaignHistory=instance.campaignHistory.slice(-120);fs.mkdirSync(path.dirname(instance.campaignFile),{recursive:true});fs.writeFileSync(instance.campaignFile,JSON.stringify({character:name,history:instance.campaignHistory,routes:instance.campaignRoutes||{}}));instance.campaignProgressAt=now;}instance.campaignEvidenceKey=key;}
 instance.endgameCampaign={...plan,retry:instance.campaignRetry||null,action:instance.endgameCampaign?.action,at:now,saveAt:instance.lastSaveAt,history:instance.campaignHistory.slice(-8),lastProgressAt:instance.campaignProgressAt||instance.campaignHistory.at(-1)?.at||now};
}
async function tick(instance,screen){
 if(!instance.lastSaveAt||Date.now()-instance.lastSaveAt>30000||Date.now()-instance.lastSaveAt < -5000)return null;
 const plan=planner.plan(instance);observe(instance,plan);
 const assistance=await require('./milestone-assistance').tick(instance,screen);if(assistance)return assistance;
 if(!plan.active||plan.phase==='complete'){instance.campaignGoal=null;return require('./night-training').tick(instance,screen);}
 if(instance.survivalRecovery||instance.goal?.kind==='survival'||instance.survivalStatus?.deaths?.length&&instance.survivalStatus.until>Date.now()){
  instance.campaignGoal=null;if(instance.endgameCampaign)instance.endgameCampaign.pausedFor='survival';return null;
 }
 const quest=require('../planning/main-quest').assess(instance,require('../economy').loadWiki(instance.root),{requirements:plan.requirements||[]});instance.mainQuest=quest;
 if(instance.teamControl||instance.recycling||screen.death||instance.choresBusy||require('./room-policy').roomPolicy(instance.livePos?.room).dungeon)return null;
 if(['class','wing'].includes(plan.phase)&&!plan.ready&&!screen.panelOpen&&!instance.pendingTravel&&!instance.dailyTeamPending&&!instance.dailyWorkStatus?.ownsNavigation&&!instance.v2?.trial?.active()&&(!instance.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(instance.teamTradeStatus.phase))&&!require('./equipment-headroom').journalBlocks(instance)&&!['boss-live','return-to-boss','preposition'].includes(instance.bossWindow?.phase)&&(plan.missing||[]).some(r=>instance.lastSave.storage?.materials?.[r.name]>0)&&instance.canDo('campaignStoredMaterial',60000)){
  const home=instance.livePos?.room==='town'?{ok:true}:!instance.pendingTravel&&await instance.returnToTown();
  if(!home?.ok)return 'campaign storage: awaiting town route';
  const current=planner.plan(instance),result=await require('./personal-storage').restoreCampaignMaterial(instance,current);
  if(result){instance.endgameCampaign.action={at:Date.now(),kind:'personal-material-withdrawal',result};return 'campaign storage: '+(result.moved?'material delta observed':result.reason);}
 }
 // Preparation owns only an actionable step. A cooldown, source review or
 // unavailable payment must release navigation instead of holding town forever.
 if((plan.phase==='wing'||plan.phase==='class'&&instance.livePos?.room==='town')&&!plan.ready&&instance.autoChores&&!screen.panelOpen&&!instance.dailyTeamPending&&!instance.dailyWorkStatus?.ownsNavigation&&!instance.v2?.trial?.active()&&(!instance.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(instance.teamTradeStatus.phase))){
  const development=require('./development-progress'),next=development.refineOpportunity(instance);
  if(next?.prepareBoss){
   const action=await development.tick(instance,screen);if(action)return action;
  }
 }
 if(plan.phase==='wing'&&plan.ready){const retry=require('./campaign-retry'),blocked=retry.updateBlock(instance);
  if(blocked?.ok===false){if(instance.campaignRetry?.state!=='waiting-build'||instance.campaignRetry.target!==plan.target||Date.now()>=instance.campaignRetry.nextAt)instance.campaignRetry=retry.failed(instance.campaignRetry,plan.target,blocked);
   instance.endgameCampaign.retry=instance.campaignRetry;instance.endgameCampaign.action={at:Date.now(),kind:'wing-preflight',result:blocked};
  }else if(blocked?.ok===true&&instance.campaignRetry?.state==='waiting-build'){instance.campaignRetry=null;instance.endgameCampaign.retry=null;}
 }
 if(plan.phase==='wing'&&!screen.panelOpen&&instance.canDo('campaignOwnedWing',60000)){
  const bagPlan=await instance.planBag(instance.roster),wings=(bagPlan.equip||[]).filter(x=>x.slot==='wing');
  if(wings.length){const result=await instance.equipItems(wings);instance.endgameCampaign.equipment={at:Date.now(),result};if(result.equipped>0)return 'campaign: owned prerequisite wing equipped';}
 }
 await require('./boss-feed').poll(instance,{waitMs:1500});
 if(plan.phase==='class'&&plan.ready&&instance.canDo('campaignPromote',120000)){
  await instance.expeditionAuto(false);
  const result=await instance.advanceJob();instance.endgameCampaign.action={at:Date.now(),kind:'promotion',result};if(result.ok){instance.campaignGoal=null;instance.goal=null;instance.teamGoal=null;instance.refreshGoal();}return result.ok?'class confirmed '+result.to:'class waiting: '+(result.reason||result.skip||'save confirmation');
 }
 if(plan.phase==='class'&&plan.missing.some(r=>r.name==='bag_slots')&&!screen.panelOpen&&!instance.pendingTravel&&instance.canDo('campaignBag',120000)){
  await instance.expeditionAuto(false);
  const home=instance.livePos?.room==='town'?{ok:true}:await instance.returnToTown();
  if(!home.ok)return 'class inventory: awaiting confirmed town route';
  const result=await require('./wing-inventory').prepare(instance,{minimum:2});
  instance.endgameCampaign.action={at:Date.now(),kind:'promotion-inventory',result};
  return result.ok?'class inventory: two free slots confirmed':'class inventory: '+result.reason;
 }
 if(['wing','equip'].includes(plan.phase)&&plan.ready&&(!instance.campaignRetry||instance.campaignRetry.target!==plan.target||Date.now()>=instance.campaignRetry.nextAt)&&instance.canDo('campaignWing',120000)){
  const home=instance.livePos?.room==='town'?{ok:true}:await instance.returnToTown();if(!home.ok)return 'wing: waiting for verified town route';
  if(plan.phase==='wing'){
   const current=planner.plan(instance);if(current.phase!=='wing'||!current.ready)return 'wing requirements changed; replan';
   const inventory=await require('./wing-inventory').prepare(instance);instance.endgameCampaign.action={at:Date.now(),kind:'wing-inventory',result:inventory};
   if(!inventory.ok){const r=inventory.action?.result;
    instance.campaignRetry=require('./campaign-retry').failed(instance.campaignRetry,current.target,{ok:false,sent:!!(r?.sent||r?.sold||r?.stashed||r?.moved),transactionId:r?.transactionId,id:r?.id,reason:inventory.reason});instance.endgameCampaign.retry=instance.campaignRetry;
    return 'wing: '+inventory.reason;
   }
   const result=await instance.craftAtExchange(current.wing.name,'wing');instance.endgameCampaign.action={at:Date.now(),kind:'wing-craft',result};await instance.closeGamePanel();
   if(!result.ok){instance.campaignRetry=require('./campaign-retry').failed(instance.campaignRetry,current.target,result);instance.endgameCampaign.retry=instance.campaignRetry;return 'wing blocked: '+(result.reason||'craft not sent; waiting for reviewed source and resources');}
   if(!require('../economy').ownedNames(instance.lastSave).includes(current.target))return 'wing: craft sent; awaiting item in actual save';
  }
  const upgrades=await instance.planBag(instance.roster);if(upgrades.equip.length)await instance.equipItems(upgrades.equip);
  instance.campaignRetry=null;const after=planner.plan(instance);observe(instance,after);instance.campaignGoal=null;instance.goal=null;instance.teamGoal=null;instance.refreshGoal();return 'wing outcome: '+after.reason;
 }
 if(plan.phase==='wing'&&plan.ready){
  const room=instance.livePos?.room||'town',wiki=require('../economy').loadWiki(instance.root),side=require('./campaign-retry').sideGoal(instance.campaignRetry,plan.target,instance.lastSave,wiki,room,instance.brain.blocked(),Date.now(),quest.candidate);
  if(side){instance.campaignGoal=side;instance.goal=side;instance.huntMap=side.mapId;instance.teamGoal=null;instance.bossWindow={phase:'craft-retry-side-work',goal:side,departAt:side.retryAt};
   if(room===side.mapId&&!screen.panelOpen&&instance.canDo('campaignRetryAuto',30000)){
    const selected=await instance.eval(`(() => {const t=document.getElementById('huntTargetBtn');if(!t)return false;if(t.getAttribute('aria-expanded')!=='true')t.click();const b=Array.from(document.querySelectorAll('[data-hunt-target]')).find(x=>x.dataset.huntTarget===${JSON.stringify(side.monsterId)});if(!b){t.click();return false;}if(b.getAttribute('aria-pressed')!=='true')b.click();else t.click();return true;})()`);
    if(selected)await instance.expeditionAuto(true);
   }return null;}
  instance.campaignGoal={kind:'campaign-wait',mapId:'town',label:'เตรียมคราฟปีก',reason:instance.endgameCampaign.action?.result?.reason||'วัตถุดิบครบ รอรอบตรวจคราฟ ไม่ออกทำงานคั่น',campaign:true};instance.goal=instance.campaignGoal;instance.huntMap='town';instance.teamGoal=null;return 'wing: ready; retain town for craft verification';
 }
 const wiki=require('../economy').loadWiki(instance.root),night=require('../planning/night-training').select(instance,wiki);
 const board=await instance.socialLast('bossboard'),hunt=planner.chooseHunt(plan,instance.lastSave,wiki,board,Date.now(),instance.brain.blocked(),require('../planning/progression-work').context(instance));
 const classWindow=require('../planning/boss-window').schedule({hunt,save:instance.lastSave,wiki,now:Date.now(),room:instance.livePos?.room||'town',measurements:require('./route-travel').view(instance,instance.campaignRoutes),sideSourcesAllowed:false});
 const classDue=plan.phase==='class'&&['boss-live','return-to-boss','preposition'].includes(classWindow.phase);
 if(night&&!classDue){instance.endgameCampaign.pausedFor='night-training';instance.endgameCampaign.schedule=classWindow;instance.endgameCampaign.hunt=hunt;instance.endgameCampaign.waitReason=classWindow.bossObservation?.combatBlock||classWindow.reason;instance.campaignGoal={...night,campaign:true};instance.goal=instance.campaignGoal;instance.huntMap=night.mapId;instance.teamGoal=null;instance.bossWindow=null;
  if(instance.pendingTravel&&instance.pendingTravel.mapId!==night.mapId)instance.pendingTravel=null;
  if(instance.livePos?.room!==night.mapId&&instance.livePos?.room!=='town'&&!instance.pendingTravel&&!screen.panelOpen&&instance.canDo('nightTrainingRoute',45000)){return await require('./campaign-route').travel(instance,instance.campaignGoal);}
  return null;
 }
 delete instance.endgameCampaign.pausedFor;
 instance.rarePetPlan=require('../planning/rare-pet').assess(instance,wiki,board);
 const room=instance.livePos?.room||instance.lastSave.mapId||'town';
 // Legacy assignment-to-arrival timings remain historical. New measurements
 // start only inside an actual owned native navigation call.
 if(instance.campaignRoutes)for(const [key,r]of Object.entries(instance.campaignRoutes))if(r.build!==instance.catalog().build||Date.now()-r.at>7*86400000)delete instance.campaignRoutes[key];
 const now=Date.now(),blocked=instance.brain.blocked(),cat=instance.catalog(),side=require('../planning/campaign-side-work').cards(instance,wiki,now);
 instance.endgameCampaign.cardCollection=side.view;
 // Prepare missing wing inputs during a class wait, but never spend promotion
 // resources on a wing before the class is confirmed. Normal hunts are explicit.
 const secondary=plan.phase==='class'?planner.secondaryMissing(instance):[];
 const normal=require('../planning/boss-window').sideSources(instance.lastSave,wiki,[...plan.missing,...secondary],blocked).filter(g=>{
  const m=wiki.monsters.monsters.find(m=>m.id===g.monsterId),map=wiki.maps.maps.find(m=>m.id===g.mapId);
  return map?.bossRoom===false&&instance.lastSave.bestiary?.[g.monsterId]>0&&require('../planning/progression-work').allowedSource(m,map,instance.lastSave);
 });
 const training=require('../planning/campaign-side-work').training(instance,wiki,blocked,now);
 const rankedNormal=instance.v2?.sourceCoherence?.matches===true&&instance.v2?.farmEvidence?instance.v2.farmEvidence.rank(normal,instance.lastSave,instance.v2.learningRevision||cat.build):normal;
 const workBudget=require('../planning/side-work-budget');
 hunt.sources=workBudget.filter(instance,hunt.sources,now);
 const income=require('../planning/campaign-side-work').income(instance,wiki,plan,now);
 const equipment=require('../planning/progression-work').assess(instance,wiki,board,now,{campaignSideWork:true});
 instance.progressionWork=equipment;
 const equipmentCandidates=equipment.candidates.filter(g=>g.kind==='craft-work'&&g.monsterKind==='normal').map(g=>({...g,priority:0}));
 const extraCandidates=workBudget.filter(instance,[...income,...equipmentCandidates,quest.candidate&&{...quest.candidate,priority:0},...rankedNormal.map(g=>({...g,priority:0})),...side.candidates,...training].filter(Boolean),now);
 instance.endgameCampaign.sideWorkBudget=instance.campaignWorkStatus||null;
 const schedule=require('../planning/boss-window').schedule({hunt,save:instance.lastSave,wiki,now,room,missing:plan.missing,blocked,previous:instance.bossWindow,pendingTravel:instance.pendingTravel,measurements:require('./route-travel').view(instance,instance.campaignRoutes),sideSourcesAllowed:false,allowBlockedBossDetour:true,extraCandidates});
 if(instance.bossWindow?.goal?.monsterId!==schedule.goal?.monsterId||instance.bossWindow?.phase!==schedule.phase)instance.campaignRouteCheck=null;
 instance.bossWindow=schedule;instance.endgameCampaign.schedule=schedule;
 // Run one resource-protected upgrade before a repeated hunt command consumes
 // this tick. The fresh schedule still owns the return deadline and navigation.
 const combatAction=await combatWindowAction(instance,screen,plan,now);if(combatAction)return combatAction;
 if(instance.campaignRouteSample&&instance.campaignRouteSample.to!==schedule.goal?.mapId)instance.campaignRouteSample=null;
 instance.endgameCampaign.hunt=hunt;instance.campaignGoal=null;
 if(schedule.goal){instance.campaignGoal={...schedule.goal,campaign:true,sideWork:schedule.phase==='side-work'};}
 if(instance.pendingTravel&&instance.pendingTravel.mapId!==instance.campaignGoal?.mapId){instance.pendingTravel=null;}
 if(instance.campaignGoal){const goal=instance.campaignGoal;instance.goal=goal;instance.huntMap=goal.mapId;instance.teamGoal=null;
  if(instance.livePos?.room!==goal.mapId&&instance.livePos?.room!=='town'&&!instance.pendingTravel&&!screen.panelOpen&&instance.canDo('campaignRoute',45000)){
   return await require('./campaign-route').travel(instance,goal);
  }
  if(instance.livePos?.room===goal.mapId&&goal.monsterId&&!screen.panelOpen&&instance.canDo(goal.firstClear?'classBossTarget':'campaignTarget',goal.firstClear?2000:30000)){
   const selected=await require('./main-quest').selectTarget(instance,goal);instance.endgameCampaign.targetSelected=selected;
   if(selected&&goal.firstClear&&!goal.alive){await instance.expeditionAuto(false);
    const staged=await require('./class-boss-probe').stage(instance,goal);if(staged)instance.endgameCampaign.staging=staged;
    const prepared=await require('./class-boss-probe').prepare(instance,goal);if(prepared?.sent)instance.endgameCampaign.preparation=prepared;
    if(!Number.isFinite(goal.nextAt)||goal.nextAt-Date.now()>15000||goal.nextAt<Date.now()-5000||!await require('./boss-feed').awaitSpawn(instance,goal))return 'class boss: awaiting server-confirmed spawn';
   }
   if(selected&&goal.firstClear){const result=await require('./class-boss-probe').run(instance,goal);instance.endgameCampaign.action={at:Date.now(),kind:'class-first-clear',result};return 'class first clear: '+result.reason;}
   if(selected)await instance.expeditionAuto(true);else await instance.expeditionAuto(false);
  }
  return null;
 }
 if(plan.missing.some(r=>r.name==='jobLv')){const map=require('../director').frontierMap(instance.lastSave.lv,wiki,null,instance.brain.blocked());if(map){instance.campaignGoal={kind:'job-training',mapId:map.id,label:'เก็บ Job Lv เพื่อเลื่อนคลาส ไม่ใช่ EXP ตัวละคร',campaign:true};instance.goal=instance.campaignGoal;instance.huntMap=map.id;instance.teamGoal=null;return null;}}
 instance.endgameCampaign.waitReason=schedule.bossObservation?.combatBlock|| (hunt.boardFresh?'ยังไม่มีรอบบอสเป้าหมายที่ใช้เดินทางได้ ตรวจตารางเซิร์ฟเวอร์ต่อ':'รอข้อมูลตารางบอสสด ไม่เดาว่าบอสเกิด');
 if(plan.missing.some(r=>['coins','Copper'].includes(r.name)))return null;
 if(!screen.panelOpen&&instance.canDo('campaignWaitTarget',30000))await instance.eval(`(() => {const t=document.getElementById('huntTargetBtn');if(!t)return false;if(t.getAttribute('aria-expanded')!=='true')t.click();const b=document.querySelector('[data-hunt-target="all"]');if(b)b.click();else t.click();return !!b;})()`);
 // Remain on the present field while bosses cool down; never send a capped character back to an EXP frontier.
 if(instance.livePos?.room&&instance.livePos.room!=='town'){instance.campaignGoal={kind:'campaign-wait',mapId:instance.livePos.room,label:instance.endgameCampaign.waitReason,campaign:true};instance.goal=instance.campaignGoal;await instance.expeditionAuto(true);return 'campaign waiting for boss schedule';}
 return 'campaign waiting for authoritative boss schedule';
}
async function routeExpired(instance){
 if(instance.assistanceReleasePending)return true;
 if(instance.campaignGoal?.kind==='milestone-assist'){
  await require('./assistance-reservation').refresh(instance);
  const held=require('./assistance-reservation').state(instance);
  if(held)return held.waiting;
  const a=require('./milestone-assistance').plan(instance),g=instance.campaignGoal;
  return !a?.due||a.recipient!==g.recipient||a.monsterId!==g.monsterId||a.mapId!==g.mapId;
 }
 // A final ingredient can arrive after side-work started. Recheck from the
 // fresh save, not the previous campaign plan, before continuing a long walk.
 // Cancel only this optional route; never steal a team/recovery/trade owner.
 if(instance.campaignGoal&&!instance.teamControl&&!instance.dailyTeamPending&&!instance.dailyWorkStatus?.ownsNavigation&&!instance.survivalRecovery&&!instance.recycling&&!instance.choresBusy&&(!instance.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(instance.teamTradeStatus.phase))&&!require('./room-policy').roomPolicy(instance.livePos?.room).dungeon&&instance.v2?.sourceCoherence?.matches===true&&require('./freshness').decisionGate(instance).allowed){
  const build=instance.catalog().build;
  if(instance.promotionRouteCheck?.saveAt!==instance.lastSaveAt||instance.promotionRouteCheck?.build!==build){
   const current=planner.plan(instance);
   instance.promotionRouteCheck={saveAt:instance.lastSaveAt,build,ready:current.phase==='class'&&(current.ready||current.missing?.length>0&&current.missing.every(r=>r.name==='bag_slots'))};
  }
  if(instance.promotionRouteCheck.ready){instance.campaignGoal=null;instance.pendingTravel=null;instance.goal=null;return true;}
 }
 if(instance.campaignGoal?.income&&!instance.teamControl){
  const wiki=require('../economy').loadWiki(instance.root),now=Date.now();
  const rows=require('../planning/campaign-side-work').income(instance,wiki,planner.plan(instance),now);
  if(!rows.some(g=>g.mapId===instance.campaignGoal.mapId&&g.monsterId===instance.campaignGoal.monsterId))return true;
 }
 if(instance.campaignGoal?.kind==='promotion'&&!instance.teamControl){
  await require('./boss-feed').poll(instance,{waitMs:1200});
  const b=await instance.socialLast('bossboard'),g=instance.campaignGoal,now=Date.now();
  if(!require('./freshness').fresh(b?._receivedAt,45000,now))return true;
  if(!instance.endgameCampaign?.missing?.some(r=>r.name===g.material))return true;
  const row=b.list?.find(r=>r.id===g.monsterId&&r.map===g.mapId);if(!row)return true;
  if(row.up&&!row.next)return false;
  return !g.nextAt||!Number.isFinite(row.next)||Math.abs(row.next+b._receivedAt-b.now-g.nextAt)>5000;
 }
 if(instance.campaignGoal?.nightTraining)return !require('../planning/night-training').view(instance).active;
 if(instance.campaignGoal?.kind==='team-gather'){const next=require('../planning/team-workboard').candidate(instance);if(!next||next.workId!==instance.campaignGoal.workId)return true;}
 if(instance.campaignGoal?.questKey&&(instance.lastSave?.qv!==instance.campaignGoal.questVersion||instance.lastSave?.qIndex!==instance.campaignGoal.questIndex))return true;
 if(instance.campaignGoal?.kind==='pet-unlock'&&(Object.hasOwn(instance.lastSave?.pets||{},instance.campaignGoal.monsterId)||(instance.lastSave?.bestiary?.[instance.campaignGoal.monsterId]||0)>=instance.campaignGoal.petUnlockKills))return true;
 if(instance.campaignGoal?.kind==='gear-hunt'&&require('../economy').ownedNames(instance.lastSave||{}).includes(instance.campaignGoal.itemId))return true;
 if(instance.campaignGoal?.kind==='card-collection'&&require('../planning/campaign-side-work').ownsCard(instance.lastSave||{},instance.campaignGoal.cardId))return true;
 if(['main-quest','pet-unlock','gear-hunt','craft-work'].includes(instance.campaignGoal?.kind)&&['boss','miniboss'].includes(instance.campaignGoal.monsterKind)){
  if(instance.canDo('mainQuestRouteBoard',25000))await instance.queryBosses();
  const board=await instance.socialLast('bossboard'),now=Date.now(),g=instance.campaignGoal;
  if(!board||now-board._receivedAt>=45000||now-board._receivedAt< -5000||!board.list?.some(b=>b.id===g.monsterId&&b.map===g.mapId&&b.up&&!b.next))return true;
 }
 if(!instance.campaignGoal?.sideWork||instance.teamControl)return false;
 const schedule=instance.bossWindow;if(!schedule)return false;
 if(schedule.phase==='craft-retry-side-work')return Date.now()>=schedule.departAt;
 if(instance.campaignRouteCheck&&Date.now()-instance.campaignRouteCheck.at<2000)return instance.campaignRouteCheck.expired;
 if(instance.canDo('campaignRouteBoard',25000))await instance.queryBosses();
 const board=await instance.socialLast('bossboard'),now=Date.now();
 if(!board||now-board._receivedAt>45000||now-board._receivedAt< -5000){
  // A delayed reply does not own an unrelated safe card route. Revalidate
  // the current native card target; never extend a reserved boss deadline.
  if(!schedule.boss&&instance.v2?.sourceCoherence?.matches===true&&!instance.survivalRecovery){
   const g=instance.campaignGoal,wiki=require('../economy').loadWiki(instance.root);
   if(g.kind==='card-collection'){
    const rows=require('../planning/campaign-side-work').cards(instance,wiki,now).candidates;
    if(rows.some(r=>r.cardId===g.cardId&&r.monsterId===g.monsterId&&r.mapId===g.mapId))return false;
   }
   if(g.kind==='exp'&&require('./freshness').decisionGate(instance,now).allowed&&require('./freshness').fresh(instance.vitals?.at,15000,now)&&instance.vitals.hp>=.35){
    const rows=require('../planning/level-training').candidates(instance.lastSave,wiki,instance.catalog(),{room:instance.livePos?.room,blocked:instance.brain.blocked(now),provenOnly:true,maxTravelMs:620000,now,measurements:require('./route-travel').view(instance,instance.campaignRoutes,now)});
    if(rows.some(r=>r.monsterId===g.monsterId&&r.mapId===g.mapId))return false;
   }
  }
  return instance.campaignGoal?.kind!=='main-quest'||!!schedule.boss;
 }
 const wiki=require('../economy').loadWiki(instance.root);
 if(!schedule.boss){const hunt=planner.chooseHunt(planner.plan(instance),instance.lastSave,wiki,board,now,instance.brain.blocked(),require('../planning/progression-work').context(instance,now));const check=require('../planning/boss-window').schedule({hunt,save:instance.lastSave,wiki,now,room:instance.livePos?.room||'town',blocked:instance.brain.blocked(),measurements:require('./route-travel').view(instance,instance.campaignRoutes)});const expired=['boss-live','return-to-boss','preposition'].includes(check.phase);instance.campaignRouteCheck={at:now,expired};return expired;}
 const field=board.list?.find(b=>b.id===schedule.boss.monsterId&&b.map===schedule.boss.mapId);
 if(!field||field.up&&!field.next)return true;
 const nextAt=Number(field.next)+board._receivedAt-board.now;
 const travel=require('../planning/boss-window').travelBudget(instance.livePos?.room||'town',schedule.boss.mapId,wiki,require('./route-travel').view(instance,instance.campaignRoutes,now),{now});
 const expired=!Number.isFinite(nextAt)||now>=Math.min(schedule.departAt,nextAt-90000-travel.ms);instance.campaignRouteCheck={at:now,expired};return expired;
}
async function combatWindowAction(instance,screen,plan,now=Date.now()){
 if(plan.phase!=='wing'||plan.ready||!require('../planning/campaign-equipment').window(instance,now))return null;
 return require('./development-progress').tick(instance,screen);
}
module.exports={tick,observe,routeExpired,combatWindowAction};
