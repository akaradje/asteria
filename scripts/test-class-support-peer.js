'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const peer=require('../src/runtime/class-support-peer'),reservations=require('../src/runtime/assistance-reservation'),assist=require('../src/runtime/milestone-assistance'),probe=require('../src/runtime/class-boss-probe'),economy=require('../src/economy');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-class-peer-')),oldWiki=economy.loadWiki;
try{
 let now=Date.now();const boss={id:'boss',kind:'boss',level:90,atk:1000,dropTable:[{itemName:'Abyss Crystal',rate:100}]},map={id:'d4',bossRoom:true,kind:'dungeon'};
 const cat={build:'b1',world:{MAX_LV:120,ASCEND:{coins:100000,items:{'Abyss Crystal':1}},MONSTERS:[boss],HIGH_CLASSES:{dragonknight:{from:'dawnwarden'},inquisitor:{from:'lumenoracle'}},bagCap:()=>48},items:{gear:{slot:'weapon'}}};
 economy.loadWiki=()=>({maps:{maps:[map]},monsters:{monsters:[boss]}});
 const make=(name,job,hp,phase)=>({root,character:{name},status:'playing',lastSaveAt:now,lastSave:{job,lv:120,coins:300000,potions:100,bag:[],bagTier:0,equip:{weapon:'gear',head:'gear',armor:'gear',boots:'gear'},materials:{},bestiary:{}},livePos:{room:'d4',x:0,z:0,at:now},vitals:{hp:1,maxHp:hp,currentHp:hp,at:now},catalog:()=>cat,v2:{sourceCoherence:{matches:true},observations:{sessionId:'session-'+name}},endgameCampaign:{phase,missing:phase==='class'?[{name:'Abyss Crystal',want:1,have:0}]:[]},brain:{data:{deaths:{}}},socialInbox:{last:k=>k==='party'?{id:1,_sessionBound:true,_receivedAt:now,_streamAt:now}:k==='bossboard'?{now,_receivedAt:now,list:[{id:'boss',map:'d4',up:true}]}:null,bossPositions:{view:()=>({at:now,x:0,z:0})}}});
 const tank=make('Tank','dragonknight',12000,'complete'),heal=make('Heal','inquisitor',8000,'complete'),recipient=make('Recipient','galehunter',3000,'class');
 function remote(i){const m={charName:i.character.name,status:i.status,job:i.lastSave.job,lv:i.lastSave.lv,lastSaveAt:i.lastSaveAt,livePos:i.livePos,runtimeGeneration:i.v2.observations.sessionId,classSupport:peer.project(i,now)};return {...peer.wrap(m,{build:'b1',at:now},recipient,now),remoteMachine:'tum'};}
 const nativeRemoteTank=remote(tank);assert(nativeRemoteTank.remoteValidated);assert.equal(nativeRemoteTank.vitals.maxHp,12000);assert(!JSON.stringify(peer.project(tank,now)).includes('credentials'));
 const frame={charName:'Tank',status:'playing',lastSaveAt:now,livePos:tank.livePos,runtimeGeneration:tank.v2.observations.sessionId,classSupport:peer.project(tank,now)};
 assert.equal(peer.wrap(frame,{build:'old',at:now},recipient,now),null);assert.equal(peer.wrap({...frame,runtimeGeneration:'new-session'},{build:'b1',at:now},recipient,now),null);assert.equal(peer.wrap(frame,{build:'b1',at:now-16000},recipient,now),null);
 let views=[remote(tank),remote(heal)];recipient.teamPeers=()=>[recipient,...views];
 const assignment=assist.plan(recipient,now);assert(assignment?.due);assert.equal(assignment.recipient,'Recipient');assert.deepEqual(new Set(assignment.participants),new Set(['Tank','Heal','Recipient']));
 const held=reservations.acquire(recipient,assignment,now);assert(held?.waiting,'fresh telemetry alone cannot acknowledge a reservation');assert(!tank.assistanceReservation&&!heal.assistanceReservation,'only local native actors are mutated');assert(!probe.support(recipient,{mapId:'d4',monsterId:'boss'},now),'unacknowledged remote support never permits combat');
 for(const p of [tank,heal]){p.assistanceReservation={assignment,expiresAt:now+60000};p.goal={kind:'milestone-assist',recipient:'Recipient',monsterId:'boss',mapId:'d4'};p.managedHuntReady='b1:d4:boss';}
 recipient.managedHuntReady='b1:d4:boss';views=[remote(tank),remote(heal)];assert.equal(reservations.state(recipient,now).waiting,false,'matching independently published remote acknowledgments release rendezvous');assert(probe.support(recipient,{mapId:'d4',monsterId:'boss'},now));
 views[0].managedHuntReady=null;assert(!probe.support(recipient,{mapId:'d4',monsterId:'boss'},now),'native selected target required even after acknowledgment');views=[remote(tank),remote(heal)];views[0].livePos={...views[0].livePos,x:20};assert(!probe.support(recipient,{mapId:'d4',monsterId:'boss'},now),'cross-host support requires observed physical range');
 views=[remote(tank),remote(heal)];views[0].remoteAssistance={key:'other-group',expiresAt:now+60000};assert.equal(reservations.state(recipient,now),null,'another remote group releases the local reservation');assert(!recipient.assistanceReservation);
 for(const p of [tank,heal])p.assistanceReservation=null;
 const nativeRound=now+60000;
 for(const [p,delay]of [[recipient,37],[tank,113]]){const last=p.socialInbox.last;p.socialInbox.last=k=>k==='bossboard'?{now:now-delay,_receivedAt:now,list:[{id:'boss',map:'d4',up:false,next:nativeRound}]}:last(k);}
 views=[remote(tank),remote(heal)];tank.teamPeers=()=>[tank,remote(heal),remote(recipient)];
 const recipientPlan=assist.plan(recipient,now),tankPlan=assist.plan(tank,now);
 assert(recipientPlan&&tankPlan);assert.notEqual(recipientPlan.spawnAt,tankPlan.spawnAt,'independent receipt delays translate countdowns differently');
 assert.equal(recipientPlan.key,tankPlan.key,'one native server round must yield one cross-host reservation key');
 assert.equal(recipientPlan.key.split(':').at(-1),String(nativeRound));
 const frozen=remote(tank);now+=46000;views=[frozen,remote(heal)];assert(!assist.plan(recipient,now),'stale data cannot turn into fresh remote permissions');
 console.log('PASS native cross-host projection, build/session/freshness guards, local-only reservation mutation, remote acknowledgment, selected target/range and conflicting/stale support rejection');
}finally{economy.loadWiki=oldWiki;fs.rmSync(root,{recursive:true,force:true});}
