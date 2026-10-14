'use strict';
const pending=new Set(['pending','unresolved','change_observed','spent_without_change','STARTED','WAITING_CONFIRMATION','UNCERTAIN','OBSERVED']);
function rows(i){return [...(i.v2?.journal?.rows||[]),...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[])].filter(r=>pending.has(r.status));}
function targets(r){return [...new Set([r.target?.id,...Object.values(r.target?.equip||{}),...Object.values(r.before?.equip||{})].filter(v=>typeof v==='string'&&v))];}
function protectedId(i,id,payment=null){return rows(i).some(r=>r!==payment&&targets(r).includes(id));}
function ownedHistoricalCraft(i,r,s=i.lastSave){
 // This authorizes independent headroom only; it does not settle or replay
 // the old craft. Its output remains protected from storage and sale.
 return r.kind==='craft'&&r.status==='OBSERVED'&&r.externalOwner==='development-ledger'&&
  typeof r.target?.id==='string'&&i.catalog().items?.[r.target.id]&&
  Object.values(s?.equip||{}).includes(r.target.id)&&r.cost&&
  Object.entries(r.cost).length>0&&Object.entries(r.cost).every(([k,n])=>Number.isSafeInteger(n)&&n>=0&&(['coins','tokens','runeDust','leaves'].includes(k)||k.startsWith('materials:')))&&r.cost.coins>0;
}
function historyIndependent(i,{action,ids=[],payment=null}={},now=Date.now()){
 if(!['capacity','deposit','surplus-sale','combat-gather'].includes(action)||!['capacity','combat-gather'].includes(action)&&(!ids.length||ids.some(id=>typeof id!=='string'||!id||protectedId(i,id,payment))))return false;
 const start=i.bagSessionStartedAt;if(!Number.isFinite(start))return false;
 if(i.v2?.journal&&!Array.isArray(i.v2.journal.rows)||i.developmentLedger&&!Array.isArray(i.developmentLedger.rows)||i.equipmentLedger&&!Array.isArray(i.equipmentLedger.rows))return false;
 const old=rows(i).filter(r=>r!==payment);
 if(!old.length)return false;
 return old.every(r=>{
  if(!Number.isFinite(r.at)||r.at>=start||now-r.at<60000)return false;
  if(r.kind==='purchase')return !r.externalOwner&&['Red Potion','Blue Potion','Orange Potion','Yellow Potion','White Potion','Starlight Potion'].includes(r.target?.item);
  if(ownedHistoricalCraft(i,r))return true;
  if(['deposit','capacity','surplus-sale'].includes(action)&&require('./closed-gear-scope').domainClosed(i,r,now))return true;
  // Old capacity/storage/transfer/craft and unknown domains remain fenced.
  // No historical target gear is moved, even when it is no longer equipped.
  return ['refine','enchant','equip'].includes(r.kind)&&targets(r).length>0;
 });
}
function independent(i,options={},now=Date.now()){
 const p=i.serverSaveReceipt?.proof,start=i.bagSessionStartedAt;
 // Boot GET may precede websocket establishment. Require a read in the current
 // generation, without treating it as proof of any historical payment result.
 return p?.authority==='server_readback'&&!!i.actorIdentity?.actorId&&p.actorId===i.actorIdentity.actorId&&p.sessionStartedAt===start&&Number.isInteger(i.socialInbox?.generation)&&p.generation===i.socialInbox.generation&&p.build===i.catalog().build&&Number.isSafeInteger(p.rev)&&p.rev>=0&&Number.isFinite(p.requestAt)&&p.requestAt>=start&&Number.isFinite(p.at)&&p.at>=p.requestAt&&p.at<=now&&rows(i).filter(r=>r.kind==='craft').every(r=>ownedHistoricalCraft(i,r,i.serverSaveReceipt.state)||require('./closed-gear-scope').independent(i,r,null,options.action,now))&&historyIndependent(i,options,now);
}
module.exports={independent,historyIndependent,protectedId};
