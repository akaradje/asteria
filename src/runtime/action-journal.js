'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function state(s={}){return {coins:s.coins||0,potions:s.potions||0,bagTier:s.bagTier||0,storeTier:s.storeTier||0,consumables:{...(s.consumables||{})},sockets:s.sockets||{},cards:s.cards||{}};}
const unresolved=['WAITING_CONFIRMATION','UNCERTAIN','STARTED','OBSERVED'];
class ActionJournal{
 constructor(root,identity){this.file=path.join(root,'logs','actions',crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0,16)+'.json');try{this.rows=(require('./canonical-document').existing(root,this.file)||JSON.parse(fs.readFileSync(this.file))).rows;if(!Array.isArray(this.rows))throw Error('invalid rows');}catch(e){if(e.code!=='ENOENT')throw Error('action journal unreadable; paid work must stop');this.rows=[];}this.document=require('./canonical-document').open(root,this.file,{version:1,rows:this.rows});if(this.document)this.rows=this.document.data.rows;
  let changed=false;for(const r of this.rows)if(r.status==='CONFIRMED'&&r.evidence==='outgoing_client_save'){r.previousStatus='CONFIRMED';r.status='OBSERVED';r.reason='Legacy client-only confirmation quarantined; native evidence required';changed=true;}if(changed)this.save();}
 save(){const data={version:1,rows:this.rows};require('./canonical-document').save(this.document,data);fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(data));fs.renameSync(this.file+'.tmp',this.file);}
 reconcilePurchaseLoad(save,{at,sessionStartedAt,rev}={}){
  if(!Number.isFinite(save?.lv)||!Number.isFinite(save?.coins)||!Number.isFinite(at)||!Number.isFinite(sessionStartedAt)||at<=sessionStartedAt||!Number.isInteger(rev)||rev<0)return false;
  let changed=false;for(const r of this.rows){
   if(r.kind!=='purchase'||r.externalOwner||!unresolved.includes(r.status)||!Number.isFinite(r.at)||r.at>=sessionStartedAt)continue;
   // The old page has closed and this page has loaded the server's character.
   // Consumed potions cannot prove the old payment result. Keep it uncertain
   // and replay-blocked; only record that it no longer owns a live session.
   r.status='UNCERTAIN';r.closedSessionEvidence={kind:'authoritative_server_load_after_session_restart',sessionStartedAt,at,rev,outcome:'unknown',replayBlocked:true};changed=true;
  }if(changed)this.save();return changed;
 }
 reconcileBagLoad(save,{at,sessionStartedAt,rev}={}){if(!Number.isInteger(save?.bagTier)||!Number.isFinite(at)||!Number.isFinite(sessionStartedAt)||!Number.isInteger(rev)||rev<0)return false;let changed=false;for(const r of this.rows){if(!['bag-upgrade','storage-upgrade'].includes(r.kind)||r.externalOwner||!unresolved.includes(r.status)||sessionStartedAt<=r.at||at<=sessionStartedAt)continue;
  const field=r.kind==='storage-upgrade'?'storeTier':'bagTier';if(!Number.isInteger(save[field]))continue;
  if(save[field]===r.target.fromTier){r.status='NOT_APPLIED';r.reason='Fresh server load after the previous session closed confirms unchanged capacity tier';}
  else if(save[field]>=r.target.fromTier+1){r.status='CONFIRMED';r.reason='Fresh server load confirms the purchased capacity tier';}else continue;
  r.evidence='authoritative_server_load_after_session_restart';r.observedAt=at;r.reconciliation={[field]:save[field],rev,sessionStartedAt};changed=true;}if(changed)this.save();return changed;}
 pending(item){return this.rows.find(r=>(!item||r.target.item===item)&&unresolved.includes(r.status));}
 supplyBlock(item,save,{minimum,limit,at,saveAt,sessionStartedAt}={}){
  const rows=this.rows.filter(r=>r.target?.item===item&&unresolved.includes(r.status));
  if(!rows.length)return null;
  const hp=['Red Potion','Orange Potion','Yellow Potion','White Potion'];
  const total=(save?.potions||0)+hp.slice(1).reduce((n,k)=>n+(save?.consumables?.[k]||0),0);
  const newNeed=hp.includes(item)&&Number.isInteger(total)&&total>=0&&Number.isInteger(minimum)&&minimum>total&&minimum<=80&&Number.isInteger(limit)&&limit>0&&limit<=20&&Number.isFinite(at)&&Number.isFinite(saveAt)&&saveAt<=at&&at-saveAt<30000&&Number.isFinite(sessionStartedAt)&&sessionStartedAt<saveAt;
  return rows.find(r=>!newNeed||r.kind!=='purchase'||r.externalOwner||r.status!=='UNCERTAIN'||r.closedSessionEvidence?.kind!=='authoritative_server_load_after_session_restart'||r.closedSessionEvidence.outcome!=='unknown'||r.closedSessionEvidence.replayBlocked!==true||!Number.isInteger(r.closedSessionEvidence.rev)||r.closedSessionEvidence.rev<0||!Number.isFinite(r.closedSessionEvidence.at)||r.closedSessionEvidence.at<=r.closedSessionEvidence.sessionStartedAt||r.closedSessionEvidence.at>saveAt||r.closedSessionEvidence.sessionStartedAt>sessionStartedAt||r.at>=r.closedSessionEvidence.sessionStartedAt)||null;
 }
 beginSupply(item,save,at,build,options){
  if(this.supplyBlock(item,save,{...options,at}))return null;
  const prior=this.rows.filter(r=>r.target?.item===item&&r.status==='UNCERTAIN');
  if(!prior.length){const row=this.begin('purchase',{item},save,at,build);if(row){row.requiresDispatchBaseline=true;this.save();}return row;}
  // A fresh stock deficit is a separate bounded purchase, never a resend of
  // the original operation. Keep every original outcome and replay block.
  const row={id:crypto.randomUUID(),kind:'purchase',target:{item},build,at,deadline:at+30000,status:'STARTED',requiresDispatchBaseline:true,before:state(save),context:this.context?.(),evidence:'awaiting_client_save',independentRestock:{minimum:options.minimum,limit:options.limit,stockObservedAt:options.saveAt,quarantinedIds:prior.map(r=>r.id)}};
  this.rows.unshift(row);this.save();return row;
 }
 purchaseDispatch(row,save,at){
  if(row?.kind!=='purchase'||row.status!=='STARTED'||!this.rows.includes(row)||!Number.isFinite(at))return false;
  row.beforeTravel=row.before;row.before=state(save);row.context=this.context?.();row.dispatchAt=at;row.deadline=at+30000;this.save();return true;
 }
 begin(kind,target,save,at,build){if(this.pending(target.item))return null;const row={id:crypto.randomUUID(),kind,target,build,at,deadline:at+30000,status:'STARTED',before:state(save),context:this.context?.(),evidence:'awaiting_client_save'};this.rows=[row,...this.rows.filter(r=>unresolved.includes(r.status)),...this.rows.filter(r=>!unresolved.includes(r.status)).slice(0,119)];this.save();return row;}
 sent(row,result){if(!['CONFIRMED','OBSERVED'].includes(row.status))row.status=result?.ok?'WAITING_CONFIRMATION':'CANCELLED';if(row.kind==='purchase'&&Number.isSafeInteger(result?.quantity)&&result.quantity>0&&Number.isSafeInteger(result?.price)&&result.price>0)row.expectedCoins=result.quantity*result.price;row.reason=result?.reason||result?.skip;this.save();}
  observe(save,at){let changed=false;for(const r of this.rows.filter(r=>!r.externalOwner&&!r.closedSessionEvidence&&['WAITING_CONFIRMATION','UNCERTAIN','STARTED'].includes(r.status))){if(r.requiresDispatchBaseline&&!r.dispatchAt||at<=(r.dispatchAt||r.at))continue;const old=r.status,after=state(save),key=r.target.item,beforeQty=key==='Red Potion'?r.before.potions:r.before.consumables[key]||0,qty=key==='Red Potion'?after.potions:after.consumables[key]||0;
  const card=r.kind==='card'&&save.sockets?.[r.expected?.id]?.[r.expected?.index]===r.expected?.card&&(save.cards?.[r.expected?.card]||0)<r.expected?.cardCount;
  const bag=r.kind==='bag-upgrade'&&Number.isInteger(save.bagTier)&&save.bagTier>r.before.bagTier&&save.bagTier===r.target.fromTier+1;
  const store=r.kind==='storage-upgrade'&&Number.isInteger(save.storeTier)&&save.storeTier>r.before.storeTier&&save.storeTier===r.target.fromTier+1;
  if((r.kind==='purchase'&&qty>beforeQty)||card||bag||store){r.status='OBSERVED';r.evidence='outgoing_client_save';r.after=after;r.observedAt=at;r.cost={coins:r.before.coins-after.coins};r.reason='Client state observed; exact native confirmation pending';}
  else if(at>=r.deadline){r.status='UNCERTAIN';r.reason='Inventory increase not observed; reconcile before retry';}
  if(old!==r.status)changed=true;}if(changed)this.save();
 }
 acknowledgeAcceptedSave(save,proof){
  if(proof?.authority!=='server_accepted_save'||!Number.isInteger(proof.rev)||!Number.isFinite(proof.at)||!Number.isFinite(proof.requestAt))return false;
  this.observe(save,proof.requestAt);let dirty=false;const after=state(save);
  for(const r of this.rows){const c=r.context;if(r.externalOwner||!unresolved.includes(r.status)||!c||!Number.isInteger(c.baselineRev)||proof.rev<=c.baselineRev||proof.requestAt<=(r.dispatchAt||r.at)||proof.at<proof.requestAt||c.actorId!==proof.actorId||c.generation!==proof.generation||c.sessionStartedAt!==proof.sessionStartedAt||c.build!==proof.build)continue;
   const price=r.kind==='purchase'?r.expectedCoins:['bag-upgrade','storage-upgrade'].includes(r.kind)?r.target.price:null;
   const cost=r.before.coins-after.coins;let matches=false;
   if(r.kind==='purchase'){const key=r.target.item,old=key==='Red Potion'?r.before.potions:r.before.consumables[key]||0,qty=key==='Red Potion'?after.potions:after.consumables[key]||0;matches=qty>old&&Number.isSafeInteger(price)&&price>0&&cost===price;}
   if(['bag-upgrade','storage-upgrade'].includes(r.kind)){const key=r.kind==='bag-upgrade'?'bagTier':'storeTier';matches=after[key]===r.target.fromTier+1&&Number.isSafeInteger(price)&&price>0&&cost===price;}
   if(r.kind==='card'){const e=r.expected;matches=e&&after.sockets[e.id]?.[e.index]===e.card&&after.cards[e.card]===e.cardCount-1&&cost===0;}
   if(!matches)continue;r.status='CONFIRMED';r.evidence='server_accepted_exact_save_revision';r.after=after;r.cost={coins:cost};r.observedAt=proof.at;r.serverReceipt={rev:proof.rev,requestAt:proof.requestAt,at:proof.at,actorId:c.actorId,generation:c.generation,sessionStartedAt:c.sessionStartedAt,build:c.build};delete r.reason;dirty=true;
  }if(dirty)this.save();return dirty;
 }
 view(){return this.rows.slice(0,8).map(({before,after,context,...r})=>({...r,confirmationState:r.status==='CONFIRMED'&&r.evidence==='outgoing_client_save'?'OBSERVED':r.status,serverConfirmed:r.status==='CONFIRMED'&&['authoritative_server_load_after_session_restart','server_state_observed','server_accepted_exact_save_revision'].includes(r.evidence),legacyStatus:r.status}));}
 server(type,at,build,state){let dirty=false;for(const r of this.rows)if(r.build===build&&r.expected?.serverType===type&&r.expected?.serverRunId!=null&&(state?.run?.id??state?.id)===r.expected.serverRunId&&at>r.at&&at<r.deadline&&['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status)){r.status='CONFIRMED';r.evidence='server_state_observed';r.observedAt=at;dirty=true;}if(dirty)this.save();}
 importLedger(rows,build){let dirty=false;for(const r of rows||[]){const id='development:'+r.id;let own=this.rows.find(x=>x.id===id);if(!own){own={id,kind:r.kind,target:r.target||{},build,at:r.at,externalOwner:'development-ledger',deadline:r.at+30000,legacyIdentityUnknown:r.legacyIdentityUnknown===true,originalSha256:r.originalSha256||null};this.rows.unshift(own);dirty=true;}let status={reconciled_craft_unknown:'RECONCILED',reconciled_refine_state:'RECONCILED',reconciled_craft_state:'RECONCILED',pending:'WAITING_CONFIRMATION',change_observed:'OBSERVED',spent_without_change:'OBSERVED',not_sent:'CANCELLED',server_confirmed:'CONFIRMED',server_no_increase:'FAILED',reconciled_increase:'CONFIRMED',reconciled_no_increase:'FAILED',reconciled_equip_state:'CONFIRMED'}[r.status]||'UNCERTAIN';if(r.status==='reconciled_craft_unknown'&&require('./native-reservation-result').result(r,r.context?.actorId)!=='RECONCILED')status='UNCERTAIN';if(['CONFIRMED','FAILED'].includes(status)&&r.evidence!=='server_accepted_exact_save_revision')status='OBSERVED';if(own.status!==status){Object.assign(own,{status,evidence:r.evidence,cost:r.cost,observedAt:r.finishedAt,reconciliation:r.reconciliation});dirty=true;}}this.rows=[...this.rows.filter(r=>unresolved.includes(r.status)),...this.rows.filter(r=>!unresolved.includes(r.status)).slice(0,120)];if(dirty)this.save();}
}
module.exports={ActionJournal};
