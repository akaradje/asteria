'use strict';
// A versioned route, not a promise that a server proof or reward was earned.
function roadmap(world,star=0,bt=0,exp=0){
 const r=world.ASTRAL;
 if(!r||![world.astralNeed,world.astralWbGate,world.astralBossGate,world.astralWbTopGate].every(f=>typeof f==='function'))return null;
 const gates=[];
 for(let s=r.gateEvery;s<r.max;s+=r.gateEvery)gates.push({star:s,bill:r.gate(s/r.gateEvery),worldBoss:world.astralWbGate(s),regionalShare:world.astralBossGate(s)?r.bossShare:null,worldTop10:world.astralWbTopGate(s),done:s/r.gateEvery<=bt});
 const remaining=gates.filter(g=>!g.done),total=remaining.reduce((t,g)=>Object.fromEntries(Object.keys(t).map(k=>[k,t[k]+g.bill[k]])),{boss:0,mini:0,ore:0,copper:0});
 let remainingExp=0;for(let s=star;s<r.max;s++)remainingExp+=world.astralNeed(s);
 return {target:r.max,star,remainingGates:remaining.length,gates,remainingCost:total,remainingExp:Math.max(0,remainingExp-exp),minMonsterLevel:r.minMonLv,autoGrade:r.grades[r.autoMax]?.g,proofScope:'server flags per actor; traded cores do not replace participation/damage/rank',etaMs:null};
}
function enabled(i,action){
 const p=i.registryV32?.policy,c=i.catalog(),rev=require('../knowledge/capability-registry').registry(c).astral.revision;
 const dynamic=p?.adaptiveCombatActions===true&&require('../equipment-goal').policy(c).dynamicProgression;
 if(dynamic&&catAdaptive(i,c,action))return null;
 if(p?.astralActions!==true)return 'astral_actions_disabled';
 const same=p.astralBuild===c.build||/^[a-f0-9]{64}$/.test(p.astralTransportRevision||'')&&p.astralTransportRevision===c.nativeTransportRevision;
 if(!same||p.astralRevision!==rev)return 'astral_policy_build_mismatch';
 if(!p.astralCanaryActors?.includes(i.actorIdentity?.actorId))return 'astral_actor_not_enabled';
 if(action==='asbt'&&p.astralBreakthrough!==true)return 'astral_breakthrough_disabled';
 if(action==='asbt'&&!require('../equipment-goal').policy(c).dynamicProgression&&equipmentPending(i))return 'equipment_legendary8_refine10_first';
 return null;
}
function catAdaptive(i,c,action){const team=require('./host-team-scope').team(i.root,i.machine);return ['aspt','asbt'].includes(action)&&c.nativeSemanticContracts?.astral?.allowed===true&&team?.members?.some(r=>r.charName===i.character?.name)&&i.registryV32?.store.validateOwner(i.actorOwner)===true&&i.v2?.sourceCoherence?.matches===true;}
function equipmentPending(i){
 const goal=require('../equipment-goal').assess(i.lastSave||{},i.catalog());
 return !!goal&&!goal.complete;
}
function training(i,wiki,now=Date.now()){
 const c=i.catalog(),s=i.lastSave||{},a=i.socialInbox?.astral?.view(now),r=c.world?.ASTRAL,fresh=require('../runtime/freshness').fresh;
 if(!r||s.lv<c.world.MAX_LV||!c.world.HIGH_CLASSES?.[s.job]||!a?.fresh||a.completeness!=='full'||a.state?.gate||!(a.state?.s<r.max)||i.v2?.sourceCoherence?.matches!==true||wiki?._source?.verifiedBuild!==c.build||!fresh(i.lastSaveAt,30000,now)||!fresh(i.vitals?.at,15000,now)||i.vitals.hp<.85||!Number.isFinite(i.vitals.maxHp)||require('../runtime/survival').hpPots(s)<20||i.survivalRecovery||require('../runtime/survival').recentDeaths(i,now).length)return [];
 const blocked=i.brain?.blocked?.(now)||{},rows=[];
 for(const map of wiki.maps?.maps||[]){
  if(!['field','dungeon'].includes(map.kind)||map.bossRoom!==false||map.levelMin>s.lv||blocked[map.id]||require('../runtime/room-policy').roomPolicy(map.id).dungeon)continue;
  const nativeMap=c.world.MAPS?.find(x=>x.id===map.id);if(!nativeMap||nativeMap.bossRoom!==false||nativeMap.levelMin!==map.levelMin)continue;
  const travel=require('./boss-window').travelBudget(i.livePos?.room||'town',map.id,wiki).ms;if(!Number.isFinite(travel)||travel>465000)continue;
  for(const id of map.monsters?.normal||[]){
   const m=c.world.MONSTERS.find(m=>m.id===id);
   if(m?.kind!=='normal'||m.level<r.minMonLv||m.level>s.lv||!(s.bestiary?.[id]>0)||!(m.atk>0)||i.vitals.maxHp<m.atk*4||!(m.exp>0)||!(m.hp>0))continue;
   const g={kind:'astral-training',purpose:'astral',priority:0,mapId:map.id,mapName:map.name,monsterId:id,monsterKind:'normal',level:m.level,travelMs:travel,alive:true,label:'ดาว '+a.state.s+' → '+r.max+': '+m.name,reason:'มอน Lv '+m.level+' มีประวัติฆ่าจริงและได้ EXP ดาว · รวมการตายและเวลาสูญเสียในผลวัด',score:1900};
   const proof=i.v2.farmEvidence?.matching?.(s,i.v2.learningRevision||c.build,g);
   if(proof?.cooldownUntil>now||proof?.deaths>0)continue;
   const measured=proof?.samples>=10&&proof.ms>=300000&&now>=proof.at&&now-proof.at<86400000;
   const rate=measured?proof.kills*3600000/proof.ms*m.exp:null;
   if(measured&&!(rate>0))continue;
   g.estimatedYield=rate??m.exp/(2+m.hp/5000);g.measuredKills=measured;g.evidence='native eligible EXP; observed kills when available; not measured net Astral EXP';rows.push(g);
  }
 }
 rows.sort((a,b)=>Number(b.measuredKills)-Number(a.measuredKills)||b.estimatedYield-a.estimatedYield||a.travelMs-b.travelMs);
 return rows.slice(0,4).map((g,n)=>({...g,score:1900+rows.length-n}));
}
function bossNeed(i,now=Date.now()){
 if(!require('../equipment-goal').policy(i.catalog()).dynamicProgression&&equipmentPending(i))return null;
 const c=i.catalog(),a=i.astralObjective,s=i.lastSave||{};
 if(!a?.active||a.build!==c.build||!require('../runtime/freshness').fresh(a.at,30000,now)||!a.gate&&a.state!=='gate_blocked'||i.v2?.sourceCoherence?.matches!==true||!require('./progression-priority').assess(s,c).equipmentAllowed)return null;
 const missing=(a.missing||[]).filter(n=>n.kind==='material'&&n.alternatives?.some(id=>c.world.ASTRAL.bossCores.includes(id))&&n.want>n.have);
 if(!missing.length)return null;
 const sources=c.world.MONSTERS.filter(m=>m.kind==='boss'&&c.world.ASTRAL.bossIds.includes(m.id)&&m.dropTable?.some(d=>missing.some(n=>n.alternatives.includes(d.itemName))&&d.rate>0)).sort((a,b)=>a.atk-b.atk);
 const needs={};for(const m of sources)for(const d of m.dropTable)if(missing.some(n=>n.alternatives.includes(d.itemName)))needs[d.itemName]=(s.materials?.[d.itemName]||0)+1;
 return {astral:true,needs,coins:a.bill?.copper||0,missing:Object.entries(needs).map(([name,want])=>({name,want,have:s.materials?.[name]||0}))};
}
module.exports={roadmap,enabled,equipmentPending,training,bossNeed};
