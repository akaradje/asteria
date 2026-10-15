'use strict';
// Read-only observer and pure planners, called by the existing continuity loop.
function observe(i,now=Date.now()){
 if(!i.actorIdentity?.actorId||!i.lastSave||typeof i.catalog!=='function')return;
 const store=require('../learning/combat-evidence').ensure(i);store?.observe(i,now);
 if(now-(i.grandmasterAt||0)<15000)return;i.grandmasterAt=now;
 const cat=i.catalog();i.theorycraft=require('../planning/theorycraft').plan(i,now);
 i.competitiveMeta=require('../planning/competitive-meta').analyze(i.competitiveGear,i.lastSave||{},cat,{now});
 i.bossMastery=require('../planning/boss-mastery').view(i,now);
 i.marketCycleMeasurements=require('../planning/market-cycle').view(i,now);
 if(i.lastSave)i.lastSave.empiricalCombatPreferences={at:now,actorId:i.actorIdentity?.actorId,build:cat.build,job:i.lastSave.job,policies:i.theorycraft.policies};
}
function view(i,now=Date.now()){const evidence=i.combatEvidence?.view(i,now);return {at:now,combat:evidence?{ready:evidence.ready,current:evidence.current,scope:evidence.scope,windows:evidence.windows.length}:null,theorycraft:i.theorycraft?{...i.theorycraft,policies:i.theorycraft.policies?.slice(0,8)}:null,competitiveMeta:i.competitiveMeta||null,bossMastery:i.bossMastery||null,authority:'knowledge_and_observation_only_native_executors_recheck_all_gates'};}
module.exports={observe,view};
