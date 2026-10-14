'use strict';
const fresh=require('./freshness');
function name(p){return p.character?.name;}
function blocked(p,m,now){
 const probe=require('./class-boss-probe');
 probe.history(p);
 return p.classBossProbeStorageBlocked||p.classBossProbes.some(r=>r.monsterId===m.id&&r.cooldownUntil>now&&!(r===p.classBossProbeActive&&r.status==='running'&&r.build===p.catalog().build&&r.deadline>now&&p.goal?.kind==='milestone-assist'&&p.goal.monsterId===m.id));
}
function ready(p,i,m,map,atk,now,reserved=false,forSupply=false){
 const s=p.lastSave||{},party=p.socialInbox?.last('party'),own=i.socialInbox?.last('party'),cat=p.catalog?.();
 const role=cat?.world.HIGH_CLASSES?.[s.job]?.from||s.job;
 if(p.remoteMachine&&!p.remoteValidated||p.status!=='playing'||!name(p)||!cat||cat.build!==i.catalog().build||p.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(p,now).allowed||!fresh.fresh(p.vitals?.at,15000,now)||!fresh.fresh(p.livePos?.at,10000,now)||![p.livePos.x,p.livePos.z].every(Number.isFinite)||!party?.id||party.id!==own?.id||party._sessionBound!==true||require('./party-evidence').observedAt(party,now)===null)return false;
 // Preparation discovery never grants navigation. A new group starts with80;
 // the actual held group keeps its existing40 combat reserve.
 const minimum=forSupply?0:reserved?40:80;
 if(!Number.isFinite(p.vitals.hp)||p.vitals.hp<.35||!Number.isFinite(p.vitals.maxHp)||p.vitals.maxHp<atk*2||s.lv<m.level+(cat.world.ASTRAL?.bossIds?.includes(m.id)?0:10)||p.livePos.dead||require('./room-policy').roomPolicy(p.livePos.room).dungeon||require('./room-policy').isGuildHall(p.livePos.room)||p.teamControl||p.dailyTeamPending||p.dailyWorkStatus?.ownsNavigation||p.survivalRecovery||p.recycling||p.choresBusy||p.v2?.trial?.active()||!forSupply&&p.pendingTravel&&p.campaignGoal?.kind!=='milestone-assist'||require('./team-trade').blocksNavigation(p,now)||require('./equipment-headroom').developmentBlocks(p)||require('./equipment-headroom').journalBlocks(p)||!forSupply&&require('./survival').recentDeaths(p,now).length||require('./survival').hpPots(s)<minimum||blocked(p,m,now))return false;
 const cap=cat.world.bagCap?.(s.bagTier);
 if(!Array.isArray(s.bag)||!Number.isFinite(cap)||cap-s.bag.length<2||['weapon','head','armor','boots'].some(k=>!cat.items[s.equip?.[k]]))return false;
 const reserve=require('./class-boss-probe').assistanceReserve(p);
 // Stock/cash discovery identifies the preparation deficit, without granting
 // a reservation, route or combat. Actual departure still checks the reserve.
 if(!Number.isFinite(s.coins)||s.coins<0||!forSupply&&s.coins<reserve+10000||!['class','wing','complete'].includes(p.endgameCampaign?.phase)||!reserved&&p.endgameCampaign.ready&&p.endgameCampaign.phase!=='complete')return false;
 // An imminent unrelated commitment retains its navigation owner.
 if(!reserved&&p.classBossProbeActive?.status==='running'&&p.classBossProbeActive.monsterId!==m.id)return false;
 return {role};
}
function plan(i,now=Date.now(),onlyMonster=null,onlyMap=null,{forSupply=false}={}){
 const probe=require('./class-boss-probe'),cat=i.catalog(),party=i.socialInbox?.last('party'),board=i.socialInbox?.last('bossboard');
 if(!party?.id||party._sessionBound!==true||require('./party-evidence').observedAt(party,now)===null||!fresh.fresh(board?._receivedAt,30000,now)||!Number.isFinite(board.now))return null;
 const wiki=require('../economy').loadWiki(i.root);
 const peers=[...new Set([i,...(i.teamPeers?.()||[])])].filter(p=>(!p.remoteMachine||p.remoteValidated)&&typeof p.catalog==='function');
 const costs=new Map(peers.map(p=>[p,require('../planning/boss-window').makeTravelBudget(wiki,require('./route-travel').view(p,p.campaignRoutes,now),{root:p.root,build:cat.build,now})]));
 const candidates=[];
 for(const b of board.list||[]){
  if(onlyMonster&&b.id!==onlyMonster||onlyMap&&b.map!==onlyMap)continue;
  const m=cat.world.MONSTERS?.find(m=>m.id===b.id),map=wiki?.maps?.maps?.find(m=>m.id===b.map);
  if(m?.kind!=='boss'||!map?.bossRoom||/^(pv|p\d|tw|dx|gd)/.test(map.id)||!(b.up&&!b.next||Number.isFinite(b.next)&&b.next>board.now))continue;
  const pos=i.socialInbox?.bossPositions?.view(m.id,map.id,now),atk=m.atk*(pos?.ak||1)*(pos?.rage?(cat.world.BOSS_RAGE?.atk||1.5):1);
  if(!Number.isFinite(atk)||atk<=0)continue;
  const available=peers.map(p=>({p,readiness:ready(p,i,m,map,atk,now,false,forSupply)})).filter(r=>r.readiness).sort((a,b)=>name(a.p).localeCompare(name(b.p)));
  const tank=available.find(r=>['knight','dawnwarden'].includes(r.readiness.role))?.p,heal=available.find(r=>['priest','lumenoracle'].includes(r.readiness.role))?.p;
  if(!tank||!heal||tank===heal)continue;
  for(const {p} of available){
   const astral=require('../planning/astral-path').bossNeed(p,now);
   if((!astral&&p.endgameCampaign?.phase!=='class')||!astral&&p.vitals.maxHp>=atk*4||forSupply&&require('./survival').recentDeaths(p,now).length)continue;
   const required=probe.milestone(p),need=Object.entries(required?.needs||{}).find(([key,n])=>key!=='Copper'&&Number.isInteger(n)&&n>0&&(p.lastSave.materials?.[key]||0)<n&&(required.astral?required.missing:p.endgameCampaign.missing)?.some(r=>r.name===key)&&m.dropTable?.some(d=>d.itemName===key&&d.rate>0));
   if(!need)continue;
   const actors=[...new Set([tank,heal,p])];if(astral&&actors.length<3){const extra=available.find(r=>!actors.includes(r.p))?.p;if(extra)actors.push(extra);}if(astral&&actors.length<3)continue;
   const travelMs=Math.max(...actors.map(a=>costs.get(a)(a.livePos.room,map.id).ms));if(!Number.isFinite(travelMs))continue;
   const alive=!!(b.up&&!b.next),spawnAt=alive?null:b.next+board._receivedAt-board.now;
   // Fresh server presence permits rendezvous along a verified gate route.
   // Requiring everyone to be here before assigning navigation deadlocks
   // helpers on a persistent live boss. Arrival still grants no combat:
   // tick/gather/probe recheck presence, all participants and native targets.
   // Group identity uses the actual server round. Each client's translated
   // countdown includes its own receipt delay and must not become an ack key.
   candidates.push({astral:!!astral,key:[cat.build,party.id,m.id,map.id,name(p),alive?'live':b.next].join(':'),build:cat.build,partyId:party.id,monsterId:m.id,mapId:map.id,material:need[0],recipient:name(p),participants:actors.map(name),alive,serverSpawnAt:alive?null:b.next,spawnAt,boardAt:board._receivedAt,travelMs,departAt:alive?now:spawnAt-90000-travelMs,due:alive||now>=spawnAt-90000-travelMs,reason:astral?'ช่วยเก็บคอร์ทะลุขีดดาว · ยืนยันทีมและของจริง ไม่ถือว่ารับรองดาเมจ 5%':'ช่วยเพื่อนเก็บวัตถุดิบคลาส · ต้องยืนยันแทงก์–ฮีลมาถึงและของเข้ากระเป๋าจริง'});
  }
 }
 candidates.sort((a,b)=>Number(b.alive)-Number(a.alive)||(a.spawnAt||now)-(b.spawnAt||now)||a.recipient.localeCompare(b.recipient));
 const selected=candidates[0];return selected?.participants.includes(name(i))?selected:null;
}
function approach(i,a){
 if(!a.alive&&(!Number.isFinite(a.spawnAt)||a.spawnAt<=Date.now()))return null;
 const wiki=require('../economy').loadWiki(i.root),maps=wiki?.maps?.maps||[];
 const graph=require('./native-gates').graphForBuild(i.root,i.catalog().build,maps),previous=graph.links?.[a.mapId]?.prev;
 const map=maps.find(m=>m.id===previous);
 const native=i.catalog().world.MAPS?.find(m=>m.id===previous);
 const openWorld=map?.kind==='field'||map?.kind==='dungeon'&&native?.kind==='dungeon'&&native.bossRoom===false;
 if(!map||!openWorld||map.bossRoom||require('./room-policy').roomPolicy(previous).dungeon||require('./room-policy').isGuildHall(previous)||/^(pv|p\d)/.test(previous))return null;
 if(a.alive&&entryReady(i,a,previous,graph))return {mapId:a.mapId,staging:false};
 return {mapId:previous,staging:true};
}
function entryReady(i,a,staging,graph,now=Date.now()){
 const held=require('./assistance-reservation').state(i,now),gate=graph.fieldGates?.next,point=gate&&require('./gate-walk').retreat(gate,staging);
 if(!held||held.waiting||held.assignment.key!==a.key||!point||!Array.isArray(a.participants)||a.participants.length<3)return false;
 const peers=[...new Set([i,...(i.teamPeers?.()||[])])],actors=a.participants.map(n=>peers.find(p=>name(p)===n));
 return actors.every(p=>{
  if(!p||p.status!=='playing'||p.remoteMachine&&!p.remoteValidated||p.catalog?.().build!==a.build||p.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(p,now).allowed||!fresh.fresh(p.vitals?.at,15000,now)||!fresh.fresh(p.livePos?.at,10000,now)||p.livePos.dead||require('./survival').hpPots(p.lastSave)<43)return false;
  const party=p.socialInbox?.last('party'),lease=p.remoteMachine?p.remoteAssistance:{key:p.assistanceReservation?.assignment?.key,expiresAt:p.assistanceReservation?.expiresAt};
  if(party?.id!==a.partyId||party._sessionBound!==true||require('./party-evidence').observedAt(party,now)===null||lease?.key!==a.key||lease.expiresAt<=now)return false;
  if(p.livePos.room===a.mapId)return p.vitals.hp>=.65;
  return p.livePos.room===staging&&p.vitals.hp>=.85&&[p.livePos.x,p.livePos.z].every(Number.isFinite)&&Math.hypot(p.livePos.x-point.x,p.livePos.z-point.z)<=3;
 });
}
async function stagingGather(i,a,route){
 const now=Date.now(),held=require('./assistance-reservation').state(i,now);
 if(!held||held.waiting||held.assignment.key!==a.key||i.livePos?.room!==route.mapId||!fresh.fresh(i.livePos.at,6000,now))return null;
 const maps=require('../economy').loadWiki(i.root)?.maps?.maps||[],graph=require('./native-gates').graphForBuild(i.root,i.catalog().build,maps);
 if(graph.links?.[route.mapId]?.next!==a.mapId)return null;
 const gate=graph.fieldGates?.next;if(!gate||![gate.x,gate.z].every(Number.isFinite))return null;
 const point=require('./gate-walk').retreat(gate,route.mapId);if(!point||Math.hypot(i.livePos.x-point.x,i.livePos.z-point.z)<=1.5)return null;
 if(!i.canDo('milestoneStageGather',20000))return 'class assistance: staging approach cooldown';
 const options={room:route.mapId,timeoutMs:30000,tolerance:1.5,abort:async()=>!require('./assistance-reservation').intent(i)?.due||i.livePos?.room!==route.mapId||!await require('./assistance-transit').check(i,a.key)};
 let r=await require('./town-map-walk').walk(i,point.x,point.z,options);
 if(!r&&typeof i.walkTo==='function')r=await i.walkTo(point.x,point.z,options);
 if(r?.reason==='aborted')await require('./town-map-walk').cancel(i);
 const arrived=fresh.fresh(i.livePos?.at,6000)&&i.livePos.room===route.mapId&&Math.hypot(i.livePos.x-point.x,i.livePos.z-point.z)<=2;
 i.milestoneAssistStatus={...i.milestoneAssistStatus,stagingApproach:{at:Date.now(),x:point.x,z:point.z,arrived,evidence:'reviewed_native_next_gate_inward_point; native arrival required'}};
 return 'class assistance: staging group approach '+(arrived?'native arrival observed':'unconfirmed');
}
async function tick(i,screen){
 await refreshSupportBoard(i);
 const reservations=require('./assistance-reservation');
 if(screen.death){reservations.release(i,'native death observed');return null;}
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.recycling||i.choresBusy||i.survivalRecovery||i.v2?.trial?.active()||require('./team-trade').blocksNavigation(i))return null;
 await reservations.refresh(i);
 let held=reservations.state(i);
 if(i.assistanceReleasePending){await i.expeditionAuto(false);i.assistanceReleasePending=false;return 'class assistance: prior reservation released';}
 if(!held){const planned=plan(i);if(planned?.due)held=reservations.acquire(i,planned);}
 if(held?.waiting||held&&screen.panelOpen){await i.expeditionAuto(false);i.milestoneAssistStatus={...held.assignment,at:Date.now(),state:'paused-for-evidence',reason:screen.panelOpen?'waiting for existing native panel to close':'waiting for fresh group evidence; optional maintenance deferred',reservation:held.reservation};return 'class assistance: reserved; awaiting fresh group evidence';}
 if(screen.panelOpen)return null;
 const a=held?.assignment||plan(i);i.milestoneAssistStatus=a?{...a,at:Date.now(),state:a.due?'rendezvous':'scheduled',reservation:held?.reservation}:null;
 if(a?.due&&!held)return 'class assistance: awaiting local group reservation; no navigation or combat';
 if(!a?.due){if(i.campaignGoal?.kind==='milestone-assist'){await i.expeditionAuto(false);i.campaignGoal=null;i.pendingTravel=null;i.goal=null;i.huntMap=null;i.managedHuntReady=null;}return null;}
 const g={kind:'milestone-assist',firstClear:true,campaign:true,...a,monster:a.monsterId,nextAt:a.spawnAt,label:'ช่วย '+a.recipient+' หา '+a.material};
 i.campaignGoal=g;i.goal=g;i.huntMap=g.mapId;i.teamGoal=null;
 const route=approach(i,a);
 if(i.livePos.room===g.mapId&&route?.staging){
  await i.expeditionAuto(false);
  if(!i.pendingTravel&&i.canDo('milestoneEarlyEntryRetreat',15000))return await require('./campaign-route').travel(i,{...g,mapId:route.mapId});
  return 'class assistance: retreat to staging until all native participants arrive';
 }
 if(i.livePos.room!==g.mapId){
  await i.expeditionAuto(false);
  if(!route)return 'class assistance: waiting for verified server spawn or staging route';
  if(route.staging&&i.livePos.room===route.mapId){const gathering=await stagingGather(i,a,route);if(gathering)return gathering;await require('./class-boss-probe').prepare(i,g,{stagingRoom:route.mapId});return 'class assistance: waiting outside boss room for confirmed server spawn';}
  if(!i.pendingTravel&&i.canDo('milestoneAssistRoute',15000))return await require('./campaign-route').travel(i,{...g,mapId:route.mapId});
  return 'class assistance: rendezvous route pending';
 }
 if(!i.canDo('milestoneAssistTarget',2000))return 'class assistance: awaiting partner/target';
 const selected=await require('./main-quest').selectTarget(i,g);if(!selected){await i.expeditionAuto(false);return 'class assistance: native target unavailable';}
 const probe=require('./class-boss-probe');await i.expeditionAuto(false);
 if(!a.alive){await probe.stage(i,g);await probe.prepare(i,g);if(a.spawnAt-Date.now()>15000||!await require('./boss-feed').awaitSpawn(i,g))return 'class assistance: awaiting server spawn';}
 // Live arrival can damage helpers as well as the recipient. Heal through
 // the native slot before allowing the group to start; a scheduled-only
 // preparation misses damage taken while approaching the actual spawn.
 else await probe.prepare(i,g);
 const gathered=await gather(i,g);if(gathered)return gathered;
 const result=await probe.run(i,g);i.milestoneAssistStatus={...a,at:Date.now(),state:result.ok?'clear-observed':'waiting-or-withdrawn',result};
 return 'class assistance: '+result.reason;
}
async function gather(i,g,now=Date.now()){
 const position=i.socialInbox?.bossPositions?.view(g.monsterId,g.mapId,now);
 if(!position||!fresh.fresh(position.at,10000,now)||![position.x,position.z].every(Number.isFinite))return 'class assistance: awaiting actual server boss position';
 const peers=[...new Set([i,...(i.teamPeers?.()||[])])].filter(p=>(!p.remoteMachine||p.remoteValidated)&&g.participants.includes(name(p)));
 const near=p=>fresh.fresh(p?.livePos?.at,p.remoteValidated?10000:6000,now)&&p.livePos.room===g.mapId&&[p.livePos.x,p.livePos.z].every(Number.isFinite)&&Math.hypot(p.livePos.x-position.x,p.livePos.z-position.z)<=5;
 const role=p=>p.catalog().world.HIGH_CLASSES?.[p.lastSave.job]?.from||p.lastSave.job;
 const tank=peers.find(p=>['knight','dawnwarden'].includes(role(p))),heal=peers.find(p=>['priest','lumenoracle'].includes(role(p)));
 // Tank approaches first, then healer, then the weaker recipient. No AUTO
 // permission is borrowed from a partner standing at the map entrance.
 if(i!==tank&&!near(tank)||i!==tank&&i!==heal&&!near(heal))return 'class assistance: waiting for tank/healer at confirmed boss position';
 if(!near(i)){
  if(typeof i.walkTo!=='function'||!i.canDo('milestoneAssistGather',10000))return 'class assistance: awaiting verified group approach';
  const r=await i.walkTo(position.x,position.z,{timeoutMs:15000,tolerance:3,abort:async()=>!require('./assistance-reservation').intent(i)?.due||i.livePos?.dead||i.teamControl||i.survivalRecovery||i.livePos?.room!==g.mapId||!i.socialInbox?.bossPositions?.view(g.monsterId,g.mapId)});
  i.milestoneAssistStatus={...i.milestoneAssistStatus,approach:{at:Date.now(),observedAt:position.at,arrived:r?.ok===true}};
  return 'class assistance: group approach '+(r?.ok?'arrival observed':'unconfirmed');
 }
 if(!tank||!heal||!near(tank)||!near(heal))return 'class assistance: awaiting nearby tank and healer';
 if(peers.length!==g.participants.length||!peers.every(p=>near(p)&&p.managedHuntReady===[g.build,g.mapId,g.monsterId].join(':')))return 'class assistance: awaiting every participant and confirmed native target';
 if(!peers.every(p=>fresh.fresh(p.vitals?.at,15000,now)&&p.vitals.hp>=(p.classBossProbeActive?.status==='running'? .65 : .85)))return 'class assistance: waiting for observed group HP before combat';
 return null;
}
// Completed helpers leave the personal campaign before its board poll. Keep
// the native read alive only for a fresh same-party mandatory class deficit.
async function refreshSupportBoard(i,now=Date.now()){
 const party=i.socialInbox?.last('party'),cat=i.catalog?.();
 if(!cat||i.status!=='playing'||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed||!party?.id||party._sessionBound!==true||require('./party-evidence').observedAt(party,now)===null)return null;
 const priority=require('./promotion-priority'),own=priority.target(i),role=cat.world.HIGH_CLASSES?.[i.lastSave?.job]?.from||i.lastSave?.job;
 const helper=['knight','dawnwarden','priest','lumenoracle'].includes(role);
 const deficit=p=>priority.target(p)?.missing.some(([item])=>(cat.world.MONSTERS||[]).some(m=>m.kind==='boss'&&m.dropTable?.some(d=>d.itemName===item&&d.rate>0)));
 let needed=own&&deficit(i)||require('../planning/astral-path').bossNeed(i,now);
 if(!needed&&helper)needed=(i.teamPeers?.()||[]).some(p=>!p.remoteMachine&&typeof p.catalog==='function'&&require('../planning/astral-path').bossNeed(p,now));
 if(!needed&&helper)needed=(i.teamPeers?.()||[]).some(p=>{
  if(p===i||p.remoteMachine&&!p.remoteValidated||typeof p.catalog!=='function'||p.catalog().build!==cat.build||p.status!=='playing'||p.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(p,now).allowed)return false;
  const other=p.socialInbox?.last('party');return other?.id===party.id&&other._sessionBound===true&&require('./party-evidence').observedAt(other,now)!==null&&deficit(p);
 });
 if(!needed)return null;
 return require('./boss-feed').poll(i,{waitMs:1200});
}
function supplyIntent(i,now=Date.now()){return plan(i,now,null,null,{forSupply:true});}
function preparationHold(i,now=Date.now()){
 const p=i.milestonePreparationStatus,party=i.socialInbox?.last('party'),board=i.socialInbox?.last('bossboard');
 if(!p?.key||p.expiresAt<=now||!fresh.fresh(p.lastIntentAt||p.at,45000,now)||p.build!==i.catalog().build||p.partyId!==party?.id||party._sessionBound!==true||require('./party-evidence').observedAt(party,now)===null||i.livePos?.dead||i.v2?.sourceCoherence?.matches!==true)return false;
 if(fresh.fresh(board?._receivedAt,30000,now)){
  const row=board.list?.find(b=>b.id===p.monsterId&&b.map===p.mapId);
  if(!row||p.alive&&!(row.up&&!row.next)||!p.alive&&row.next!==Number(p.key.split(':').at(-1)))return false;
 }
 return true;
}
async function prepareTick(i,screen,now=Date.now()){
 await refreshSupportBoard(i,now);now=Date.now();
 const a=supplyIntent(i,now);if(!a?.due){
  if(preparationHold(i,now)&&fresh.decisionGate(i,now).allowed&&!require('./team-trade').blocksNavigation(i,now)&&!i.teamControl&&!i.choresBusy&&!i.survivalRecovery){
   await i.expeditionAuto(false);i.milestonePreparationStatus={...i.milestonePreparationStatus,state:'waiting-for-fresh-team',lastIntentAt:i.milestonePreparationStatus.lastIntentAt||i.milestonePreparationStatus.at,at:now,reason:'รอข้อมูลทีมสดไม่เกิน45วินาที · ไม่คืนงานหลักให้งานคั่นระหว่างข้อมูลขาดช่วง'};
   return 'class preparation: bounded fresh-team wait; no boss navigation';
  }
  i.milestonePreparationStatus=null;return null;
 }
 const prior=i.milestonePreparationStatus;
 if(prior?.key===a.key&&prior.cooldownUntil>now)return null;
 const startedAt=prior?.key===a.key&&!prior.cooldownUntil?prior.startedAt:now;
 if(now-startedAt>=900000){i.milestonePreparationStatus={key:a.key,startedAt,at:now,state:'blocked',reason:'bounded preparation expired; recheck after 60 seconds',cooldownUntil:now+60000};return null;}
 i.milestonePreparationStatus={...a,startedAt,at:now,lastIntentAt:now,state:'preparing',expiresAt:startedAt+900000};
 // Preparation grants town/supply ownership only; no boss movement or combat.
 if(i.pendingTravel)return 'class preparation: awaiting existing owned route completion';
 const supply={minimum:80,target:80,reserve:require('./class-boss-probe').assistanceReserve(i),requiredCopper:require('./class-boss-probe').assistanceReserve(i)+10000,reason:'same-party-mandatory-preparation'};
 // A funded actor cannot reach the stock target while its previous field
 // AUTO keeps consuming potions behind preparation. Cash-deficient actors
 // still run the measured safe-income branch in survival below.
 if(i.lastSave.coins>=supply.requiredCopper)await i.expeditionAuto(false);
 const action=await require('./survival').tick(i,screen,{supply});if(action)return action;
 if(i.survivalStatus?.milestoneIncome)return 'class preparation: measured safe income; optional maintenance deferred';
 if(require('./survival').hpPots(i.lastSave)<80||i.lastSave.coins<supply.requiredCopper)return 'class preparation: awaiting verified supplies and reserve';
 if(plan(i)?.due)return tick(i,screen);
 await i.expeditionAuto(false);
 i.goal={kind:'milestone-supply',mapId:'town',label:'พร้อมแล้ว รอทีมเตรียมคลาส '+a.recipient,reason:'ยาและเงินตัวเองครบ · พักงานคั่นเพื่อรักษาเสบียงจนแทงก์ ฮีล และผู้รับพร้อมจริง'};
 i.huntMap='town';i.teamGoal=null;i.milestonePreparationStatus.state='ready-waiting-for-group';
 if(i.livePos?.room!=='town'&&i.canDo('classPreparationTown',45000))await i.returnToTown();
 return 'class preparation: ready; retain supplies while partners prepare';
}
module.exports={plan,tick,gather,ready,refreshSupportBoard,supplyIntent,approach,entryReady,prepareTick,preparationHold,stagingGather};
