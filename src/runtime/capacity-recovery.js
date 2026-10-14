'use strict';
const storage=require('./personal-storage'),scope=require('./storage-payment-scope'),spare=require('./storage-spare'),native=require('./isolated-storage');
const count=spare.count;
const fields=['bag','coins','equip','refine','stage','holes','sockets','weaponOpts','plk','locks','storage','storeTier','materials','keyItems','tokens','runeDust','leaves'];
function readyCraft(i){
 const dynamic=require('../equipment-goal').policy(i.catalog()).dynamicProgression;
 const intent=i.teamTradeIntent,goal=i.capacityGoal;
 if(dynamic&&goal?.kind==='trade-gear'&&goal.build===i.catalog().build&&goal.actorId===i.actorIdentity?.actorId&&goal.receiver===i.character?.name&&Date.now()-goal.at>=0&&Date.now()-goal.at<120000&&i.tradeJournal?.id===goal.id&&i.tradeJournal.phase==='CANCELLED'&&require('./team-trade').noDispatch(i.tradeJournal)&&i.roster?.some(m=>m.charName===goal.donor))return true;
 if(dynamic&&intent?.build===i.catalog().build&&intent.phase==='GATHERING'&&intent.offer?.kind==='gear'&&intent.offer.receiver===i.character?.name&&i.roster?.some(m=>m.charName===intent.offer.donor))return true;
 if(i.endgameCampaign?.phase==='wing'&&i.endgameCampaign.ready===true)return true;
 if(!dynamic&&i.endgameCampaign?.phase!=='complete'&&!require('../planning/campaign-equipment').window(i))return false;
 const cat=i.catalog(),p=require('../character-brain').profile(i.lastSave,cat,require('../economy').loadWiki(i.root),{reserved:require('./paid-actions').heldResources(i),...require('./craft-scope').profileOptions(i),equipmentOnly:true}),c=p.craft;
 return !!(c?.ready&&c.recipeVerified&&c.verifiedBuild===cat.build&&(dynamic||cat.items[c.id]?.rarity==='legendary')&&require('../economy').canUse(cat.items[c.id],i.lastSave.job,cat.world)&&(cat.items[c.id]?.reqLv||1)<=i.lastSave.lv);
}
async function reconcile(i){
 const j=i.v2?.journal,r=j?.pending('capacity-surplus-gear');
 if(!r||r.kind!=='gear-sale'||r.scope!=='one_uninvested_nonlegendary_surplus_duplicate'||!r.baseline||r.at>=i.bagSessionStartedAt)return false;
 const options={action:'surplus-sale',ids:[r.target.id],payment:r};
 if(!require('./freshness').decisionGate(i).allowed||i.livePos?.room!=='town'||!scope.historyIndependent(i,options))return false;
 const p=await storage.access(i,options);if(!p.allowed)return false;
 const a=await native.readback(i),q=a?.proof,b=r.baseline;
 // This operation can only remove one copy and add its displayed price. A
 // closed old page plus an exact unchanged inventory/wallet proves no sale.
 if(q?.authority!=='server_readback'||q.actorId!==b.proof.actorId||q.sessionStartedAt!==i.bagSessionStartedAt||q.sessionStartedAt<=r.at||q.generation!==i.socialInbox?.generation||q.build!==b.proof.build||q.requestAt<q.sessionStartedAt||q.rev<b.proof.rev||!fields.every(k=>native.equal(a.state[k],b.state[k])))return false;
 r.previousStatus=r.status;r.status='NOT_APPLIED';r.evidence='exact_unchanged_server_readback_after_closed_sale_session';r.reconciliation=q;j.save();return true;
}
function candidates(i,plan){
 const s=i.lastSave||{},cat=i.catalog();
 return [...(plan.sell||[]),...(plan.store||[]).filter(r=>['common','uncommon','rare','epic'].includes(cat.items[r.id]?.rarity)&&count(s.storage?.gear,r.id)>0)].filter(r=>{
  const item=cat.items[r.id];
  const reviewed=item?.rarityEvidence==='reviewed_native_generator'||item?.rarityEvidence==='native_authored_table'&&['common','uncommon'].includes(item.rarity);
  if(!item||!reviewed||!['common','uncommon','rare','epic'].includes(item.rarity)||['acc','wing'].includes(item.slot)||!spare.candidate(i,r,plan).allowed||require('../gear-value').compare(s,cat,r.id).upgrade)return false;
  // Retain all copies reserved by the planner, including its stored spare.
  const retained=['equip','keep','give','store'].flatMap(k=>plan[k]||[]).filter(x=>x.id===r.id).reduce((n,x)=>n+(x.qty??1),0);
  // One retained personal-storage copy is enough for any non-Legendary tier.
  // Hoarding another bag copy must not block a verified ready upgrade.
  const stored=count(s.storage?.gear,r.id);
  return Number.isSafeInteger(retained)&&retained>=0&&count(s.bag,r.id)+stored>Math.max(1,retained);
 }).slice(0,1);
}
function receipt(row,after,i){
 const p=after?.proof,b=row.baseline?.state,a=after?.state,q=row.baseline?.proof,id=row.target.id;
 if(p?.authority!=='server_readback'||!q||p.actorId!==q.actorId||p.actorId!==i.actorIdentity?.actorId||p.generation!==q.generation||p.generation!==i.socialInbox?.generation||p.sessionStartedAt!==q.sessionStartedAt||p.build!==q.build||p.requestAt<row.sentAt||p.at<p.requestAt||p.rev<=q.rev||!b||!a||!Array.isArray(a.bag))return false;
 if(a.coins!==b.coins+row.target.price||a.bag.length!==b.bag.length-1)return false;
 const ids=new Set([...a.bag,...b.bag].map(x=>typeof x==='string'?x:x?.id));
 if([...ids].some(x=>count(a.bag,x)!==count(b.bag,x)-(x===id?1:0)))return false;
 return ['equip','refine','stage','holes','sockets','weaponOpts','plk','locks','storage','storeTier','materials','keyItems','tokens','runeDust','leaves'].every(k=>native.equal(a[k],b[k]));
}
async function sellOne(i,{minimum=1}={}){
 const deny=reason=>({sold:0,sent:false,reason});
 if(!Number.isInteger(minimum)||minimum<1||minimum>2||!(require('./wing-inventory').space(i)?.free<minimum)||!readyCraft(i))return deny('capacity-verified-ready-craft-full-bag-required');
 const plan=await i.planBag(i.roster),pick=candidates(i,plan)[0];if(!pick)return deny('capacity-no-uninvested-surplus-duplicate');
 const options={action:'surplus-sale',ids:[pick.id]},permission=await storage.access(i,options);if(!permission.allowed)return deny(permission.reason);
 const journal=i.v2?.journal;if(!journal||journal.pending('capacity-surplus-gear'))return deny('capacity-sale-awaiting-reconciliation');
 let row,dispatched=false;
 try{
  const open=await i.openTownService('gearShop');if(!open?.ok)return deny('capacity-shop-not-open');
  await i.eval(`(()=>{const b=document.querySelector('#pBody [data-shop-tab="sell"]');if(!b)return false;b.click();return true;})()`);
  const baseline=await native.readback(i);if(!baseline||!storage.allowed(i,options))return deny('capacity-native-baseline-required');
  const freshPlan=await i.planBag(i.roster);if(!candidates(i,freshPlan).some(r=>r.id===pick.id)||!native.equal(baseline.state.bag,i.lastSave.bag)||baseline.state.coins!==i.lastSave.coins)return deny('capacity-plan-changed');
  // Read one exact native UID and its displayed sale price. Never bulk-sell.
  const tile=await i.eval(`(()=>{const rows=Array.from(document.querySelectorAll('#pBody .shoprow'));for(const r of rows){const n=(r.querySelector('.iname')?.textContent||'').trim(),b=r.querySelector('[data-sell-gear]');if(n!==${JSON.stringify(pick.name)}||!b||b.disabled||b.classList.contains('warn'))continue;const p=(b.textContent||'').match(/[0-9][0-9,]*/);return p?{uid:b.dataset.sellGear,price:Number(p[0].replace(/,/g,''))}:null;}return null;})()`);
  if(!tile||!/^\d+$/.test(tile.uid)||!Number.isSafeInteger(tile.price)||tile.price<=0)return deny('capacity-native-sale-tile-required');
  row=journal.begin('gear-sale',{item:'capacity-surplus-gear',id:pick.id,uid:tile.uid,price:tile.price},i.lastSave,Date.now(),i.catalog().build);if(!row)return deny('capacity-sale-awaiting-reconciliation');
  row.baseline={proof:baseline.proof,state:Object.fromEntries(fields.map(k=>[k,baseline.state[k]]))};row.scope='one_uninvested_nonlegendary_surplus_duplicate';journal.save();
  const owned={...options,payment:row};
  const click=armed=>i.eval(`(()=>{const b=document.querySelector('#pBody [data-sell-gear="${tile.uid}"]');if(!b||b.disabled||b.classList.contains('warn')!==${armed}||b.closest('.shoprow')?.querySelector('.iname')?.textContent.trim()!==${JSON.stringify(pick.name)})return false;b.click();return true;})()`);
  if(!storage.allowed(i,owned)||!await click(false)){journal.sent(row,{ok:false,reason:'capacity-sale-not-armed'});return deny('capacity-sale-not-armed');}
  // Native sellConfirm accepts a second tap only in [400,5000) milliseconds.
  await new Promise(resolve=>setTimeout(resolve,450));
  const again=await i.planBag(i.roster);
  const stable=k=>native.equal(i.lastSave[k]??(k==='locks'?[]:{}),baseline.state[k]??(k==='locks'?[]:{}));
  // Recheck the plan without treating this exact owned intent as a competing
  // historical lock. All other pending rows remain in the candidate view.
  const candidateJournal=Object.assign(Object.create(journal),{rows:journal.rows.filter(r=>r!==row)});
  const candidateActor=Object.assign(Object.create(i),{v2:{...i.v2,journal:candidateJournal}});
  if(!storage.allowed(i,owned)||!candidates(candidateActor,again).some(r=>r.id===pick.id)||!['bag','equip','refine','stage','holes','sockets','weaponOpts','plk','locks','coins'].every(stable)){journal.sent(row,{ok:false,reason:'capacity-sale-plan-changed'});return deny('capacity-sale-plan-changed');}
  row.sentAt=Date.now();row.status='UNCERTAIN';dispatched=true;journal.save();
  if(!await click(true)){row.status='CANCELLED';journal.save();return deny('capacity-sale-not-sent');}
  const after=await native.readback(i);
  if(!receipt(row,after,i)){row.reason='capacity-sale-native-result-unconfirmed';journal.save();return {sold:0,sent:true,reason:row.reason,id:row.id};}
  row.status='CONFIRMED';row.evidence='server_readback_exact_single_sale';row.serverReceipt=after.proof;row.observedAt=after.proof.at;journal.save();
  return {sold:1,sent:true,id:row.id,item:pick.id,evidence:row.evidence};
 }catch(e){if(row){row.status=dispatched?'UNCERTAIN':'CANCELLED';row.reason='capacity-sale-interrupted';journal.save();}return {sold:0,sent:dispatched,reason:'capacity-sale-interrupted',id:row?.id};}
}
module.exports={candidates,receipt,sellOne,reconcile,readyCraft};
