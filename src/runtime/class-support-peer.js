'use strict';
const fresh=require('./freshness');
function project(i,now=Date.now()){
 if(typeof i.catalog!=='function'||!i.character?.name||!i.v2?.observations?.sessionId)return null;
 const s=i.lastSave||{},cat=i.catalog(),party=i.socialInbox?.last('party');
 const required=require('../upgrade-reserve').cores;
 return {build:cat.build,session:i.v2.observations.sessionId,sourceCurrent:i.v2.sourceCoherence?.matches===true,
  save:{job:s.job,jobLv:s.jobLv,lv:s.lv,coins:s.coins,equip:s.equip,bagTier:s.bagTier,bagUsed:Array.isArray(s.bag)?s.bag.length:null,potions:require('./survival').hpPots(s),materials:Object.fromEntries(required.map(k=>[k,s.materials?.[k]||0]))},
  vitals:i.vitals?{at:i.vitals.at,hp:i.vitals.hp,maxHp:i.vitals.maxHp,currentHp:i.vitals.currentHp}:null,
  party:party?{id:party.id,_sessionBound:party._sessionBound,_receivedAt:party._receivedAt,_streamAt:party._streamAt}:null,
  phase:i.endgameCampaign?.phase,ready:i.endgameCampaign?.ready,missing:i.endgameCampaign?.missing?.filter(r=>required.includes(r.name)).map(r=>({name:r.name,want:r.want,have:r.have})),
  protected:!!(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.survivalRecovery||i.recycling||i.choresBusy||i.v2.trial?.active()||require('./team-trade').blocksNavigation(i)),
  developmentBlocked:require('./equipment-headroom').developmentBlocks(i),journalBlocked:require('./equipment-headroom').journalBlocks(i),
  deaths:require('./survival').recentDeaths(i,now),probes:(i.classBossProbes||[]).filter(r=>r.cooldownUntil>now).map(r=>({monsterId:r.monsterId,build:r.build,status:r.status,deadline:r.deadline,cooldownUntil:r.cooldownUntil})),storageBlocked:!!i.classBossProbeStorageBlocked,
  goal:i.goal?{kind:i.goal.kind,recipient:i.goal.recipient,monsterId:i.goal.monsterId,mapId:i.goal.mapId}:null,managedTarget:i.managedHuntReady,
  pendingTravel:!!i.pendingTravel,
  reservation:i.assistanceReservation?{key:i.assistanceReservation.assignment.key,expiresAt:i.assistanceReservation.expiresAt}:null};
}
function wrap(m,source,owner,now=Date.now()){
 const x=m.classSupport,cat=owner?.catalog?.();
 if(!x||!cat||source.build!==cat.build||x.build!==cat.build||x.session!==m.runtimeGeneration||!x.sourceCurrent||!fresh.fresh(source.at,15000,now)||!fresh.fresh(m.lastSaveAt,30000,now)||!fresh.fresh(m.livePos?.at,10000,now)||!fresh.fresh(x.vitals?.at,15000,now)||x.party?._sessionBound!==true||require('./party-evidence').observedAt(x.party,now)===null)return null;
 if(!Number.isInteger(x.save?.bagUsed)||x.save.bagUsed<0||x.save.bagUsed>2000||!Number.isFinite(x.save.potions))return null;
 const p={...m,remoteValidated:true,root:owner.root,character:{name:m.charName},catalog:()=>cat,lastSave:{...x.save,bag:Array(x.save.bagUsed).fill(null)},vitals:x.vitals,
  endgameCampaign:{phase:x.phase,ready:x.ready,missing:x.missing||[]},teamControl:x.protected,
  developmentLedger:{pending:()=>x.developmentBlocked},v2:{sourceCoherence:{matches:true},journal:{pending:()=>x.journalBlocked}},
  brain:{data:{deaths:Object.fromEntries([...new Set((x.deaths||[]).map(r=>r.map))].map(map=>[map,x.deaths.filter(r=>r.map===map).map(r=>r.at)]))}},
  classBossProbes:x.probes||[],classBossProbeStorageBlocked:x.storageBlocked,goal:x.goal,campaignGoal:x.goal,managedHuntReady:x.managedTarget,pendingTravel:x.pendingTravel,remoteAssistance:x.reservation,
  socialInbox:{last:kind=>kind==='party'?x.party:null,bossPositions:{view:(...args)=>owner.socialInbox?.bossPositions?.view(...args)}}};
 p.classBossProbeActive=p.classBossProbes.find(r=>r.status==='running')||null;
 return p;
}
module.exports={project,wrap};
