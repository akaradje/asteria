'use strict';
// Publish already observed in-process facts, independent of heavy planners and
// status.json. Never evaluate a browser, infer a save timestamp or write state.
const fields=['identity','lv','job','equip','refine','petActive','astral','lastSaveAt','fps','fpsAt','stageProfile','nativeBotConsole','capabilityOutcomes','capabilityCoverage','runtimeProgress','activePetStatus','costumeBook','development','wholeCycle'];
const position=r=>r?Object.fromEntries(['room','x','z','at','dead'].map(k=>[k,r[k]])):null;
function capture(farm,now=Date.now()){
 const sourceRevision=farm.gameKnowledge?.systemIdentity?.revision,build=require('node:path').basename(farm.cache.dir),members=[],details=[];
 if(!/^[a-f0-9]{64}$/.test(sourceRevision||''))return null;
 for(const i of farm.instances.filter(i=>i?.actorIdentity&&i.loadedFarmRevision===sourceRevision)){
  const identity=i.registryV32.public(i.actorIdentity),s=i.lastSave||{},v=i.v2||{};
  members.push({identity,slot:i.slot,charName:i.character?.name||i.credentials?.charName,status:i.status,job:s.job,lv:s.lv,lastSaveAt:i.lastSaveAt,teamPartyId:i.teamPartyId||null,livePos:position(i.livePos),vitals:i.vitals?{hp:i.vitals.hp,mp:i.vitals.mp,at:i.vitals.at}:null,recycling:!!i.recycling,performance:{fps:i.lastFps??null,at:i.lastFpsAt||null},actionOwner:i.teamControl?'activity':null});
  const select=require('../registry/host-feed').detail;
  details.push({slot:i.slot,charName:members.at(-1).charName,details:{identity,lv:s.lv,job:s.job,equip:s.equip||{},refine:s.refine||{},petActive:s.petActive||null,astral:i.socialInbox?.astral?.view()||null,lastSaveAt:i.lastSaveAt,fps:i.lastFps??null,fpsAt:i.lastFpsAt||null,stageProfile:select('stageProfile',{stageProfile:v.scheduler?.profiler?.view?.()||null}),nativeBotConsole:{active:v.observation?.nativeBotConsole===true},capabilityOutcomes:require('../runtime/capability-evidence').outcomes(i),capabilityCoverage:select('capabilityCoverage',{capabilityCoverage:v.capabilityRegistry||null}),development:select('development',{development:i.developmentLedger?.view?.()||[]}),wholeCycle:i.wholeCycle||null,activePetStatus:require('../runtime/active-pet').view(i),costumeBook:v.costumeBook||null,runtimeProgress:{phase:v.phase||null,lastActionAt:v.lastActionAt||null,activeTask:v.scheduler?.view().active?.kind||null,freshness:require('../runtime/freshness').decisionGate(i,now).reason,astralQuery:i.astralQueryStatus||null,progression:null}}});
 }
 return {version:1,machine:farm.machine,pid:process.pid,at:now,sourceRevision,build,members,details,authority:'native_in_process_observation_not_mutation_receipt'};
}
function valid(frame,snapshot,host,health,now=Date.now()){
 return !!(frame?.version===1&&frame.machine===host&&health?.running===true&&Number.isSafeInteger(frame.pid)&&frame.pid>0&&frame.pid===health.farmPid&&Number.isSafeInteger(health.farmStartedAt)&&frame.at>=health.farmStartedAt&&Number.isFinite(frame.at)&&now>=frame.at&&now-frame.at<7000&&frame.sourceRevision===snapshot?.gameKnowledge?.systemVersion?.loadedSystemRevision&&frame.build===snapshot.gameKnowledge.systemVersion.build&&Array.isArray(frame.members)&&frame.members.length<=128&&Array.isArray(frame.details)&&frame.details.length===frame.members.length&&frame.members.every(m=>/^actor-[a-f0-9]{32}$/.test(m.identity?.actorId||'')&&Number.isInteger(m.slot)&&m.slot>=0)&&new Set(frame.members.map(m=>m.identity.actorId)).size===frame.members.length&&new Set(frame.members.map(m=>m.slot)).size===frame.members.length&&frame.details.every(d=>frame.members.some(m=>m.slot===d.slot&&m.charName===d.charName&&m.identity.actorId===d.details?.identity?.actorId)&&Object.keys(d.details).every(k=>fields.includes(k))));
}
function write(farm,now=Date.now()){
 const value=capture(farm,now);if(!value)return {ok:false};
 const dir=require('node:path').join(farm.root,'logs/fleet');
 if(!farm.nativeObservationDirectoryReady){require('node:fs').mkdirSync(dir,{recursive:true});farm.nativeObservationDirectoryReady=true;}
 return require('../runtime/telemetry-file').writeTelemetry(require('node:path').join(dir,'native-observation.json'),value);
}
module.exports={fields,capture,valid,write};
