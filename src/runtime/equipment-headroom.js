'use strict';
const slots=['weapon','offhand','head','armor','boots','wing','acc1','acc2'];
function historicalWeaponEnchant(i,r,now=Date.now()){
 // A closed-session unresolved roll stays quarantined. Storage never moves the
 // target weapon (even after replacement) or its materials, so it never replays it.
 return r.status==='unresolved'&&r.kind==='enchant'&&r.target?.id&&r.before?.equip?.weapon===r.target.id&&r.before?.weaponOpts&&Number.isFinite(r.at)&&Number.isFinite(i.startedAt)&&r.at<i.startedAt&&now-r.at>600000;
}
function uncertainGear(i,id){return (i.developmentLedger?.rows||[]).some(r=>['pending','unresolved','change_observed','spent_without_change'].includes(r.status)&&r.target?.id===id);}
function developmentBlocks(i,now=Date.now()){
 const ledger=i.developmentLedger;if(!ledger)return false;
 if(!Array.isArray(ledger.rows))return !!ledger.pending?.();
 return ledger.rows.some(r=>['pending','change_observed','spent_without_change'].includes(r.status)||r.status==='unresolved'&&!historicalWeaponEnchant(i,r,now));
}
function journalBlocks(i,now=Date.now(),ownedRow=null){
 const journal=i.v2?.journal;if(!journal)return false;if(!Array.isArray(journal.rows))return !!journal.pending?.();
 // Old potion purchases cannot receive, equip or consume surplus gear. Preserve
 // their uncertain outcome and purchase retry block; never clear or replay them.
 return journal.rows.some(r=>r!==ownedRow&&['STARTED','WAITING_CONFIRMATION','UNCERTAIN','OBSERVED'].includes(r.status)&&!(r.status==='UNCERTAIN'&&r.externalOwner==='development-ledger'&&i.developmentLedger?.rows?.some(old=>'development:'+old.id===r.id&&old.at===r.at&&old.target?.id===r.target?.id&&historicalWeaponEnchant(i,old,now)))&&!(r.status==='UNCERTAIN'&&r.kind==='purchase'&&!r.externalOwner&&['Red Potion','Blue Potion','Orange Potion','Yellow Potion','White Potion'].includes(r.target?.item)&&Number.isFinite(r.at)&&Number.isFinite(i.startedAt)&&r.at<i.startedAt&&now-r.at>300000));
}
function teamNeeds(i,id,now=Date.now()){
 const fs=require('fs'),path=require('path'),cat=i.catalog(),roster=i.roster,scope=require('../planning/host-team-scope').team(i.root,i.machine),expected=scope?.members.length||6;if(!Array.isArray(roster)||roster.length!==expected||new Set(roster.map(r=>r.charName)).size!==expected||scope&&roster.some(r=>!scope.members.some(m=>m.charName===r.charName))||!cat.build)return true;
 let sources;try{sources=(scope?['local']:['local',require('os').platform()==='win32'?'tum':'windows']).map(n=>{const file=path.join(i.root,'logs','fleet',n+'.json');return {data:JSON.parse(fs.readFileSync(file,'utf8')),receivedAt:n==='local'?null:fs.statSync(file).mtimeMs};});}catch{return true;}
 // Only peer gear comparison may account for a small host clock lead. The
 // exchange writes this file locally: require a fresh local receipt as well
 // as a bounded five-second lead, and age inventory on its own host clock.
 // Local saves, payments and action authorization keep their strict clocks.
 for(const source of sources){const s=source.data,age=now-s.at;source.peerLead=age<0&&source.receivedAt!==null&&Number.isFinite(source.receivedAt)&&now-source.receivedAt>=0&&now-source.receivedAt<15000&&s.at-source.receivedAt>=0&&s.at-source.receivedAt<=5000;
  if(scope&&s.machine!==i.machine||s.build!==cat.build||!Number.isFinite(s.at)||!Array.isArray(s.members)||age>=15000||age<0&&!source.peerLead)return true;
 }
 return roster.some(r=>{const matches=sources.flatMap(source=>source.data.members.filter(m=>m.charName===r.charName).map(m=>({m,source})));if(matches.length!==1)return true;const {m,source}=matches[0],s=m.teamInventory,age=source.peerLead?source.data.at-s?.at:now-s?.at;if(m.status!=='playing'||!s||!Number.isFinite(s.at)||!Number.isFinite(age)||age<0||age>=30000||!s.equip||!s.job||!Number.isFinite(s.lv))return true;const c=require('../gear-value').compare(s,cat,id);return c.upgrade||!!c.before?.unknown?.length||!!c.after?.unknown?.length;});
}
async function surplus(i){const plan=await i.planBag(i.roster),rows=safeSurplus(i,plan);if(rows.length>=2)return rows;const eligible=safeSurplus(i,{sell:plan.give||[]}).filter(r=>!teamNeeds(i,r.id));return [...rows,...eligible].slice(0,2);}
async function storageSurplus(i){
 const plan=await i.planBag(i.roster),seen=new Set(),spare=require('./storage-spare');
 return [...(plan.store||[]),...(plan.sell||[])].filter(r=>{if(seen.has(r.id)||!spare.candidate(i,r,plan).allowed)return false;seen.add(r.id);return true;}).slice(0,6);
}
function space(i){const s=i.lastSave,cap=i.catalog().world?.bagCap?.(s?.bagTier);return Number.isFinite(cap)&&Array.isArray(s?.bag)?{free:cap-s.bag.length,used:s.bag.length,cap}:null;}
function unfinishedDeposit(i,now=Date.now()){
 const s=i.equipmentMaintenanceStatus;
 return i.livePos?.room==='town'&&s?.kind==='inventory'&&['space_observed','preparing'].includes(s.status)&&s.evidence==='outgoing_client_save'&&s.targetFree===6&&require('./freshness').fresh(s.at,120000,now)&&space(i)?.free<6;
}
async function campaignAllows(i,now=Date.now(),allowTown=true){
 const p=i.endgameCampaign;if(p?.phase==='complete')return true;
 // Capacity recovery is a prerequisite for every campaign, not a reward for
 // finishing its materials. A missing class core used to keep a full bag in
 // the field indefinitely. Preserve committed boss/team work; optional card
 // or material hunting may yield to a bounded, reversible personal deposit.
 if(allowTown&&(space(i)?.free<4||unfinishedDeposit(i,now))){
  if(i.livePos?.room==='town')return true;
  if(['class','wing'].includes(p?.phase)&&p.ready===false&&require('./freshness').fresh(p.at,120000,now)
    &&!i.goal?.firstClear&&!['boss-live','preposition','return-to-boss'].includes(i.bossWindow?.phase))return true;
 }
 // A promotion needs two free gear slots even when capacity is already maxed.
 // Only owned town cleanup is permitted; field navigation stays with campaign.
 if(allowTown&&i.livePos?.room==='town'&&p?.phase==='class'&&p.missing?.some(r=>r.name==='bag_slots')&&require('./freshness').fresh(p.at,120000,now)&&space(i)?.free<2)return true;
 // A full bag already in town blocks all receiving/crafting. Clear it before leaving,
 // without recalling an actor from the field or taking another owner's navigation.
 if(allowTown&&(i.livePos?.room==='town'||i.goal?.kind==='survival'&&!i.survivalRecovery&&i.vitals?.hp>=.85)&&p?.phase==='wing'&&p.ready===false&&p.wing?.recipeVerified&&space(i)?.free<2)return true;
 const fresh=require('./freshness'),window=i.bossWindow;
 if(p?.phase!=='wing'||p.ready!==false||!p.wing?.recipeVerified||!fresh.fresh(p.at,120000,now)||window?.phase!=='side-work'||!window.boss||!fresh.fresh(window.assignedAt,180000,now)||typeof i.socialLast!=='function')return false;
 const board=await i.socialLast('bossboard');if(!fresh.fresh(board?._receivedAt,45000,now)||!Number.isFinite(board.now))return false;
 const field=board.list?.find(b=>b.id===window.boss.monsterId&&b.map===window.boss.mapId);
 if(!field||field.up||!Number.isFinite(field.next)||field.next<=board.now)return false;
 const spawnAt=field.next+board._receivedAt-board.now;
 const back=require('../planning/boss-window').travelBudget('town',window.boss.mapId,require('../economy').loadWiki(i.root));
 // Allow a town chore only with a fresh server window covering retreat, sale,
 // the conservative return route and the same 90-second boss arrival margin.
 return Number.isFinite(back.ms)&&now+(i.livePos?.room==='town'?0:155000)+90000+back.ms+90000<spawnAt;
}
function safeSurplus(i,plan){const s=i.lastSave,cat=i.catalog();return (plan.sell||[]).filter(r=>{const it=cat.items[r.id];return it?.rarityEvidence==='reviewed_native_generator'&&['common','uncommon'].includes(it.rarity)&&!['acc','wing'].includes(it.slot)&&!uncertainGear(i,r.id)&&!s.locks?.includes(r.id)&&!Object.values(s.equip||{}).includes(r.id)&&!s.refine?.[r.id]&&!s.stage?.[r.id]&&!s.holes?.[r.id]&&!s.sockets?.[r.id]?.length&&!s.weaponOpts?.[r.id]?.some(Boolean)&&!s.plk?.[r.id]?.some(Boolean);}).slice(0,2);}
function storageCapacityBlocked(r){return ['personal-storage-max-tier','storage-upgrade-reserve-required','storage-trade-awaiting-reconciliation'].includes(r?.reason)&&r.moved===0&&!r.stashed&&!r.sold&&!r.sent&&!r.id&&!r.transactionId&&!r.status;}
function independentGearSale(i,now=Date.now()){
 const fresh=require('./freshness'),s=i.teamTradeStatus,j=i.tradeJournal,o=j?.offer,p=j?.idleNavigationEvidence,name=i.character?.name||i.credentials?.charName;
 const q=i.teamTradeIntent?.quarantined?.find(q=>q.id===j?.id&&q.resolution==='unresolved_no_replay');
 const intent=i.teamTradeIntent;if(intent?.id!==j?.id&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(intent?.phase)&&[intent?.offer?.donor,intent?.offer?.receiver].includes(name))return false;
 // An old material transfer with an observed idle native session cannot move
 // these low-tier gear rows. This permits only a bounded gear sale; its exact
 // material quarantine, reservation and no-replay outcome stay untouched.
 return !!(s?.phase==='UNCERTAIN'&&s.navigationReleased===true&&s.id===j?.id&&j.phase==='UNCERTAIN'&&!j.sent?.confirm&&!j.receipt&&o?.kind==='material'&&typeof o.name==='string'&&Number.isSafeInteger(o.quantity)&&o.quantity>0&&[o.donor,o.receiver].includes(name)&&q?.offer?.kind===o.kind&&q.offer.name===o.name&&q.offer.quantity===o.quantity&&q.offer.donor===o.donor&&q.offer.receiver===o.receiver&&Number.isFinite(j.deadline)&&now-j.deadline>=300000&&p?.kind==='fresh_native_idle_after_deadline_no_confirmation'&&p.outcome==='unknown'&&p.replayBlocked===true&&fresh.fresh(p.at,15000,now)&&fresh.fresh(p.saveAt,30000,now)&&p.saveAt>j.deadline&&fresh.fresh(s.at,15000,now)&&i.tradeAvailability?.clear===true&&fresh.fresh(i.tradeAvailability.at,15000,now)&&fresh.decisionGate(i,now).allowed&&i.v2?.sourceCoherence?.matches===true);
}
async function capacitySale(i){
 const fresh=require('./freshness');
 // Opening storage can outlast HP freshness. Close our panel and observe
 // the real native screen before deciding on a different inventory action;
 // never extend an old observation timestamp to authorize a sale.
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.choresBusy||i.recycling||i.pendingTravel||i.survivalRecovery||i.v2?.trial?.active())return [];
 if(typeof i.screen==='function'){
  await i.closeGamePanel();const sample=await i.screen();
  if(!sample||sample.death||sample.panelOpen)return [];
  i.vitals=require('../team-readiness').vitals(sample);
 }
 // A storage wait can also expire the old idle-trade proof. Re-observe via
 // the existing native no-session/quarantine protocol, never retimestamp it.
 if(i.root&&i.character?.name&&i.teamTradeStatus?.phase==='UNCERTAIN'&&i.tradeJournal?.offer?.kind==='material')await require('./team-trade').reconcileIdleHistory(i);
 const allowed=()=>i.livePos?.room==='town'&&!i.livePos.dead&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.choresBusy&&!i.recycling&&!i.pendingTravel&&!i.survivalRecovery&&!i.v2?.trial?.active()&&i.v2?.sourceCoherence?.matches===true&&fresh.decisionGate(i).allowed&&fresh.fresh(i.vitals?.at,15000)&&Number.isFinite(i.vitals?.hp)&&i.vitals.hp>=.35&&(!i.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase)||independentGearSale(i))&&!developmentBlocks(i)&&!journalBlocks(i);
 if(!allowed())return [];
 const rows=await surplus(i);return allowed()?rows:[];
}
async function tick(i){
 if(i.dailyTeamPending||i.v2?.trial?.active()||require('./room-policy').isGuildHall(i.livePos?.room))return null;
 const fresh=require('./freshness');if(!i.autoChores||i.teamControl||i.dailyWorkStatus?.ownsNavigation||i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase)||i.pendingTravel||i.choresBusy||i.recycling||i.survivalRecovery||i.goal?.kind==='survival'&&i.livePos?.room!=='town'&&i.vitals?.hp<.85||i.livePos?.dead||i.v2?.sourceCoherence?.matches===false||require('./room-policy').roomPolicy(i.livePos?.room).dungeon||!fresh.decisionGate(i).allowed||!fresh.fresh(i.vitals?.at,15000)||!Number.isFinite(i.vitals?.hp)||i.vitals.hp<.35)return null;
 const before=space(i);if(!before)return null;
 const unfinished=unfinishedDeposit(i);
 if(before.free>=4&&!unfinished){if(i.livePos?.room==='town'&&before.free>=3&&i.canDo('storedTeamAccessory',120000)){try{const r=await require('./personal-storage').supplyTeamAccessory(i);if(r.moved)return 'stored team accessory: withdrawal observed; await verified trade';}finally{await i.closeGamePanel();}}return null;}
 if(developmentBlocks(i)||journalBlocks(i)||typeof i.planBag!=='function'||!await campaignAllows(i)||!i.canDo('equipmentHeadroom',unfinished?5000:120000))return null;
 const old=i.equipmentMaintenanceStatus;if(old?.kind==='inventory'&&old.status==='awaiting_outcome'&&i.lastSaveAt<=old.dispatchAt)return null;
 const stored=typeof i.stashItems==='function'?await storageSurplus(i):[],rows=stored.length?stored:await surplus(i),mode=stored.length?'store':'sell';
 if(!rows.length){i.equipmentMaintenanceStatus={kind:'inventory',at:Date.now(),status:'blocked',name:'พื้นที่รับไอเทม',from:before.free,to:2,reason:'ไม่มีของส่วนเกินที่ผ่านการตรวจให้ฝากหรือขาย; เก็บปีก ของทีม และชิ้นลงทุนไว้'};return null;}
 i.equipmentMaintenanceStatus={kind:'inventory',at:Date.now(),status:'preparing',name:'พื้นที่รับไอเทม',from:before.free,targetFree:6,to:mode==='store'?6:2,...(unfinished?{evidence:'outgoing_client_save'}:{}),reason:mode==='store'?'ฝากของส่วนเกินในคลังส่วนตัว เก็บของทีม ปีกและชิ้นลงทุนไว้ เพื่อรับของ/เทรด/คราฟต่อ':'กระเป๋าเต็มทำให้เติมช่องว่าง/รับเทรดไม่ได้; ขายเฉพาะของส่วนเกินระดับต่ำที่ไม่ลงทุน'};
 await i.expeditionAuto(false);const home=i.livePos?.room==='town'?{ok:true}:await i.returnToTown();if(!home.ok){i.equipmentMaintenanceStatus.status='route_wait';return 'equipment headroom: waiting for town';}
 if(i.livePos?.room!=='town'||!fresh.decisionGate(i).allowed||!fresh.fresh(i.vitals?.at,15000)||!Number.isFinite(i.vitals?.hp)||i.vitals.hp<.35||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.v2?.trial?.active()||i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase)||i.v2?.sourceCoherence?.matches===false||developmentBlocks(i)||journalBlocks(i)||!await campaignAllows(i)){i.equipmentMaintenanceStatus.status='replanned';return 'equipment headroom: ownership or freshness changed';}
 const current=space(i);if(current.free>=(unfinished?6:4)){i.equipmentMaintenanceStatus.status='space_observed';return 'equipment headroom: free slots already confirmed';}
 const safe=mode==='store'?await storageSurplus(i):await surplus(i);if(!safe.length){i.equipmentMaintenanceStatus.status='blocked';return 'equipment headroom: no safe surplus';}
 const at=Date.now();i.equipmentMaintenanceStatus.dispatchAt=at;
 try{let result=mode==='store'?await i.stashItems(safe,[]):await i.sellItems(safe);
  if(mode==='store'&&storageCapacityBlocked(result)){const fallback=await capacitySale(i);if(fallback.length){i.equipmentMaintenanceStatus.storageFailure=result.reason;result=await i.sellItems(fallback);}}
  const until=Date.now()+10000;while(Date.now()<until&&(i.lastSaveAt<=at||space(i)?.free<2))await new Promise(r=>setTimeout(r,500));const after=space(i),observed=i.lastSaveAt>at&&after?.free>current.free;i.equipmentMaintenanceStatus={...i.equipmentMaintenanceStatus,at:Date.now(),status:observed?'space_observed':result?.sold||result?.stashed?'awaiting_outcome':'not_sent',to:after?.free??current.free,evidence:observed?'outgoing_client_save':'no_confirmed_free_slot',result:{sold:result?.sold||0,stashed:result?.stashed||0,reason:result?.reason||null,storageEvidence:result?.evidence||null}};if(observed&&slots.some(k=>!i.lastSave.equip?.[k])&&typeof i.recoverStoredUpgrades==='function')await i.recoverStoredUpgrades();return 'equipment headroom: '+i.equipmentMaintenanceStatus.status;}finally{await i.closeGamePanel();}
}
module.exports={space,safeSurplus,storageCapacityBlocked,capacitySale,independentGearSale,uncertainGear,developmentBlocks,journalBlocks,teamNeeds,surplus,storageSurplus,campaignAllows,tick};
