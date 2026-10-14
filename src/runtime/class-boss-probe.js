'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),fresh=require('./freshness');
function records(i){
 if(i.classBossProbes)return i.classBossProbes;
 const name=i.character?.name||i.credentials?.charName;if(!name){i.classBossProbeStorageBlocked=true;return i.classBossProbes=[];}
 i.classBossProbeFile=path.join(i.root,'logs/class-boss-probes',crypto.createHash('sha256').update(name).digest('hex').slice(0,24)+'.json');
 try{i.classBossProbes=JSON.parse(fs.readFileSync(i.classBossProbeFile));if(!Array.isArray(i.classBossProbes))throw Error('invalid records');}catch(e){if(e.code!=='ENOENT')i.classBossProbeStorageBlocked=true;i.classBossProbes=[];}
 for(const r of i.classBossProbes)if(r.status==='running'){r.status='interrupted';r.cooldownUntil=Math.max(r.cooldownUntil||0,Date.now()+900000);}
 return i.classBossProbes;
}
function persist(i){if(!i.classBossProbeFile)return;fs.mkdirSync(path.dirname(i.classBossProbeFile),{recursive:true});require('./telemetry-file').writeTelemetry(i.classBossProbeFile,i.classBossProbes.slice(-80));}
function milestone(i){
 const cat=i.catalog(),p=i.endgameCampaign,s=i.lastSave||{};
 const astral=require('../planning/astral-path').bossNeed(i);if(astral&&p?.phase!=='class'&&p?.ready!==true)return astral;
 if(astral&&p?.phase==='complete')return astral;
 if(p?.phase==='complete'&&i.v2?.sourceCoherence?.matches===true){
  const d=i.developmentProgress,t=d?.craftPortfolio?.selected;
  if(d?.build===cat.build&&fresh.fresh(d.at,30000)&&t?.recipeVerified&&t.verifiedBuild===cat.build&&!t.ready&&t.cost&&t.missing?.length)return {needs:t.cost,coins:t.cost.Copper||0,equipment:true,missing:t.missing};
 }
 if(p?.phase==='class')return {needs:cat.world.ASCEND?.items||{},coins:cat.world.ASCEND?.coins||100000};
 const item=cat.items?.[p?.target];
 if(p?.phase==='wing'&&p.wing?.recipeVerified&&item?.slot==='wing'&&item.recipeVerified&&item.recipeVerificationBuild===cat.build&&item.recipeCost&&require('../economy').canUse(item,s.job,cat.world))return {needs:item.recipeCost,coins:item.recipeCost.Copper||0};
 return null;
}
function assistanceReserve(i){
 const s=i.lastSave||{},goal=milestone(i),upkeep=Math.max(1000,(s.lv||1)*100);
 // Necessary HP supplies precede a not-ready wing. Personal promotion
 // and a ready milestone retain money; paid journals still gate every action.
 const immediate=i.endgameCampaign?.phase==='class'||i.endgameCampaign?.ready===true;
 return Math.max(require('../upgrade-reserve').reserve(s,i.catalog().world),(immediate?goal?.coins||0:0)+upkeep);
}
function supplyRequirement(i,now=Date.now()){
 const goal=milestone(i),s=i.lastSave||{},cat=i.catalog(),missing=goal?.equipment||goal?.astral?goal.missing:i.endgameCampaign?.missing||[];
 if(i.goal?.kind==='milestone-assist'&&i.v2?.sourceCoherence?.matches===true&&fresh.decisionGate(i,now).allowed&&(require('./assistance-reservation').state(i,now)||require('./assistance-reservation').intent(i,now)?.due))return {minimum:40,reserve:assistanceReserve(i),reason:'verified-assistance-retains-40-after-bounded-preparation'};
 // Completed tank/healer still prepares for a friend's mandatory class.
 // Stock-independent discovery is not a permission to move or fight.
 if(i.v2?.sourceCoherence?.matches===true&&fresh.decisionGate(i,now).allowed&&require('./milestone-assistance').supplyIntent(i,now)?.due){const reserve=assistanceReserve(i);return {minimum:80,reserve,requiredCopper:reserve+10000,reason:'same-party-mandatory-helper-route-and-combat-stock'};}
 // Missing first-wing boss materials are a future objective, not ownership
 // of every training tick. Normal EXP/survival work below cap uses its own
 // supply budget until a boss target or verified team assistance is assigned.
 if(s.lv<cat.world.MAX_LV&&i.endgameCampaign?.phase==='wing'&&i.endgameCampaign.ready!==true&&!(cat.world.MONSTERS||[]).some(m=>m.id===i.goal?.monsterId&&m.kind==='boss')&&i.goal?.kind!=='milestone-assist')return null;
 if(!goal||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed||!missing.some(r=>Number.isInteger(goal.needs[r.name])&&goal.needs[r.name]>0&&(s.materials?.[r.name]||0)<goal.needs[r.name]&&(cat.world.MONSTERS||[]).some(m=>m.kind===(goal.equipment?'miniboss':'boss')&&m.dropTable?.some(d=>d.itemName===r.name&&d.rate>0))))return null;
 const budget=require('./supply-recovery').hpBatch(i,now),target=Math.max(43,Number.isFinite(budget.potsPerMinute)?budget.target:43);
 // The measured stock target amortizes a refill; it is not the trigger for
 // another town trip after every potion consumed. A due helper still needs80
 // before a new group, and an existing reservation retains its40 minimum.
 return {minimum:43,target,reserve:assistanceReserve(i),reason:target>43?'mandatory-milestone-refill-hysteresis':'mandatory-milestone-first-clear-40-plus-3-preparation-potions'};
}
function partyAt(p,now){return p?._sessionBound?require('./party-evidence').observedAt(p,now):null;}
function role(p){const cat=p.catalog();return cat.world.HIGH_CLASSES?.[p.lastSave.job]?.from||p.lastSave.job;}
function support(i,g,now=Date.now()){
 if(i.livePos?.room!==g.mapId||i.livePos?.dead||!fresh.fresh(i.livePos?.at,10000,now))return false;
 const party=i.socialInbox?.last('party');if(!party?.id||partyAt(party,now)===null)return false;
 const peers=[...new Set([i,...(i.teamPeers?.()||[])])].filter(p=>{
  const own=p.socialInbox?.last('party');return (!p.remoteMachine||p.remoteValidated&&p.remoteAssistance&&p.remoteAssistance.key===require('./assistance-reservation').intent(i,now)?.key&&p.remoteAssistance.expiresAt>now)&&typeof p.catalog==='function'&&p.status==='playing'&&p.catalog().build===i.catalog().build&&p.v2?.sourceCoherence?.matches===true&&own?.id===party.id&&partyAt(own,now)!==null&&fresh.decisionGate(p,now).allowed&&fresh.fresh(p.vitals?.at,15000,now)&&p.vitals.hp>=.65&&!p.livePos?.dead&&p.livePos?.room===g.mapId&&p.goal?.monsterId===g.monsterId&&p.managedHuntReady===[i.catalog().build,g.mapId,g.monsterId].join(':')&&[i.livePos?.x,i.livePos?.z,p.livePos?.x,p.livePos?.z].every(Number.isFinite)&&Math.hypot(i.livePos.x-p.livePos.x,i.livePos.z-p.livePos.z)<=10&&!p.survivalRecovery&&!p.teamControl&&!p.dailyTeamPending&&!p.dailyWorkStatus?.ownsNavigation&&!p.recycling&&require('./survival').hpPots(p.lastSave)>=40;
 });
 return peers.length>=2&&peers.some(p=>['knight','dawnwarden'].includes(role(p)))&&peers.some(p=>['priest','lumenoracle'].includes(role(p)));
}
// A genuine same-party tank/healer pair can plan a meeting before arrival.
// This only unlocks navigation. Combat still rechecks support() in the same
// room, within range, with current HP and the exact managed native target.
function routeSupport(i,m,map,now=Date.now()){
 const party=i.socialInbox?.last('party'),native=i.catalog().world.MONSTERS?.find(n=>n.id===m?.id);
 if(!party?.id||partyAt(party,now)===null||native?.kind!=='boss'||native.level!==m.level||!map?.bossRoom||/^(pv|p\d|tw|dx|gd)/.test(map.id))return false;
 const position=i.socialInbox?.bossPositions?.view(m.id,map.id,now),atk=native.atk*(position?.ak||1)*(position?.rage?(i.catalog().world.BOSS_RAGE?.atk||1.5):1);
 if(!Number.isFinite(atk)||atk<=0)return false;
 const peers=[...new Set([i,...(i.teamPeers?.()||[])])].filter(p=>{
  if(p.remoteMachine||typeof p.catalog!=='function'||p.status!=='playing'||p.catalog().build!==i.catalog().build)return false;
  const s=p.lastSave||{},own=p.socialInbox?.last('party'),required=milestone(p),need=required&&Object.entries(required.needs).some(([name,n])=>name!=='Copper'&&Number.isInteger(n)&&n>0&&(s.materials?.[name]||0)<n&&native.dropTable?.some(d=>d.itemName===name&&d.rate>0));
  return need&&own?.id===party.id&&partyAt(own,now)!==null&&p.v2?.sourceCoherence?.matches===true&&fresh.decisionGate(p,now).allowed&&fresh.fresh(p.vitals?.at,15000,now)&&p.vitals.hp>=.35&&Number.isFinite(p.vitals.maxHp)&&p.vitals.maxHp>=atk*2&&s.lv>=native.level+10&&!p.livePos?.dead&&!require('./room-policy').roomPolicy(p.livePos?.room).dungeon&&!p.teamControl&&!p.dailyTeamPending&&!p.dailyWorkStatus?.ownsNavigation&&!p.survivalRecovery&&!p.recycling&&!p.choresBusy&&!p.v2?.trial?.active()&&(!p.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(p.teamTradeStatus.phase))&&!require('./equipment-headroom').developmentBlocks(p)&&!require('./equipment-headroom').journalBlocks(p)&&!require('./survival').recentDeaths(p,now).length&&require('./survival').hpPots(s)>=43&&Number.isFinite(s.coins)&&s.coins>=required.coins+10000&&['weapon','head','armor','boots'].every(k=>p.catalog().items[s.equip?.[k]])&&!records(p).some(r=>r.monsterId===m.id&&r.cooldownUntil>now)&&!p.classBossProbeStorageBlocked;
 });
 return peers.includes(i)&&peers.some(p=>['knight','dawnwarden'].includes(role(p)))&&peers.some(p=>['priest','lumenoracle'].includes(role(p)));
}
function eligible(i,m,map,now=Date.now(),{route=false}={}){
 const s=i.lastSave||{},cat=i.catalog(),rows=records(i),deny=reason=>({allowed:false,reason});
 if(i.classBossProbeStorageBlocked||rows.some(r=>r.monsterId===m?.id&&r.cooldownUntil>now))return deny('first-clear-cooldown-or-unreadable-history');
 const assistance=m&&map?require('./assistance-reservation').intent(i,now,m.id,map.id):null;
 const assigned=assistance?.due&&i.goal?.kind==='milestone-assist'&&i.goal.recipient===assistance.recipient&&i.goal.monsterId===m?.id&&i.goal.mapId===map?.id;
 const supported=support(i,{mapId:map?.id,monsterId:m?.id},now),plannedSupport=route&&!supported&&(assigned||routeSupport(i,m,map,now));
 // A reserved group must not silently fall back to a solo attempt while
 // its tank/healer is approaching or recovering. Route permission is separate.
 if(assigned&&!route&&!supported)return deny('assigned-group-support-not-combat-ready');
 const required=assigned?{needs:{},coins:assistanceReserve(i)}:milestone(i);
 if(!required||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed||!fresh.fresh(i.vitals?.at,15000,now)||!Number.isFinite(i.vitals.hp)||i.vitals.hp<(route ? .35 : supported ? .65 : .85))return deny('fresh-class-source-and-healthy-HP-required');
 const uncertain=require('./equipment-headroom').developmentBlocks(i)||require('./equipment-headroom').journalBlocks(i);
 // A fresh server wallet/inventory permits gathering alongside closed-session
 // known item/potion records. Their payment holds and no-replay fences remain.
 const independent=required.equipment&&require('./storage-payment-scope').independent(i,{action:'combat-gather'},now);
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.survivalRecovery||i.recycling||i.v2?.trial?.active()||require('./team-trade').blocksNavigation(i)||uncertain&&!independent||require('./survival').recentDeaths(i,now).length)return deny('another-owner-recovery-or-uncertain-action');
 const native=cat.world?.MONSTERS?.find(x=>x.id===m?.id);
 if(!m||!(required.equipment?m.kind==='miniboss'&&native?.kind==='miniboss':m.kind==='boss'&&native?.kind==='boss')||native.level!==m.level||!map?.bossRoom||/^(pv|p\d|tw|dx|gd)/.test(map.id)||s.lv<m.level+(required.equipment||required.astral||assistance?.astral?0:10))return deny('verified-non-PVP-boss-and-level-margin-required');
 const need=assigned?[assistance.material,1]:Object.entries(required.needs).find(([name,n])=>name!=='Copper'&&Number.isInteger(n)&&n>0&&(s.materials?.[name]||0)<n&&native.dropTable?.some(d=>d.itemName===name&&d.rate>0));
 if(!need||!assigned&&!(required.equipment||required.astral?required.missing:i.endgameCampaign.missing)?.some(r=>r.name===need[0]))return deny('mandatory-class-ingredient-required');
 if(require('./survival').hpPots(s)<40||!Number.isFinite(s.coins)||s.coins<required.coins+10000||['weapon','head','armor','boots'].some(k=>!cat.items[s.equip?.[k]]))return deny('gear-and-40-potions-with-promotion-reserve-required');
 const position=i.socialInbox?.bossPositions?.view(m.id,map.id,now),atk=native.atk*(position?.ak||1)*(position?.rage?(cat.world.BOSS_RAGE?.atk||1.5):1);
 const hp=route?i.vitals.maxHp:i.vitals.currentHp;if(!Number.isFinite(atk)||atk<=0||!Number.isFinite(hp)||hp<atk*(supported||plannedSupport?2:4))return deny('insufficient-observed-HP-for-bounded-first-clear; team-required');
 return {allowed:true,material:need[0],supported,plannedSupport,reason:plannedSupport?'same-party-milestone-rendezvous; combat-requires-observed-nearby-support':'bounded-first-clear-not-prior-kill-proof'};
}
function combatStopReason(i,now=Date.now()){
 const r=i.classBossProbeActive;
 if(!r||r.status!=='running'||now>=r.deadline)return 'probe-not-running-or-deadline';
 if(r.build!==i.catalog().build||i.v2?.sourceCoherence?.matches!==true)return 'source-changed';
 if(i.teamControl||i.dailyTeamPending||i.survivalRecovery||i.dailyWorkStatus?.ownsNavigation||i.recycling||i.v2?.trial?.active()||require('./team-trade').blocksNavigation(i))return 'protected-owner-or-recovery';
 if(i.goal?.monsterId!==r.monsterId||i.livePos?.room!==r.mapId||i.managedHuntReady!==[r.build,r.mapId,r.monsterId].join(':'))return 'native-room-or-target-changed';
 if(!fresh.decisionGate(i,now).allowed)return 'native-save-stale';
 if(!fresh.fresh(i.vitals?.at,2000,now))return 'native-hp-stale';
 if(!(i.vitals.hp>=.65))return 'native-hp-below-combat-minimum';
 if(r.supported&&!support(i,r,now))return 'nearby-tank-healer-support-not-ready';
 return null;
}
function combatAllowed(i,now=Date.now()){return combatStopReason(i,now)===null;}
async function prepare(i,g,{stagingRoom=null}={}){
 const room=stagingRoom||g.mapId;
 if(stagingRoom){const approach=require('./milestone-assistance').approach(i,g);if(!approach?.staging||approach.mapId!==stagingRoom)return null;}
 if(!i.canDo?.('classBossPrepare',30000)||!i.screen||!i.eval)return null;
 const wiki=require('../economy').loadWiki(i.root),m=wiki?.monsters?.monsters?.find(x=>x.id===g.monsterId),map=wiki?.maps?.maps?.find(x=>x.id===g.mapId);
 let sent=0;
 for(let n=0;n<3;n++){
  const screen=await i.screen();i.vitals=require('../team-readiness').vitals(screen);
  if(screen.death||screen.panelOpen||i.livePos?.room!==room||!eligible(i,m,map,Date.now(),{route:true}).allowed||i.vitals.hp>=.98||require('./survival').hpPots(i.lastSave)<43)break;
  const before=i.vitals.currentHp;
  // The native R slot chooses an owned potion and enforces its own cooldown.
  const clicked=await i.eval(`(() => {const b=Array.from(document.querySelectorAll('#hotbar .slot')).find(b=>b.querySelector('.k')?.textContent==='R');if(!b||b.hidden||b.disabled||b.querySelector('.cdn')?.textContent.trim()||Number(b.style.opacity||1)<1)return false;b.click();return true;})()`);
  if(!clicked)break;sent++;let observed=false;
  const end=Date.now()+3500;while(Date.now()<end){await new Promise(r=>setTimeout(r,350));const s=await i.screen();i.vitals=require('../team-readiness').vitals(s);if(s.death||i.livePos?.room!==room)break;if(i.vitals.currentHp>before){observed=true;break;}}
  if(!observed)break; // Never replay a potion click whose effect is still unclear.
 }
 return {at:Date.now(),sent,hp:i.vitals?.hp,reason:sent?'native potion use; HUD outcome checked':'no preparation action sent'};
}
async function stage(i,g){
 const now=Date.now(),p=i.socialInbox?.bossPositions?.observation(g.monsterId,g.mapId,now);
 if(!p||p.alive||!fresh.fresh(p.at,900000,now)||!Number.isFinite(g.nextAt)||g.nextAt<=now||i.livePos?.room!==g.mapId||!fresh.fresh(i.livePos.at,6000,now)||!Number.isFinite(i.livePos.x)||!Number.isFinite(i.livePos.z)||Math.hypot(i.livePos.x-p.x,i.livePos.z-p.z)<=3||!i.canDo?.('classBossStage',20000)||!i.walkTo)return null;
 const wiki=require('../economy').loadWiki(i.root),m=wiki?.monsters?.monsters?.find(x=>x.id===g.monsterId),map=wiki?.maps?.maps?.find(x=>x.id===g.mapId);
 if(!eligible(i,m,map,now,{route:true}).allowed)return null;
 // This is a last observed server location, not a promise of the next spawn
 // coordinate. Leave the entrance before the short live window; stop walking
 // immediately if the server announces the boss is up or the owner changes.
 const r=await i.walkTo(p.x,p.z,{timeoutMs:20000,tolerance:3,abort:async()=>i.teamControl||i.survivalRecovery||i.livePos?.room!==g.mapId||!!i.socialInbox?.bossPositions?.view(g.monsterId,g.mapId)});
 return {at:Date.now(),x:p.x,z:p.z,observedAt:p.at,arrived:r?.ok===true,evidence:'last_observed_server_zone_position_not_predicted_spawn'};
}
async function run(i,g){
 if(!i.socialInbox?.bossPositions?.view(g.monsterId,g.mapId))await require('./boss-feed').poll(i,{waitMs:1500,force:true});
 if(typeof i.screen==='function')i.vitals=require('../team-readiness').vitals(await i.screen());
 // Arrival can damage HP even when the boss is already live. Preparation is
 // guarded by route eligibility and keeps40 combat potions; it never attacks.
 if(Number.isFinite(i.vitals?.hp)&&i.vitals.hp<.85)await prepare(i,g);
 const wiki=require('../economy').loadWiki(i.root),m=wiki?.monsters?.monsters?.find(x=>x.id===g.monsterId),map=wiki?.maps?.maps?.find(x=>x.id===g.mapId),check=eligible(i,m,map);
 if(!check.allowed)return {ok:false,reason:check.reason};
 const b=await i.socialLast('bossboard'),now=Date.now();
 if(i.livePos?.room!==g.mapId||!fresh.fresh(b?._receivedAt,30000,now)||!b.list?.some(x=>x.id===g.monsterId&&x.map===g.mapId&&x.up&&!x.next))return {ok:false,reason:'fresh-live-boss-at-arrival-required'};
 const r={at:now,build:i.catalog().build,monsterId:g.monsterId,mapId:g.mapId,material:check.material,supported:check.supported,kills:i.lastSave.bestiary?.[g.monsterId]||0,stock:i.lastSave.materials?.[check.material]||0,potions:require('./survival').hpPots(i.lastSave),deadline:now+90000,status:'running',cooldownUntil:now+900000};
 i.classBossProbes.push(r);i.classBossProbeActive=r;i.classBossProbeStatus=r;persist(i);
 let reason='bounded-first-clear-timeout';
 try{
  while(Date.now()<r.deadline){
   i.v2?.scheduler?.checkpoint();
   const screen=await i.screen();i.vitals=require('../team-readiness').vitals(screen);
   if((i.lastSave.bestiary?.[g.monsterId]||0)>r.kills||(i.lastSave.materials?.[r.material]||0)>r.stock){r.status='native-clear-observed';r.cooldownUntil=0;r.evidence='outgoing_native_save_not_server_reward_receipt';reason='native-first-clear-observed';break;}
   const stock=require('./survival').hpPots(i.lastSave),stop=screen.death||i.livePos?.dead?'native-death':combatStopReason(i)|| (r.potions-stock>=15?'bounded-potion-use-limit':stock<20?'combat-potion-stock-low':null);
   if(stop){reason='first-clear-'+stop;r.stopObservation={at:Date.now(),hp:i.vitals?.hp,potions:stock,lastSaveAt:i.lastSaveAt,supported:r.supported};break;}
   await i.expeditionAuto(true);await new Promise(resolve=>setTimeout(resolve,750));
  }
 }catch(e){reason='first-clear-interrupted';r.error='scheduler/session interruption; no success inferred';}
 finally{try{await i.expeditionAuto(false);}catch{reason='first-clear-stop-unconfirmed';}if(r.status==='running')r.status='withdrawn';r.finishedAt=Date.now();r.reason=reason;i.classBossProbeActive=null;i.classBossProbeExitPending=r.status!=='native-clear-observed';persist(i);}
 if(i.classBossProbeExitPending){i.campaignGoal=null;i.pendingTravel=null;i.goal={kind:'survival',mapId:'town',label:'ถอนจากการทดลองบอสคลาส',reason};i.huntMap='town';}
 return {ok:r.status==='native-clear-observed',reason,status:r.status};
}
async function exitTick(i){
 if(!i.classBossProbeExitPending)return null;await i.expeditionAuto(false);
 if(i.livePos?.room==='town'){i.classBossProbeExitPending=false;i.goal=null;i.campaignGoal=null;i.refreshGoal?.();return 'class probe: town exit confirmed';}
 if(i.canDo('classProbeRetreat',15000))await i.returnToTown();return 'class probe: awaiting confirmed withdrawal';
}
module.exports={eligible,combatAllowed,combatStopReason,run,exitTick,support,routeSupport,prepare,stage,milestone,assistanceReserve,supplyRequirement,history:records};
