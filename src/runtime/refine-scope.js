'use strict';
// Historical unrelated commands keep their replay fences and resource holds.
// Only navigation to a distinct refinement target may proceed from current
// server-loaded ownership. This never settles or erases those old commands.
function blocks(i,targetId,now=Date.now()){
 const level=i.lastSave?.refine?.[targetId]??(Object.values(i.lastSave?.equip||{}).includes(targetId)?0:null);
 // A budget rebase cannot authorize another roll of the same unknown step.
 // A genuinely advanced native level is a different step; other items remain
 // independently eligible. Retain this fence across game builds and sessions.
 if(i.developmentLedger?.rows?.some(r=>r.kind==='refine'&&r.target?.id===targetId&&r.reconciliation?.replayBlocked===true&&r.reconciliation.historicalSuccessKnown===false&&level===r.reconciliation.beforeRefine&&require('./native-reservation-result').result(r,i.actorIdentity?.actorId)==='RECONCILED')&&!require('./fresh-refine-attempt').allowed(i,targetId,now))return true;
 const j=i.v2?.journal;if(!Array.isArray(j?.rows))return require('./equipment-headroom').journalBlocks(i,now);
 const cat=i.catalog(),receipt=i.serverSaveReceipt,p=receipt?.proof,s=receipt?.state;
 const bound=p?.authority==='server_readback'&&p.actorId===i.actorIdentity?.actorId&&p.build===cat.build&&p.sessionStartedAt===i.bagSessionStartedAt&&p.generation===i.socialInbox?.generation&&Number.isSafeInteger(p.rev)&&Number.isFinite(p.requestAt)&&Number.isFinite(p.at)&&p.requestAt>=p.sessionStartedAt&&p.at>=p.requestAt&&p.at<=now&&p.at-p.requestAt<=30000&&Object.values(s?.equip||{}).includes(targetId)&&Object.values(i.lastSave?.equip||{}).includes(targetId)&&Number.isInteger(s?.refine?.[targetId]??0)&&Number.isSafeInteger(s?.coins)&&s.coins>=0;
 const independent=r=>require('./closed-gear-scope').independent(i,r,targetId,'refine',now)||bound&&!r.legacyIdentityUnknown&&['UNCERTAIN','OBSERVED'].includes(r.status)&&Number.isFinite(r.at)&&p.sessionStartedAt-r.at>=60000&&(r.kind==='purchase'&&!r.externalOwner&&['Red Potion','Blue Potion','Orange Potion','Yellow Potion','White Potion','Starlight Potion'].includes(r.target?.item)||r.kind==='refine'&&r.externalOwner==='development-ledger'&&r.target?.id&&r.target.id!==targetId&&cat.items[r.target.id]);
 return require('./equipment-headroom').journalBlocks({...i,v2:{...i.v2,journal:{...j,rows:j.rows.filter(r=>!independent(r))}}},now);
}
function currentReceipt(i,now){
 const p=i.serverSaveReceipt?.proof;
 return p?.authority==='server_readback'&&p.actorId===i.actorIdentity?.actorId&&p.build===i.catalog().build&&p.sessionStartedAt===i.bagSessionStartedAt&&p.generation===i.socialInbox?.generation&&Number.isSafeInteger(p.rev)&&Number.isFinite(p.requestAt)&&p.requestAt>=p.sessionStartedAt&&Number.isFinite(p.at)&&p.at>=p.requestAt&&p.at<=now&&p.at-p.requestAt<=30000;
}
function readbackStatus(i,now=Date.now()){
 const p=i.serverSaveReceipt?.proof;
 const reason=!p?'native equipment readback missing':p.actorId!==i.actorIdentity?.actorId?'native equipment readback actor differs':p.build!==i.catalog().build?'native equipment readback build differs':p.sessionStartedAt!==i.bagSessionStartedAt||p.generation!==i.socialInbox?.generation?'native equipment readback session/generation differs':!currentReceipt(i,now)?'native equipment readback authority invalid':now-p.at>60000?'native equipment readback expired':null;
 return {ready:reason===null,reason,at:p?.at||null,generation:p?.generation??null,currentGeneration:i.socialInbox?.generation??null,spend:0,replayAllowed:false};
}
async function refreshReadback(i,now=Date.now()){
 const fresh=require('./freshness'),deny={attempted:false};
 // Refresh native ownership after reconnect; never weaken the generation
 // binding or infer settlement from an outgoing save. Replan on a later tick.
 const renew=require('./fresh-refine-attempt').enabled(i)&&now-(i.serverSaveReceipt?.proof?.at||0)>30000;
 if(currentReceipt(i,now)&&!renew||!i.actorIdentity?.actorId||!i.actorOwner||!i.registryV32?.store?.validateOwner(i.actorOwner)||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed||!fresh.fresh(i.vitals?.at,15000,now)||i.vitals.hp<.95||i.livePos?.dead||i.teamControl||i.fleetActivityBusy||i.pvpMission||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||i.recycling||i.healthRecovery||i.choresBusy||i.survivalRecovery||i.v2?.trial?.active()||require('./room-policy').roomPolicy(i.livePos?.room).dungeon||require('./team-trade').blocksNavigation(i)||i.activeResourceClaim||i.activeDevelopmentAttempt||i.nativeFreshSaveFlight||i.paidReadbackFlight||i.nativeReadbackFlight)return deny;
 if((i.developmentLedger?.rows||[]).some(r=>r.status==='pending')||i.registryV32.store.pending(i.actorIdentity.actorId).length)return deny;
 const cat=i.catalog(),start=i.bagSessionStartedAt;
 const old=(i.developmentLedger?.rows||[]).some(r=>r.kind==='refine'&&r.reconciliation?.replayBlocked===true)||(i.v2?.journal?.rows||[]).some(r=>require('./closed-gear-scope').history(i,r,now)||!r.legacyIdentityUnknown&&['UNCERTAIN','OBSERVED'].includes(r.status)&&Number.isFinite(r.at)&&start-r.at>=60000&&(r.kind==='refine'&&r.externalOwner==='development-ledger'&&cat.items[r.target?.id]||r.kind==='purchase'&&!r.externalOwner&&['Red Potion','Blue Potion','Orange Potion','Yellow Potion','White Potion','Starlight Potion'].includes(r.target?.item)));
 if(!old||!i.canDo('equipmentNativeReadback',60000))return deny;
 i.v2.scheduler?.checkpoint();
 try{const receipt=await require('./native-save-probe').authoritativeReadback(i);i.equipmentReadbackStatus={at:Date.now(),verified:!!receipt&&receipt===i.serverSaveReceipt&&readbackStatus(i).ready,reason:'native ownership readback; paid outcomes remain separately fenced'};}
 catch{ i.equipmentReadbackStatus={at:Date.now(),verified:false,reason:'native ownership readback unavailable; payment gates retained'}; }
 return {attempted:true,verified:i.equipmentReadbackStatus.verified};
}
module.exports={blocks,refreshReadback,readbackStatus};
