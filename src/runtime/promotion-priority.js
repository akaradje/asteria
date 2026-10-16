'use strict';
const fs=require('fs'),path=require('path'),fresh=require('./freshness'),economy=require('../economy');
const active=r=>['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status);
const receipts=require('./market-receipts');
function target(i){
 const s=i.lastSave||{},w=i.catalog().world,next=economy.nextPromotion(s.job,w),a=w.ASCEND;
 if(!next||!w.HIGH_CLASSES?.[next]||a?.open!==true||s.lv<a.lv||s.jobLv<a.jobLv)return require('../planning/legendary-acquisition').materialObjective(i);
 const missing=Object.entries(a.items||{}).filter(([k,n])=>Number.isInteger(n)&&n>0&&(s.materials?.[k]||0)<n);
 return {next,missing,reserve:a.coins+Math.max(10000,(s.lv||1)*100)+28000};
}
function safe(i,s,now=Date.now()){
 return i.status==='playing'&&!s.death&&!s.panelOpen&&!i.recycling&&!i.choresBusy&&!i.pendingTravel&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.assistanceReservation&&!i.classBossProbeActive&&!i.survivalRecovery&&!i.v2?.trial?.active()&&i.v2?.sourceCoherence?.matches===true&&fresh.decisionGate(i,now).allowed&&fresh.fresh(i.vitals?.at,15000,now)&&i.vitals.hp>=.85&&!(i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase));
}
function purchaseDemand(i,item,now=Date.now()){
 const personal=target(i);if(personal?.equipment)return Math.max(0,(personal.missing.find(([k])=>k===item)?.[1]||0)-(i.lastSave.materials?.[item]||0));
 const own=target(i),need=own?.missing.find(([k])=>k===item);if(!need)return 0;
 const party=i.socialInbox?.last('party');let total=need[1]-(i.lastSave.materials?.[item]||0);
 if(!party?.id||party._sessionBound!==true||require('./party-evidence').observedAt(party,now)===null)return total;
 for(const p of [...new Set(i.teamPeers?.()||[])]){
  if(p===i||p.remoteMachine&&!p.remoteValidated||p.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(p,now).allowed)continue;
  const other=p.socialInbox?.last('party');if(other?.id!==party.id||other._sessionBound!==true||require('./party-evidence').observedAt(other,now)===null)continue;
  const need=target(p)?.missing.find(([k])=>k===item);if(need)total+=Math.max(0,need[1]-(p.lastSave.materials?.[item]||0));
 }
 return total;
}
function listing(board,item,need,budget,now=Date.now()){
 if(!board||!fresh.fresh(board._receivedAt,10000,now)||!Number.isFinite(board.now)||!Array.isArray(board.list))return null;
 return board.list.filter(r=>r.kind==='stack'&&r.item===item&&(r.mine===false||r.mine===0)&&[undefined,false,0].includes(r.each)&&Number.isInteger(r.id)&&r.id>0&&Number.isInteger(r.n)&&r.n>0&&r.n<=need&&Number.isInteger(r.price)&&r.price>0&&r.price<=budget&&Number.isFinite(r.expires)&&r.expires>board.now+now-board._receivedAt+10000).sort((a,b)=>a.price/a.n-b.price/b.n||a.price-b.price||a.id-b.id)[0]||null;
}
function receiptMatches(r,m){
 return receipts.matches(r,m);
}
function observeMarketReply(i,t,board,request,now=Date.now()){
 if(!request||request.build!==i.catalog().build||!t.missing.some(([item])=>item===request.item)||!fresh.fresh(request.at,60000,now)||!(board?._receivedAt>request.at)||!fresh.fresh(board._receivedAt,10000,now)||!Number.isFinite(board.now))return false;
 const item=request.item,budget=i.lastSave.coins-t.reserve-(require('./paid-actions').heldResources(i).Copper||0),demand=purchaseDemand(i,item,now),r=listing(board,item,demand,budget,now),offers=(board.list||[]).filter(x=>x.kind==='stack'&&x.item===item&&x.expires>board.now);
 // Observation is permitted outside town or during recovery. It only informs
 // a bounded Copper budget; all native purchase/location/HP guards still apply.
 i.promotionPriorityStatus={at:now,build:i.catalog().build,status:r?'market_candidate':'no_affordable_listing',item,budget,demand,marketNow:board.now,offers:offers.map(x=>({kind:x.kind,item:x.item,id:x.id,n:x.n,price:x.price,mine:x.mine,expires:x.expires})),queryAt:request.at,receivedAt:board._receivedAt,exactListings:offers.length,reason:'original native market response observed; purchase requires town and fresh safety checks'};
 return true;
}
async function reconcile(i,row){
 if(!Number.isFinite(row.dispatchAt)){row.status='CANCELLED';row.reason='durable intent has no dispatch baseline; no payment sent';i.v2.reservations.finish(row.claimId,'CANCELLED');i.v2.journal.save();return 'class market: original intent not dispatched';}
 const journal=i.v2.journal,at=Date.now(),current=receipts.context(i),bound=receipts.sameContext(row.context,current),m=bound?i.socialInbox?.last('mkr'):null;
 if(m?.t==='mkr'&&m._receivedAt>row.dispatchAt)row.replyObservation={at:m._receivedAt,op:m.op,ok:m.ok,no:m.no,rev:m.rev??null,item:m.res?.item,n:m.res?.n,price:m.res?.price};
 if(receiptMatches(row,m)){row.nativeReceipt=receipts.proof(row,m);row.receipt={at:m._receivedAt,rev:m.rev??null,op:m.op,item:m.res.item,n:m.res.n,price:m.res.price};}
 if(!row.nativeReceipt&&receipts.rejected(row,m)){row.status='CANCELLED';row.reason='native market rejected original observed command: '+m.no;row.nativeRejection={...current,at:m._receivedAt,sequence:m._sequence,command:m._command,reason:m.no};i.v2.reservations.finish(row.claimId,'CANCELLED');}
 const s=i.lastSave;
 if(bound&&receipts.persisted(row)&&i.lastSaveAt>row.dispatchAt&&i.lastSaveAt>=row.nativeReceipt.at&&at>=i.lastSaveAt&&at-i.lastSaveAt<30000&&s.coins===row.before.coins-row.target.price&&(s.materials?.[row.target.item]||0)===row.beforeMaterial+row.target.n){
  row.status='CONFIRMED';row.reason=null;row.observedAt=i.lastSaveAt;row.evidence='exact_native_market_receipt_and_fresh_wallet_material_deltas';i.v2.reservations.finish(row.claimId,'CONFIRMED');
 }else if(row.status!=='CANCELLED'&&row.dispatchAt&&at>=row.deadline){row.status='UNCERTAIN';row.reason='market outcome not proven; original listing never resent';i.v2.reservations.finish(row.claimId,'UNCERTAIN');}
 journal.save();i.promotionPriorityStatus={at,status:row.status,item:row.target.item,listingId:row.target.listingId,reason:row.reason||row.evidence};
 return 'class market: '+row.status;
}
async function tick(i,s,{sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const journal=i.v2?.journal;if(!journal?.rows||!i.v2.reservations)return null;
 const pending=journal.rows.find(r=>r.externalOwner==='class-market'&&active(r));
 // Always reconcile the original durable operation before choosing new work.
 if(pending)return reconcile(i,pending);
 const t=target(i);if(!t)return null;
 let originalReply;
 const originalQuery=i.promotionMarketQuery;
 if(originalQuery?.build===i.catalog().build&&fresh.fresh(originalQuery.at,60000)){
  originalReply=await i.socialLast('mk');observeMarketReply(i,t,originalReply,originalQuery);
 }
 if(!safe(i,s))return null;
 if(!t.missing.length){
  if(!i.autoAdvanceJob||!require('../planning/progression-priority').assess(i.lastSave,i.catalog()).pet||!i.canDo('priorityHighClass',60000))return null;
  await i.expeditionAuto(false);let r=await i.advanceJob();
  if(r.reason==='promotion-bag-space-required'){
   const home=i.livePos?.room==='town'?{ok:true}:await i.returnToTown();
   if(home.ok&&(await require('./wing-inventory').prepare(i,{minimum:2})).ok)r=await i.advanceJob();
  }
  await i.closeGamePanel();i.promotionPriorityStatus={at:Date.now(),status:r.ok?'class_confirmed':'awaiting_class',target:t.next,reason:r.reason};return 'priority class: '+i.promotionPriorityStatus.status;
 }
 if(i.livePos?.room!=='town'){
  const observed=i.promotionPriorityStatus;
  if(i.lastSave.coins-t.reserve>0&&i.canDo('classMarketVisit',600000)){
   await i.expeditionAuto(false);const visit=await i.returnToTown();return 'priority class: market visit '+(visit.ok?'native town arrival':'pending');
  }
  return null;
 }
 if(require('./equipment-headroom').developmentBlocks(i)||require('./equipment-headroom').journalBlocks(i))return null;
 const source=fs.readFileSync(path.join(i.cache.dir,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
 // The newer UI adds optional per-unit buys. This adapter uses the unchanged
 // whole-listing branch only; listings with each pricing remain excluded.
 const wholeBuy=source.includes("mkSend('mbuy', { lid: id })")||source.includes("mkSend('mbuy', r && r.each && r.n > 1 ? { lid: id, n: clamp(mkBuyN[id] || 1, 1, r.n) } : { lid: id })");
 if(!wholeBuy||!source.includes("NET.social('mq', { q: mkQ, cat: mkCat, sort: mkSort, slot: mkSlot })")||!source.includes("applyDelta(m.d); if (m.rev) NET.setRev(m.rev); saveGame(); updateHUD();"))return null;
 const [item,want]=t.missing.find(([k])=>k==='Abyss Crystal')||t.missing[0],need=want-(i.lastSave.materials?.[item]||0),at=Date.now();
 let request=i.promotionMarketQuery,board;
 const pendingQuery=request?.build===i.catalog().build&&request.item===item&&fresh.fresh(request.at,60000,at);
 if(pendingQuery)board=originalReply||await i.socialLast('mk');
 // The original reply can arrive after the short polling window. Consume it
 // before the query cooldown; a delayed response never creates a second buy.
 if(!pendingQuery){
  if(!i.canDo('classMarketQuery',60000))return null;
  request={build:i.catalog().build,item,at:Date.now()};i.promotionMarketQuery=request;
  const q=await i.socialSend('mq',{q:item,cat:'mat',sort:'cheap',slot:''});if(!q?.ok){i.promotionMarketQuery=null;return null;}
  for(let n=0;n<8;n++){await sleep(250);board=await i.socialLast('mk');if(board?._receivedAt>request.at)break;}
 }
 const queryAt=request.at;
 const boardFresh=board?._receivedAt>queryAt&&fresh.fresh(board._receivedAt,10000)&&Number.isFinite(board.now);
 const demand=purchaseDemand(i,item),budget=i.lastSave.coins-t.reserve-(require('./paid-actions').heldResources(i).Copper||0),r=boardFresh?listing(board,item,demand,budget):null;
 const exact=boardFresh?(board.list||[]).filter(x=>x.kind==='stack'&&x.item===item&&x.expires>board.now):[];
 i.promotionPriorityStatus={at:Date.now(),build:i.catalog().build,status:r?'market_candidate':boardFresh?'no_affordable_listing':'awaiting_market_response',item,budget,demand,marketNow:boardFresh?board.now:null,offers:exact.map(x=>({kind:x.kind,item:x.item,id:x.id,n:x.n,price:x.price,mine:x.mine,expires:x.expires})),queryAt,receivedAt:boardFresh?board._receivedAt:null,exactListings:exact.length,lowestUnitPrice:exact.length?Math.min(...exact.map(x=>x.price/x.n).filter(Number.isFinite)):null,reason:r?'exact current native listing':boardFresh?'no affordable exact material; continue boss preparation':'no fresh market reply; continue boss preparation'};
 if(boardFresh)i.promotionMarketQuery=null;
 if(!r||!safe(i,s)||!Number.isInteger(i.lastSave.coins))return null;
 // Flush the real native saver before the budget/receipt baseline. No save
 // timestamps, materials, class or wallets are manufactured by the controller.
 if(!await i.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.online||!n.isConnected?.()||n.fixed||n.kicked||n.pause||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return false;n.handlers.resave();await n.flush();return !n.fixed&&!n.kicked&&!n.pause&&n.isConnected();})()`))return null;
 const current=target(i);if(!current||!safe(i,s)||!current.missing.some(([k,n])=>k===item&&n>(i.lastSave.materials?.[k]||0))||!listing({...board,list:[r]},item,purchaseDemand(i,item),i.lastSave.coins-current.reserve-(require('./paid-actions').heldResources(i).Copper||0)))return null;
 const dispatchContext=receipts.context(i),market=i.socialInbox?.market;
 if(!receipts.validContext(dispatchContext)||!market||market.generation!==dispatchContext.generation||market.gap||market.inFlight||market.commandConflict||i.socialInbox.criticalGap||!Number.isSafeInteger(market.sequence)||!Number.isSafeInteger(market.commandSequence)||board._generation!==dispatchContext.generation||board._nativeMarket!==true)return null;
 const row=journal.begin('market-class',{item,listingId:r.id,n:r.n,price:r.price},i.lastSave,Date.now(),i.catalog().build);if(!row)return null;
 row.context={...row.context,...dispatchContext};row.marketContractVersion=2;row.marketBaselineSequence=market.sequence;row.marketCommandSequence=market.commandSequence;
 row.externalOwner='class-market';if(current.equipment)row.legendaryObjective={goalId:current.goalId,slot:current.slot,maxSpend:current.maxSpend};row.beforeMaterial=i.lastSave.materials?.[item]||0;row.claimId=row.id;journal.save();
 const reserve=i.v2.reservations.reserve(row.claimId,{Copper:r.price},{Copper:i.lastSave.coins-current.reserve},{build:i.catalog().build});
 if(!reserve.ok){row.status='CANCELLED';journal.save();return null;}i.v2.reservations.started(row.claimId);i.v2.reservations.link(row.claimId,row.id);
 row.dispatchAt=Date.now();row.deadline=row.dispatchAt+30000;journal.save();
 try{const sent=await i.socialSend('mbuy',{lid:r.id});row.status=sent?.ok?'WAITING_CONFIRMATION':'UNCERTAIN';journal.save();if(!sent?.ok){row.reason='dispatch not acknowledged; native outcome required, no replay';i.v2.reservations.finish(row.claimId,'UNCERTAIN');journal.save();return 'class market: dispatch unknown; no replay';}}
 catch{row.status='UNCERTAIN';journal.save();i.v2.reservations.finish(row.claimId,'UNCERTAIN');return 'class market: dispatch unknown; no replay';}
 return reconcile(i,row);
}
module.exports={target,safe,purchaseDemand,listing,receiptMatches,observeMarketReply,reconcile,tick};
