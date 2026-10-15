'use strict';
const fresh=require('../runtime/freshness').fresh;
function sample(i,now){
 const party=i.socialInbox?.last('party'),peers=i.teamPeers?.();
 if(!['tum','vps'].includes(i.machine)||!party?.id||!party._sessionBound||!Array.isArray(party.members)||!Array.isArray(peers)||peers.length!==3||require('../runtime/party-evidence').observedAt(party,now)===null)return null;
 // Only a verified same-host roster may form a two/three-person nearby cohort.
 if(party.members.length<2||party.members.length>3)return null;
 const rows=[];
 for(const m of party.members){const p=peers.find(p=>p.credentials?.charName===(m.name||m.charName));
  if(!p||p.machine!==i.machine||String(m.id)!==String(p.character?.id))return null;
  if(p.catalog().build!==i.catalog().build||p.v2?.loadedSourceIdentity?.signature!==i.v2.loadedSourceIdentity.signature||p.socialInbox?.criticalGap||p.status!=='playing'||!fresh(p.livePos?.at,10000,now)||p.livePos?.room!==i.livePos.room||!fresh(p.vitals?.at,15000,now)||!fresh(p.socialInbox?.power?.combat?.hp?.at,15000,now))continue;
  if(![p.livePos.x,p.livePos.z,i.livePos.x,i.livePos.z].every(Number.isFinite)||Math.hypot(p.livePos.x-i.livePos.x,p.livePos.z-i.livePos.z)>10)continue;
  rows.push({p,m});
 }
 if(rows.length<2||!rows.some(x=>x.p===i))return null;
 return rows;
}
function observe(i,r,previousAt,now){
 const members=sample(i,now);if(!members){r.partyCoverageBroken=true;r.partyLastAt=null;r.partyContinuousMs=0;return;}
 const ms=now-previousAt;if(ms<=0||ms>15000)return;
 const signature=JSON.stringify(members.map(({p})=>[p.actorIdentity?.actorId,p.actorOwner?.session,p.socialInbox?.generation,p===i?'caster':require('./combat-evidence').loadout(p.socialInbox.power?.enrich?.(p,{...p.lastSave},now)||p.lastSave||{})]).sort());
 if(r.partyObservationSignature&&r.partyObservationSignature!==signature){r.partyCoverageBroken=true;return;}r.partyObservationSignature=signature;
 r.partyObservedMs=(r.partyObservedMs||0)+ms;r.partyRecipientMs=(r.partyRecipientMs||0)+ms*members.length;r.partyMemberCount=members.length;
 const alive=members.every(({p})=>!p.socialInbox.power.combat.hp.dead&&!p.livePos.dead&&!(p.socialInbox.power.combat.deathAt>previousAt&&p.socialInbox.power.combat.deathAt<=now));
 if(alive){r.zeroDeathPartyMs=(r.zeroDeathPartyMs||0)+ms;r.partyContinuousMs=(r.partyLastAt===previousAt?r.partyContinuousMs||0:0)+ms;r.maxZeroDeathContinuousMs=Math.max(r.maxZeroDeathContinuousMs||0,r.partyContinuousMs);}else{r.partyDeathsObserved=true;r.partyContinuousMs=0;}r.partyLastAt=now;
 // Receiver HUD confirms the offered native skill is active. A cast ACK alone
 // cannot claim uptime; overlapping/ambiguous casters are excluded.
 r.supportBuffMs||={};r.supportHeals||=0;r.supportHealAmount||=0;r.supportHealActiveMs||=0;
 for(const{p}of members){
  const state=p.socialInbox.power.combat,events=state.events,offers=events.filter(e=>e.t==='psup'&&e.from===i.credentials?.charName&&e.at<=now&&now-e.at<=30000);
  const keys=p.v2?.observation?.buffKeys;
  r.supportTransitions||={};const actor=p.actorIdentity.actorId,old=r.supportTransitions[actor];
  if(fresh(p.v2?.observation?.at,15000,now)&&Array.isArray(keys)){
   const active={};for(const key of keys){const sk=key.startsWith('s:')?key.slice(2):null;if(!sk)continue;const latest=events.findLast(e=>e.t==='psup'&&e.sk===sk&&e.at<=now);
    const transitioned=old&&!old.keys.includes(key)&&latest?.at>previousAt&&latest?.from===i.credentials?.charName;
    const retained=old?.active?.[sk]===latest?.sequence&&latest?.from===i.credentials?.charName;
    if(transitioned||retained){active[sk]=latest.sequence;if(retained)r.supportBuffMs[sk]=(r.supportBuffMs[sk]||0)+ms;}
   }r.supportTransitions[actor]={keys,active};
  }
  // Only a unique immediately preceding native heal offer can be attributed.
  for(const h of events.filter(e=>e.t==='pheal'&&e.at>previousAt&&e.at<=now&&e.n>0)){const candidates=events.filter(e=>e.t==='psup'&&e.amt>0&&e.at<=h.at&&h.at-e.at<=1000);if(candidates.length===1&&candidates[0].from===i.credentials?.charName){r.supportHeals++;r.supportHealAmount+=h.n;r.supportHealActiveMs+=Math.min(ms,1000);}}
 }
}
function view(r){const ms=r.partyObservedMs||0;return {partyCoverageMs:ms,nearbyMembers:r.partyMemberCount||0,recipientObservedMs:r.partyRecipientMs||0,completeParty:ms>0&&!r.partyCoverageBroken,zeroDeathSustainedMs:r.partyDeathsObserved?0:r.maxZeroDeathContinuousMs||0,zeroDeathPartyFraction:ms?(r.zeroDeathPartyMs||0)/ms:null,healEvents:r.supportHeals||0,healingApplied:r.supportHealAmount||0,healEventsPerMinute:ms?(r.supportHeals||0)*60000/ms:null,healActiveFraction:ms?Math.min(1,(r.supportHealActiveMs||0)/ms):null,buffRecipientSeconds:Object.fromEntries(Object.entries(r.supportBuffMs||{}).map(([k,v])=>[k,v/1000])),buffRecipientUptime:ms?Object.fromEntries(Object.entries(r.supportBuffMs||{}).map(([k,v])=>[k,Math.min(1,v/(r.partyRecipientMs||3*ms))])):null,authority:'native_receiver_frames_and_observed_active_HUD',causalSurvivalCredit:false};}
module.exports={sample,observe,view};
