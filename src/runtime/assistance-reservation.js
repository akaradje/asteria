'use strict';
const fresh=require('./freshness');
const name=p=>p.character?.name;
function release(i,reason,now=Date.now()){
 const r=i.assistanceReservation;if(!r)return;
 for(const p of r.actors){
  if(p.assistanceReservation!==r)continue;
  p.assistanceReservation=null;
  p.milestoneAssistStatus={...r.assignment,at:now,state:'released',reason,reservation:{startedAt:r.startedAt,expiresAt:r.expiresAt}};
  if(p.campaignGoal?.kind==='milestone-assist'&&p.campaignGoal.recipient===r.assignment.recipient){
   p.campaignGoal=null;
   if(p.goal?.kind==='milestone-assist')p.goal=null;
   if(p.pendingTravel?.reason==='campaign-direct-gates')p.pendingTravel=null;
   p.managedHuntReady=null;p.assistanceReleasePending=true;
  }
 }
}
function state(i,now=Date.now()){
 const r=i.assistanceReservation;if(!r)return null;
 const a=r.assignment,cat=i.catalog(),probe=require('./class-boss-probe');
 const currentPeers=i.teamPeers?.()||[];
 r.actors=r.actors.map(p=>p.remoteMachine?currentPeers.find(q=>q.remoteMachine===p.remoteMachine&&name(q)===name(p)&&q.remoteValidated)||p:p);
 const recipient=r.actors.find(p=>name(p)===a.recipient);
 const stop=reason=>{release(i,reason,now);return null;};
 if(now<r.startedAt||now>=r.expiresAt)return stop('bounded group reservation expired');
 if(!recipient||recipient.lastSave?.job!==r.recipientJob||(recipient.lastSave?.materials?.[a.material]||0)>=r.required)return stop('recipient material or class outcome observed');
 const m=cat.world.MONSTERS?.find(m=>m.id===a.monsterId),map=require('../economy').loadWiki(i.root)?.maps?.maps?.find(m=>m.id===a.mapId);
 if(!m||!map)return stop('verified target source unavailable');
 let waiting=false,board=null;
 for(const p of r.actors){
  const party=p.socialInbox?.last('party');
  if(!p.remoteMachine&&p.assistanceReservation!==r||p.remoteMachine&&!p.remoteValidated||p.status!=='playing'||p.catalog().build!==a.build||p.v2?.sourceCoherence?.matches!==true||!party?.id||party.id!==a.partyId||party._sessionBound!==true||p.livePos?.dead||p.teamControl||p.dailyTeamPending||p.dailyWorkStatus?.ownsNavigation||p.survivalRecovery||p.recycling||p.choresBusy||p.v2?.trial?.active()||!p.remoteMachine&&p.pendingTravel&&p.campaignGoal?.kind!=='milestone-assist'||require('./team-trade').blocksNavigation(p,now)||require('./equipment-headroom').developmentBlocks(p)||require('./equipment-headroom').journalBlocks(p)||require('./survival').recentDeaths(p,now).length)return stop('protected owner, party, source or survival changed');
  if(p.remoteMachine){
   const ack=p.remoteAssistance;
   if(ack&&ack.expiresAt>now&&ack.key!==a.key)return stop('remote participant reserved by another group');
   if(!ack||ack.key!==a.key||ack.expiresAt<=now)waiting=true;
  }
  if(Number.isFinite(p.vitals?.hp)&&p.vitals.hp<.35||require('./survival').hpPots(p.lastSave)<40)return stop('actual HP or supplies below reservation minimum');
  const b=p.socialInbox?.last('bossboard');
  // A room-local board can report down/next=0 while another participant
  // still has the actual future server round. Missing timing is not a new
  // round: use the newest actionable observation, or pause without combat.
  const row=b?.list?.find(row=>row.id===a.monsterId&&row.map===a.mapId);
  if(fresh.fresh(b?._receivedAt,30000,now)&&Number.isFinite(b.now)&&row&&(row.up&&!row.next||Number.isFinite(row.next)&&row.next>b.now)&&(!board||b._receivedAt>board._receivedAt))board=b;
  const current=fresh.decisionGate(p,now).allowed&&fresh.fresh(p.vitals?.at,15000,now)&&fresh.fresh(p.livePos?.at,10000,now)&&require('./party-evidence').observedAt(party,now)!==null;
  if(!current){waiting=true;continue;}
  const pos=p.socialInbox?.bossPositions?.view(m.id,map.id,now),atk=m.atk*(pos?.ak||1)*(pos?.rage?(cat.world.BOSS_RAGE?.atk||1.5):1);
  if(!require('./milestone-assistance').ready(p,i,m,map,atk,now,true))return stop('actual participant readiness changed');
 }
 const b=board?.list?.find(b=>b.id===a.monsterId&&b.map===a.mapId);
 if(!board)waiting=true;
 else if(!b)return stop('target absent from current server board');
 else if(!(b.up&&!b.next)){
  const next=Number.isFinite(b.next)&&b.next>board.now?b.next+board._receivedAt-board.now:null;
  // Receipt latency differs across hosts. Only the original server round
  // identifies a changed spawn; translated local countdowns are estimates.
  const changed=Number.isFinite(a.serverSpawnAt)?b.next!==a.serverSpawnAt:!a.spawnAt||Math.abs(next-a.spawnAt)>5000;
  if(!next||changed)return stop('server boss round changed');
 }
 if(waiting&&now-r.lastFreshAt>=45000)return stop('group evidence did not recover within 45 seconds');
 if(!waiting)r.lastFreshAt=now;
 return {assignment:{...a,alive:!!(b?.up&&!b.next),due:true},waiting,reservation:{startedAt:r.startedAt,expiresAt:r.expiresAt,lastFreshAt:r.lastFreshAt}};
}
function tradeReserved(i,a,now=Date.now()){
 const q=i.teamTradeIntent;
 if(!q?.offer||q.build!==a.build||!a.participants?.some(n=>[q.offer.donor,q.offer.receiver].includes(n)))return false;
 if(['GATHERING','SESSION'].includes(q.phase))return fresh.fresh(q.at,20000,now)&&Number.isFinite(q.deadline)&&now<q.deadline;
 // Preserve the coordinator's bounded replan window for verified class cash.
 // A new boss trip must not consume this window before the next cash intent.
 return q.phase==='CANCELLED'&&q.offer.receiver===a.recipient&&q.offer.kind==='currency'&&q.offer.classFunding?.build===a.build&&require('../planning/team-copper').validClassFunding(q.offer.classFunding,now)&&fresh.fresh(q.finishedAt,125000,now);
}
function acquire(i,a,now=Date.now()){
 if(!a?.due)return null;
 if(tradeReserved(i,a,now))return null;
 const peers=[...new Set([i,...(i.teamPeers?.()||[])])],actors=a.participants.map(n=>peers.find(p=>(!p.remoteMachine||p.remoteValidated)&&name(p)===n));
 if(actors.some(p=>!p)||actors.some(p=>!p.remoteMachine&&state(p,now)||p.remoteMachine&&p.remoteAssistance?.expiresAt>now&&p.remoteAssistance.key!==a.key))return null;
 const recipient=actors.find(p=>name(p)===a.recipient),required=require('./class-boss-probe').milestone(recipient)?.needs?.[a.material];
 if(!Number.isInteger(required)||required<=0)return null;
 const duration=Math.min(900000,Math.max(180000,a.travelMs+120000+Math.max(0,(a.spawnAt||now)-now)));
 const r={assignment:{...a},actors,recipientJob:recipient.lastSave.job,required,startedAt:now,lastFreshAt:now,expiresAt:now+duration};
 for(const p of actors){if(p.remoteMachine)continue;p.assistanceReservation=r;p.goal=p.campaignGoal={kind:'milestone-assist',firstClear:true,campaign:true,...a,monster:a.monsterId,nextAt:a.spawnAt,label:'ช่วย '+a.recipient+' หา '+a.material};p.huntMap=a.mapId;p.teamGoal=null;}
 return state(i,now);
}
function intent(i,now=Date.now(),monster=null,map=null){
 const r=state(i,now);if(r)return !r.waiting&&(!monster||r.assignment.monsterId===monster)&&(!map||r.assignment.mapId===map)?r.assignment:null;
 return require('./milestone-assistance').plan(i,now,monster,map);
}
async function refresh(i){
 if(!i.assistanceReservation||!state(i))return;
 // A long native gate walk suspends the ordinary tick. Renew facts, never
 // their timestamps: only an actual HUD read and server response count.
 if(!fresh.fresh(i.vitals?.at,8000)&&typeof i.screen==='function'&&i.canDo?.('assistanceHealthRead',5000)){
  const screen=await i.screen();i.vitals=require('../team-readiness').vitals(screen);
  if(screen.death){release(i,'native death observed during route');return;}
 }
 if(i.assistanceReservation)await require('./boss-feed').poll(i,{waitMs:1200});
}
module.exports={acquire,state,intent,release,refresh,tradeReserved};
