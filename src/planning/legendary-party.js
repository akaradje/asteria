'use strict';
const fresh=require('../runtime/freshness').fresh,acquisition=require('./legendary-acquisition');
const name=i=>i.character?.name||i.credentials?.charName;
function paymentSafe(p,now){
 const blocked=require('../runtime/equipment-headroom').developmentBlocks(p)||require('../runtime/equipment-headroom').journalBlocks(p);
 return !blocked||fresh(p.serverSaveReceipt?.proof?.at,30000,now)&&require('../runtime/storage-payment-scope').independent(p,{action:'combat-gather'},now);
}
function members(i,now,minHp=.85){
 const scope=require('./host-team-scope').team(i.root,i.machine);if(!scope)return [];
 const expected=scope.members.map(m=>m.charName),all=[...new Set([i,...(i.teamPeers?.()||[])])].filter(p=>expected.includes(name(p)));
 if(all.length!==3||new Set(all.map(name)).size!==3||new Set(all.map(p=>p.actorIdentity?.actorId)).size!==3)return [];
 const party=i.socialInbox?.last('party');if(!party?.id||party._sessionBound!==true||require('../runtime/party-evidence').observedAt(party,now)===null)return [];
 return all.every(p=>{const own=p.socialInbox?.last('party');return p.machine===i.machine&&!p.remoteMachine&&p.status==='playing'&&p.actorIdentity?.actorId&&p.catalog().build===i.catalog().build&&p.v2?.sourceCoherence?.matches===true&&p.registryV32?.store?.validateOwner(p.actorOwner)===true&&require('../registry/worker').valid(p)===true&&own?.id===party.id&&own._sessionBound===true&&require('../runtime/party-evidence').observedAt(own,now)!==null&&fresh(p.lastSaveAt,30000,now)&&fresh(p.livePos?.at,10000,now)&&fresh(p.vitals?.at,15000,now)&&p.vitals.hp>=minHp&&!p.livePos.dead&&!/^(tw|dx|gd|dg|pv|p\d)/.test(p.livePos.room||'')&&(!p.goal||['development-side','gear-hunt'].includes(p.goal.kind))&&!(p.page&&p.evalFencedPage===p.page)&&!p.teamControl&&!p.dailyTeamPending&&!p.dailyWorkStatus?.ownsNavigation&&(!p.pendingTravel||p.goal?.legendaryParty?.host===i.machine)&&!p.choresBusy&&!p.survivalRecovery&&!p.recycling&&!p.healthRecovery&&!p.assistanceReservation&&!p.v2?.trial?.active()&&!require('../runtime/team-trade').blocksNavigation(p)&&paymentSafe(p,now)&&!require('../runtime/survival').recentDeaths(p,now).length&&require('../runtime/survival').hpPots(p.lastSave)>=40;})?all:[];
}
function proof(i,g,now=Date.now(),{route=false,wiki=require('../economy').loadWiki(i.root)}={}){
 const deny=reason=>({allowed:false,reason}),all=members(i,now,route?.85:.65),meta=g?.legendaryParty,cat=i.catalog();if(!route&&(!Number.isFinite(g?.partyStartedAt)||now<g.partyStartedAt||now-g.partyStartedAt>=900000))return deny('bounded-party-window-expired');
 if(!meta||!all.includes(i)||meta.host!==i.machine||meta.build!==cat.build||wiki?._source?.verifiedBuild!==cat.build)return deny('same-host-three-fresh-native-party-required');
 const receiver=all.find(p=>p.actorIdentity.actorId===meta.recipient),item=cat.items[meta.itemId],m=cat.world.MONSTERS?.find(m=>m.id===g.monsterId),map=cat.world.MAPS?.find(m=>m.id===g.mapId),sourceMap=wiki?.maps?.maps?.find(m=>m.id===g.mapId);
 if(!receiver||!acquisition.fills(receiver.lastSave,cat,meta.itemId,meta.slot)||!item||!m||m.kind!=='miniboss'||!Number.isFinite(m.atk)||m.atk<=0||!map||map.kind!=='field'||/^(tw|dx|gd|dg|pv|p\d)/.test(map.id)||sourceMap?.kind!=='field'||!sourceMap.monsters?.miniboss?.includes(m.id)||sourceMap.levelMin!==map.levelMin||!wiki?.monsters?.monsters?.some(x=>x.id===m.id&&x.kind===m.kind&&x.level===m.level&&x.dropTable?.some(d=>d.item===item.name&&d.ratePct>0)))return deny('verified-missing-slot-and-native-field-miniboss-required');
 const roles=all.map(p=>cat.world.HIGH_CLASSES?.[p.lastSave.job]?.from||p.lastSave.job);
 if(!roles.some(r=>['knight','dawnwarden'].includes(r))||!roles.some(r=>['priest','lumenoracle'].includes(r)))return deny('native-tank-and-support-required');
 if(!all.every(p=>{const position=p.socialInbox?.bossPositions?.view(m.id,map.id,now);if(!route&&!position)return false;const scale=position?.ak??1,rage=position?.rage?cat.world.BOSS_RAGE?.atk:1;if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(rage)||rage<1)return false;const attack=m.atk*scale*rage,hp=Number.isFinite(p.vitals.currentHp)?p.vitals.currentHp:p.vitals.hp*p.vitals.maxHp;return p.lastSave.lv>=m.level&&Number.isFinite(p.vitals.maxHp)&&p.vitals.maxHp>=attack*4&&Number.isFinite(hp)&&hp>=attack*2&&fresh(p.socialInbox?.last('bossboard')?._receivedAt,30000,now)&&p.socialInbox.last('bossboard').list?.some(b=>b.id===m.id&&b.map===map.id&&b.up&&!b.next);}))return deny('party-level-scaled-HP-and-live-boss-proof-required');
 if(!all.some(p=>(p.lastSave.bestiary?.[m.id]||0)>0))return deny('party-native-kill-history-required');
 if(!route&&!all.every(p=>p.livePos.room===g.mapId&&p.goal?.legendaryParty?.recipient===meta.recipient&&p.goal.legendaryParty.itemId===meta.itemId&&p.goal.monsterId===g.monsterId&&p.managedHuntReady===[cat.build,g.mapId,g.monsterId].join(':')&&[i.livePos.x,i.livePos.z,p.livePos.x,p.livePos.z].every(Number.isFinite)&&Math.hypot(i.livePos.x-p.livePos.x,i.livePos.z-p.livePos.z)<=10))return deny('party-rendezvous-and-exact-native-target-required');
 return {allowed:true,material:'gear:'+meta.itemId,supported:!route,plannedSupport:route,reason:route?'verified-same-host-party-route-only':'verified-same-host-nearby-party-combat'};
}
function candidates(i,wiki,now=Date.now()){
 const all=members(i,now),cat=i.catalog(),out=[];if(all.length!==3||wiki?._source?.verifiedBuild!==cat.build||i.legendaryPartyCooldown>now)return out;
 if(i.goal?.legendaryParty&&Number.isFinite(i.goal.partyStartedAt)&&now-i.goal.partyStartedAt>=900000){i.legendaryPartyCooldown=now+300000;return out;}
 for(const receiver of all){const s=receiver.lastSave,missing=acquisition.gaps(s,cat);if(!missing.length)continue;
  for(const it of Object.values(cat.items)){if(!acquisition.fills(s,cat,it.id))continue;
   const compare=require('../gear-value').compare(s,cat,it.id),sources=(wiki.monsters?.monsters||[]).filter(m=>m.dropTable?.some(d=>d.item===it.name&&d.ratePct>0));
   if(sources.some(m=>m.level<=(m.kind==='normal'?s.lv:s.lv-10)))continue;
   for(const m of sources.filter(m=>m.kind==='miniboss'))for(const map of wiki.maps?.maps||[]){if(!map.monsters?.miniboss?.includes(m.id))continue;
    const g={kind:'gear-hunt',itemId:it.id,slot:compare.slot,mapId:map.id,mapName:map.name,monsterId:m.id,monsterKind:m.kind,firstClear:true,legendaryParty:{host:i.machine,build:cat.build,recipient:receiver.actorIdentity.actorId,itemId:it.id,slot:compare.slot},score:5000,expectedCombatGain:compare.gain,label:'ปาร์ตี้เติม Legendary: '+it.name+' ให้ '+name(receiver),reason:'ทางเดี่ยวไม่ผ่านระดับ · รวมทีมโฮสต์เดียวกันและตรวจซ้ำก่อนสู้',dropRatePct:m.dropTable.find(d=>d.item===it.name).ratePct};
    if(!proof(i,g,now,{route:true,wiki}).allowed)continue;
    const travels=all.map(p=>require('./boss-window').travelBudget(p.livePos.room,map.id,wiki).ms);if(travels.some(ms=>!Number.isFinite(ms)||ms>465000))continue;const travel={ms:Math.max(...travels)};
    const prior=i.goal?.legendaryParty;out.push({...g,partyStartedAt:prior?.itemId===it.id&&prior?.recipient===receiver.actorIdentity.actorId&&i.goal.monsterId===m.id?i.goal.partyStartedAt||now:now,expectedDurationMs:travel.ms+90000,partySourceLevel:m.level});
   }
  }
 }
 // All three independently choose the same recipient/source, not their own ROI.
 out.sort((a,b)=>a.partySourceLevel-b.partySourceLevel||a.legendaryParty.recipient.localeCompare(b.legendaryParty.recipient)||a.itemId.localeCompare(b.itemId)||a.monsterId.localeCompare(b.monsterId));return out.slice(0,1);
}
module.exports={members,proof,candidates};
