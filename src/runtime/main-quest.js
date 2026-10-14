'use strict';
const sameGoal=(a,b)=>!!a&&!!b&&['kind','mapId','monsterId','itemId','questKey','workId'].every(k=>a[k]===b[k]);
async function selectTarget(i,goal){
 if(!goal.monsterId)return true;
 // The native picker is multi-select and can retain targets from another map.
 // Clear through its own all control, then choose exactly the managed target.
 const selected=await i.eval(`(() => {const t=document.getElementById('huntTargetBtn');if(!t)return false;if(t.getAttribute('aria-expanded')!=='true')t.click();const id=${JSON.stringify(goal.monsterId)},rows=()=>Array.from(document.querySelectorAll('[data-hunt-target]')),b=rows().find(x=>x.dataset.huntTarget===id),all=rows().find(x=>x.dataset.huntTarget==='all');if(!b||!all||b.disabled||all.disabled){t.click();return false;}all.click();b.click();const chosen=rows().filter(x=>x.dataset.huntTarget!=='all'&&x.getAttribute('aria-pressed')==='true');const ok=chosen.length===1&&chosen[0].dataset.huntTarget===id;t.click();return ok;})()`);
 i.managedHuntReady=selected&&i.livePos?.room===goal.mapId?[i.catalog().build,goal.mapId,goal.monsterId].join(':'):null;return selected;
}
async function tick(i,screen){
 if(i.v2?.trial?.active())return null;
 if(i.survivalRecovery||i.goal?.kind==='survival'||i.survivalStatus?.deaths?.length&&i.survivalStatus.until>Date.now())return null;
 if(i.endgameCampaign?.active&&i.endgameCampaign.phase!=='complete')return null;
 if(!require('../planning/progression-priority').assess(i.lastSave,i.catalog()).equipmentAllowed){if(['main-quest','gear-hunt','equipment-drill','pet-unlock','team-gather','craft-work','craft-wait','development-side'].includes(i.campaignGoal?.kind)&&!i.endgameCampaign?.active){i.campaignGoal=null;i.goal=null;i.huntMap=null;i.pendingTravel=null;i.refreshGoal?.();}return null;}
 if(i.queryBosses&&i.canDo('mainQuestBossBoard',30000))await i.queryBosses();
 const view=require('../planning/main-quest').assess(i,require('../economy').loadWiki(i.root),{includeBoss:true,board:i.socialInbox?.last('bossboard')});i.mainQuest=view;
 if(i.goal?.kind==='main-quest'&&(!view.candidate||i.goal.questKey!==view.key)){i.campaignGoal=null;i.goal=null;i.huntMap=null;i.pendingTravel=null;i.refreshGoal?.();}
 const rare=require('../planning/rare-pet').assess(i,require('../economy').loadWiki(i.root),i.socialInbox?.last('bossboard'));i.rarePetPlan=rare;
 const growth=require('../planning/endgame-growth').assess(i,require('../economy').loadWiki(i.root),i.socialInbox?.last('bossboard'));
 if(i.goal?.kind==='equipment-drill'&&!growth.candidates.some(g=>g.kind==='equipment-drill'&&g.itemId===i.goal.itemId)){i.campaignGoal=null;i.goal=null;i.huntMap=null;i.refreshGoal?.();}
 const capped=i.lastSave?.lv>=i.catalog().world?.MAX_LV,quest=view.candidate?{...view.candidate,score:capped&&view.reward&&Object.keys(view.reward).every(k=>['exp','jexp','coins'].includes(k))?view.reward.coins>0?600:300:view.candidate.score}:null;
 const work=require('../planning/progression-work').assess(i,require('../economy').loadWiki(i.root),i.socialInbox?.last('bossboard'));i.progressionWork=work;
 if(work.schedule)i.bossWindow=work.schedule;
 const team=require('../planning/team-workboard').candidate(i);const choices=(work.schedule?.boss&&team?.monsterKind!=='boss'?work.candidates:[team,quest,rare.candidate,...growth.candidates,...work.candidates,...require('../planning/astral-path').training(i,require('../economy').loadWiki(i.root))]).filter(Boolean),build=i.v2?.learningRevision||i.catalog().build;
 const measured=i.v2?.farmEvidence?i.v2.farmEvidence.rank(choices,i.lastSave,build):choices;const combat=require('../planning/combat-work'),focus=i.brain?.strategy?.()?.action,ranked=combat.rank(i.v2?.goalFeedback?i.v2.goalFeedback.rank(measured,i.lastSave,build):measured.sort((a,b)=>b.score-a.score),focus,i);work.aiStrategy={at:Date.now(),...combat.strategyView(ranked,focus)};i.endgameGrowth={...growth,selected:ranked[0]||null,learning:i.v2?.goalFeedback?.view()||null};
 // A cooldown must release the navigation goal as well as hide its candidate.
 // Only retire the exact managed target removed by feedback, not an unrelated plan.
 if(choices.some(g=>sameGoal(g,i.goal))&&!ranked.some(g=>sameGoal(g,i.goal))){const retired=i.goal;if(sameGoal(i.campaignGoal,retired))i.campaignGoal=null;i.goal=null;i.huntMap=null;i.pendingTravel=null;i.refreshGoal?.();}
 const candidate=ranked[0];
 if(!i.pendingTravel&&['craft-work','craft-wait','development-side','card-collection','astral-training'].includes(i.goal?.kind)&&!ranked.some(g=>sameGoal(g,i.goal))){i.campaignGoal=null;i.goal=null;i.huntMap=null;i.refreshGoal?.();}
 if(i.goal?.kind==='team-gather'&&(!team||team.workId!==i.goal.workId)){i.campaignGoal=null;i.goal=null;i.huntMap=null;i.pendingTravel=null;i.refreshGoal?.();}
 if(i.goal?.kind==='gear-hunt'&&(!candidate||candidate.kind!=='gear-hunt'||candidate.itemId!==i.goal.itemId)){i.campaignGoal=null;i.goal=null;i.huntMap=null;i.refreshGoal?.();}
 if(i.goal?.kind==='pet-unlock'&&(!candidate||candidate.kind!=='pet-unlock'||candidate.monsterId!==i.goal.monsterId)){i.campaignGoal=null;i.goal=null;i.huntMap=null;i.refreshGoal?.();}
 if(!candidate||screen.death||screen.panelOpen||i.pendingTravel)return null;
 const goal={...candidate,campaign:true};i.campaignGoal=goal;i.goal=goal;i.huntMap=goal.mapId;i.teamGoal=null;
 if(goal.kind==='craft-wait')await i.expeditionAuto(false);
 if(goal.kind==='team-gather'&&goal.alive===false)await i.expeditionAuto(false);
 if(goal.kind!=='craft-wait'&&goal.alive!==false&&i.livePos.room===goal.mapId&&i.canDo('mainQuestTarget',30000)&&await selectTarget(i,goal)){
  if(goal.firstClear){const r=await require('./class-boss-probe').run(i,goal);return 'bounded equipment miniboss: '+r.reason;}
  await i.expeditionAuto(!!goal.monsterId);
 }
 if(i.livePos.room!=='town'&&i.livePos.room!==goal.mapId&&i.canDo('mainQuestRoute',45000)){
  await i.expeditionAuto(false);
  const from=require('../economy').loadWiki(i.root)?.maps?.maps?.find(m=>m.id===i.livePos.room);
  if(['gear-hunt','craft-work'].includes(goal.kind)&&goal.routeHint==='adjacent-field'&&[from?.connectsTo?.prev,from?.connectsTo?.next].includes(goal.mapId)&&typeof i.chainWalkTo==='function'){
   await i.chainWalkTo(goal.mapId);return i.livePos.room===goal.mapId?'equipment route: adjacent field reached':'equipment route: awaiting actual adjacent field arrival';
  }
  await i.returnToTown();return 'main quest: verified route via town';
 }
 return null;
}
module.exports={tick,selectTarget};
