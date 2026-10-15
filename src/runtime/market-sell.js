'use strict';
const fresh=require('./freshness').fresh,receipts=require('./market-receipts'),budget=require('../planning/surplus-budget'),storage=require('./isolated-storage');
function admission(i,row){if(!row||row.externalOwner!=='market-sell'||!receipts.sameContext(row.context,receipts.context(i)))return i;const journal=Object.assign(Object.create(i.v2.journal),{pending(item){return this.rows.find(r=>r.id!==row.id&&(!item||r.target?.item===item)&&['STARTED','WAITING_CONFIRMATION','UNCERTAIN','OBSERVED'].includes(r.status));}});return Object.assign(Object.create(i),{v2:{...i.v2,journal}});}
function gate(i,now=Date.now(),row=null){
 return i.machine&&!i.v2?.observation?.paused&&!i.v2?.observation?.fixed&&!i.v2?.observation?.kicked&&budget.team(i,now)&&require('./market-research').eligible(admission(i,row),{death:i.livePos?.dead},now)&&i.actorOwner&&i.registryV32?.store?.validateOwner(i.actorOwner)&&!require('./equipment-headroom').developmentBlocks(i)&&!i.socialInbox.criticalGap&&!i.socialInbox.market.gap&&!i.socialInbox.market.inFlight&&!i.socialInbox.market.commandConflict;
}
function plan(i,now=Date.now()){
 if(!gate(i,now)||typeof i.root!=='string')return null;
 const m=i.socialInbox?.market,b=m?.board,bill=budget.portfolio(i),s=i.lastSave;
 try{if(!require('../knowledge/development-source').source(i.root,i.catalog().build,i.catalog(),'market').contract.allowed)return null;}catch{return null;}
 if(!gate(i,now)||!b||!fresh(b.at,30000,now)||b.generation!==m.generation||!b.rowsValid||!bill||![b.fee,b.max].every(Number.isSafeInteger)||b.mine.filter(x=>x.status==='open'||!x.status).length>=b.max)return null;
 if((s.coins||0)-(bill.Copper||0)<b.fee)return null;
 const claims=i.teamWorkboard?.demands||[];
 for(const[item,owned]of Object.entries(s.materials||{})){
  if(!Number.isSafeInteger(owned)||owned<=0||s.locks?.includes(item)||i.teamWorkboard?.protectedNames?.includes(item)||claims.some(d=>d.name===item)||i.teamTradeIntent?.blockedMaterials?.includes(item))continue;
  const cat=i.catalog();if(cat.items[item]||cat.world.REFINE?.star===item||/ore|crystal|stone|rune|core/i.test(item))continue;
  const offers=b.list.filter(r=>r.kind==='stack'&&r.item===item&&r.mine===false&&(!r.status||r.status==='open')&&r.expires>b.serverNow&&r.unitPrice>=1);
  if(!offers.length)continue;
  const surplus=require('../planning/market-value').surplus({owned,ownNeed:bill[item]||0,buffer:100,complete:true,kind:'material'}).n,n=Math.min(10,surplus);if(!Number.isSafeInteger(n)||n<1)continue;
  const price=Math.floor(Math.min(...offers.map(r=>r.unitPrice)))*n;if(!Number.isSafeInteger(price)||price<=b.fee)continue;
  return {item,n,price,fee:b.fee,kind:'stack',boardAt:b.at,reserved:owned-n,mode:'authorized_bounded_material_listing',estimatedIncome:0};
 }
 return null;
}
async function reconcile(i,row){
 const m=i.socialInbox?.last('mkr');if(receipts.sameContext(row.context,receipts.context(i))&&receipts.listingMatches(row,m))row.nativeReceipt=structuredClone(m);
 if(receipts.listingRejected(row,m)){row.status='CANCELLED';row.reason='exact_native_listing_rejection';i.v2.reservations.finish(row.id,'CANCELLED');}
 if(row.nativeReceipt&&gate(i,Date.now(),row)&&receipts.sameContext(row.context,receipts.context(i))){
  const after=await storage.readback(i),p=after?.proof,s=after?.state,t=row.target,b=i.socialInbox.market.board;
  if(saveProof(row,after,b)){row.status='CONFIRMED';row.evidence='exact_listing_escrow_fee_server_save_and_owned_board';row.readback=structuredClone(p);i.v2.reservations.finish(row.id,'CONFIRMED');}
 }
 if(!['CONFIRMED','CANCELLED'].includes(row.status)&&Date.now()>=row.deadline){row.status='UNCERTAIN';row.reason='original_listing_never_resent';i.v2.reservations.finish(row.id,'UNCERTAIN');}
 i.v2.journal.save();i.marketSellStatus={at:Date.now(),id:row.id,status:row.status,item:row.target.item,n:row.target.n,claimedIncome:0,reason:row.reason||row.evidence};return i.marketSellStatus;
}
async function tick(i){
 const journal=i.v2?.journal;if(!journal||!i.v2.reservations)return null;
 const original=journal.rows.find(r=>r.externalOwner==='market-sell'&&!['CONFIRMED','CANCELLED'].includes(r.status));if(original){if(Date.now()-(original.lastReconcileAt||0)>30000){original.lastReconcileAt=Date.now();await reconcile(i,original);}return null;}
 if(journal.rows.some(r=>r.externalOwner==='market-sell'&&Date.now()-r.at<3600000))return null;
 let t=plan(i);if(!t)return null;
 const before=await storage.readback(i);if(!require('./closed-gear-scope').native(i)||!before||!storage.equal(before.state.materials,i.lastSave.materials)||before.state.coins!==i.lastSave.coins)return null;
 t=plan(i);if(!t)return null;i.v2.scheduler.checkpoint();
 const market=i.socialInbox.market,c={...receipts.context(i),baselineRev:before.proof.rev};if(!receipts.validContext(c))return null;
 const row=journal.begin('market-sell',t,i.lastSave,Date.now(),c.build);if(!row)return null;
 Object.assign(row,{externalOwner:'market-sell',context:c,marketContractVersion:3,marketBaselineSequence:market.sequence,marketCommandSequence:market.commandSequence,beforeMaterial:before.state.materials[t.item],nativeBefore:structuredClone(before.state),beforeMine:market.board.mine.map(r=>r.id)});journal.save();
 const cost={Copper:t.fee,[t.item]:t.n},held=i.v2.reservations.reserve(row.id,cost,budget.reservationWindow(i,cost),{build:c.build});if(!held.ok){row.status='CANCELLED';journal.save();return null;}
 i.v2.reservations.started(row.id);i.v2.reservations.link(row.id,row.id);row.dispatchAt=Date.now();row.deadline=row.dispatchAt+30000;row.status='WAITING_CONFIRMATION';journal.save();
 try{const sent=await i.socialSend('mlist',{kind:'stack',name:t.item,n:t.n,price:t.price});if(!sent?.ok)throw Error('dispatch_unknown');}catch{row.status='UNCERTAIN';row.reason='single_dispatch_outcome_unknown_no_replay';journal.save();i.v2.reservations.finish(row.id,'UNCERTAIN');}
 return reconcile(i,row);
}
function saveProof(row,after,b){const p=after?.proof,s=after?.state,t=row.target,original=row.nativeBefore;if(!original||!s||p?.authority!=='server_readback'||p.actorId!==row.context.actorId||p.generation!==row.context.generation||p.build!==row.context.build||p.sessionStartedAt!==row.context.sessionStartedAt||p.requestAt<row.nativeReceipt._receivedAt||p.rev<row.nativeReceipt.rev||s.coins!==original.coins-t.fee||(s.materials?.[t.item]||0)!==row.beforeMaterial-t.n||!b||b.generation!==row.context.generation||b.at<row.nativeReceipt._receivedAt||!b.mine.some(x=>!(row.beforeMine||[]).includes(x.id)&&x.kind==='stack'&&x.item===t.item&&x.n===t.n&&x.price===t.price&&x.status==='open'))return false;
 const expected={...original.materials,[t.item]:row.beforeMaterial-t.n};if(!expected[t.item])delete expected[t.item];if(!storage.equal(s.materials,expected))return false;
 return ['tokens','runeDust','leaves','equip','refine','stage','holes','sockets','weaponOpts','petOpts','petActive','pets','bag','keyItems','consumables','plk'].every(k=>storage.equal(s[k],original[k]));}
module.exports={admission,gate,plan,tick,reconcile,saveProof};
