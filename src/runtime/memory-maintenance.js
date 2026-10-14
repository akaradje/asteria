'use strict';
const path=require('path');
const {roomPolicy,sameGatherRoom}=require('./room-policy');

// A reclaim/recycle is optional maintenance. Never interrupt owned work or an
// unresolved payment, even when an older position still says town.
function maintenanceBlock(i){
 if(!i||i.status!=='playing'||i.recycling||i.healthRecovery)return 'not idle playing';
 if([i.livePos?.room,i.lastSave?.mapId,i.v2?.observation?.room].some(r=>roomPolicy(r).dungeon))return 'protected room';
 if(i.choresBusy||i.teamControl||i.pendingTravel||i.v2?.scheduler?.view().active)return 'active action';
 if(i.v2?.journal?.pending?.()||i.developmentLedger?.pending?.()||i.equipmentLedger?.pending?.())return 'unresolved outcome';
 const phase=i.teamTradeStatus?.phase;
 if(phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(phase))return 'team trade';
 return null;
}

// GC preserves the page/session. An idle actor already at its verified staging
// point may release unreachable objects while the last team slot waits for RAM.
// This exception must never authorize recycle, rotation or shedding.
function purgeBlock(i,{now=Date.now(),owner=null}={}){
 if(!i||i.status!=='playing'||i.recycling||i.healthRecovery)return 'not idle playing';
 if([i.livePos?.room,i.lastSave?.mapId,i.v2?.observation?.room].some(r=>roomPolicy(r).dungeon))return 'protected room';
 if(i.choresBusy||i.pendingTravel)return 'active action';
 const scheduler=i.v2?.scheduler,view=scheduler?.view();
 const owned=owner&&owner===scheduler?.active&&(owner.kind==='memory-gc'||!i.teamControl&&owner.kind==='tick');
 if(view?.active&&!owned||view?.queued?.length||view?.state==='stopped')return 'active or queued action';
 // GC cannot replay an old potion purchase. Keep destructive maintenance strict
 // and only isolate the same closed-session potion exception used for inventory.
 if(require('./equipment-headroom').journalBlocks(i,now)||i.developmentLedger?.pending?.()||i.equipmentLedger?.pending?.())return 'unresolved outcome';
 const phase=i.teamTradeStatus?.phase,intent=i.teamTradeIntent,name=i.credentials?.charName||i.character?.name||i.char;
 if(phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(phase)||intent?.offer&&[intent.offer.donor,intent.offer.receiver].includes(name)&&!['IDLE','CONFIRMED','CANCELLED'].includes(intent.phase)||i.tradeJournal?.sessionId&&!['CONFIRMED','CANCELLED'].includes(i.tradeJournal.phase))return 'team trade';
 if(i.teamControl){
  const activity=i.fleetActivityIntent,build=i.cache?.dir?path.basename(i.cache.dir):i.buildHash;
  const fresh=(at,max)=>Number.isFinite(at)&&now-at>=0&&now-at<max;
  if(!build||activity?.build!==build||!activity.id||!['GATHERING','PREPARING'].includes(activity.phase)||!['tower','rift','guild'].includes(activity.kind)||!fresh(activity.at,15000)||!Number.isFinite(activity.deadline)||activity.deadline<=now)return 'activity not idle staging';
  if(!fresh(i.lastSaveAt,30000)||!fresh(i.livePos?.at,10000)||!sameGatherRoom(i.livePos.room,activity.kind))return 'staging position or save not fresh';
 }
 return null;
}
module.exports={maintenanceBlock,purgeBlock};
