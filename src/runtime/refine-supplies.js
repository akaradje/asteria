'use strict';
// Native Copper-only smith supplies. One durable purchase, exact current
// bill/quantity/save proof, no premium shop and no replay of uncertain intent.
const crypto=require('node:crypto'),fresh=require('./freshness');
const fields=['equip','refine','bag','storage','stage','holes','sockets','weaponOpts','locks','keyItems','tokens','runeDust','leaves'];
function opportunity(i){
 const cat=i.catalog(),s=i.lastSave||{},r=require('../knowledge/refine-capability').nativeRules(cat.world),g=cat.world.STONES?.guard;
 if(!require('../equipment-goal').policy(cat).dynamicProgression||!r||!Number.isSafeInteger(g?.coin)||g.coin<1||!Number.isSafeInteger(g.daily)||g.daily<1)return null;
 const held=require('./paid-actions').heldResources(i),available=require('./paid-actions').inventory(s,cat),coins=Math.max(0,available.Copper-(held.Copper||0)-(require('../planning/campaign-equipment').reserve(i)?.Copper||0));
 for(const id of Object.values(s.equip||{})){
  const from=s.refine?.[id]||0;if(from<r.high||from>=r.max)continue;
  const wantedGuard=!(s.consumables?.[g.name]>0),virtual={...s,coins,consumables:{...s.consumables,[g.name]:Math.max(1,s.consumables?.[g.name]||0)}};
  const step=require('../knowledge/refine-capability').step(virtual,cat,id);if(!step||!require('../planning/combat-roi').refinement(virtual,cat,step).eligible)continue;
  if(wantedGuard&&coins>=g.coin+step.coinCost)return {kind:'guardian',selector:'[data-guard-buy]',name:g.name,group:'consumables',price:g.coin,confirmation:true,targetId:id};
  const buy=cat.world.STAR_BUY;if(step.starNeed>(s.materials?.[r.star]||0)-(held[r.star]||0)&&Number.isSafeInteger(buy?.coin)&&buy.coin>0&&coins>=buy.coin+step.coinCost)return {kind:'star',selector:'[data-star-buy="coin"]',name:r.star,group:'materials',price:buy.coin,confirmation:true,targetId:id};
 }
 return null;
}
function eligible(i){return i.status==='playing'&&i.autoChores===true&&i.livePos?.room==='town'&&!i.recycling&&!i.choresBusy&&!i.v2?.trial?.active()&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.pendingTravel&&!i.survivalRecovery&&!i.activeResourceClaim&&!i.activeDevelopmentAttempt&&i.v2?.sourceCoherence?.matches===true&&!require('./team-trade').blocksNavigation(i)&&fresh.decisionGate(i).allowed&&i.registryV32?.store?.validateOwner(i.actorOwner)===true;}
function receipt(row,after,i,{rejected=false}={}){
 if(i.actorIdentity?.actorId!==row.actorId||i.actorOwner?.session!==row.session||i.socialInbox?.generation!==row.generation)return false;
 const b=row.target.before,a=after?.state,p=after?.proof,c=row.target.context,s=row.target.supply;
 if(!p||![p.at,p.requestAt,p.rev,c.rev,row.sentAt].every(Number.isSafeInteger)||i.bagSessionStartedAt!==c.sessionStartedAt||i.catalog().build!==c.build||p.authority!=='server_readback'||p.actorId!==row.actorId||p.sessionStartedAt!==c.sessionStartedAt||p.generation!==row.generation||p.build!==c.build||p.requestAt<row.sentAt||p.at<p.requestAt||!fresh.fresh(p.at,30000)||(rejected?p.rev<c.rev:p.rev<=c.rev)||!a||a.coins!==b.coins-(rejected?0:s.price)||(a[s.group]?.[s.name]||0)!==(b[s.group]?.[s.name]||0)+(rejected?0:1))return false;
 const equal=require('./isolated-storage').equal;if(fields.some(k=>!equal(a[k],b[k])))return false;
 for(const group of ['materials','consumables'])for(const name of new Set([...Object.keys(b[group]||{}),...Object.keys(a[group]||{})]))if((a[group]?.[name]||0)!==(b[group]?.[name]||0)+(!rejected&&group===s.group&&name===s.name?1:0))return false;
 return true;
}
async function tick(i){
 if(!eligible(i)||!i.canDo?.('nativeRefineSupply',30000))return null;
 const wanted=opportunity(i);if(!wanted)return null;
 const store=i.registryV32.store;if(store.pending(i.actorIdentity.actorId).length)return null;
 const cat=i.catalog(),contract=cat.nativeSemanticContracts?.refine,window=contract?.facts?.confirmation;if(!contract?.allowed||!contract.facts.supplyCommands?.includes(wanted.kind)||!window)return null;
 return i.v2.scheduler.run('native-refine-supply',async()=>{
  i.v2.scheduler.checkpoint();if(!eligible(i))return null;const open=await i.openTownService('smithShop');if(!open?.ok)return null;
  await new Promise(r=>setTimeout(r,700));await i.eval(`(()=>{const b=document.querySelector('#pBody [data-smith="refine"]');if(b)b.click();return true;})()`);
  const baseline=await require('./native-save-probe').authoritativeReadback(i),p=baseline?.proof,current=opportunity(i);if(!eligible(i)||!p||!current||current.kind!==wanted.kind||p.actorId!==i.actorIdentity.actorId||p.generation!==i.socialInbox.generation||p.sessionStartedAt!==i.bagSessionStartedAt||p.build!==cat.build||!fresh.fresh(p.at,5000)||store.pending(p.actorId).length)return null;
  const ready=await i.eval(`(()=>{const b=document.querySelector(${JSON.stringify(current.selector)});return !!b&&!b.disabled&&b.textContent.replace(/,/g,'').includes(${JSON.stringify(String(current.price))});})()`);if(!ready)return null;
  const observer=i.socialInbox.forgeSupplies,mark=observer?.mark();if(!mark||mark.pending||mark.generation!==p.generation||i.socialInbox.criticalGap)return null;
  const row=store.begin({id:crypto.randomUUID(),actorId:p.actorId,session:i.actorOwner.session,generation:p.generation,kind:'refine:supply',bill:{Copper:current.price},available:require('./paid-actions').inventory(i.lastSave,cat),contractRevision:contract.sourceDigest,target:{supply:current,before:baseline.state,context:{...p}}});
  store.sent(row.id);let clicked=false;
  try{
   const click=()=>i.eval(`(()=>{const b=document.querySelector(${JSON.stringify(current.selector)});if(!b||b.disabled||!b.textContent.replace(/,/g,'').includes(${JSON.stringify(String(current.price))}))return false;b.click();return true;})()`);
   const at=Date.now();clicked=await click();if(clicked){await new Promise(r=>setTimeout(r,window.minimumMs+50));i.v2.scheduler.checkpoint();if(eligible(i)&&observer.generation===mark.generation&&observer.commandSequence===mark.commandSequence&&Date.now()-at<window.maximumMs)await click();}
   const observed=await require('../observability/forge-supplies').waitOutcome(observer,mark,current);
   const after=await require('./native-save-probe').authoritativeReadback(i),sent=store.get(row.id),rejected=observed.state==='rejected';
   // Recheck the whole observation lease after the GET: late/conflicting frames,
   // reconnects and foreign commands can never turn a payment into a receipt.
   const final=observer.outcome(mark,current),event=final.event;
   if(!i.socialInbox.criticalGap&&['confirmed','rejected'].includes(observed.state)&&final.state===observed.state&&event.at>=sent.sentAt&&event.at<=after?.proof?.at&&(!event.ok||Number.isSafeInteger(event.rev)&&event.rev>p.rev&&event.rev<=after.proof.rev)&&receipt(sent,after,i,{rejected})){
    store.receipt(row.id,{receiptId:'smith-supply:'+p.actorId+':'+row.id+':'+event.sequence,actorId:p.actorId,session:row.session,generation:row.generation,kind:row.kind,authority:'server_readback',at:after.proof.at,applied:!rejected,proof:{...after.proof,socket:event,delta:rejected?{}:{Copper:-current.price,[current.name]:1}}});
    i.refineSupplyStatus={at:Date.now(),id:row.id,status:rejected?'NOT_APPLIED':'CONFIRMED',kind:current.kind,price:current.price,reason:event.no,authority:'server_socket_and_readback'};return rejected?'native refinement supply rejected without charge':'native refinement supply verified';
   }
   i.refineSupplyStatus={at:Date.now(),id:row.id,status:'UNCERTAIN',replayBlocked:true,observation:observed.state};
   store.transition(row.id,'UNCERTAIN',{reason:'Native smith outcome unknown; never resend',supplyObservation:{state:final.state,op:event?.op,no:event?.no,receivedAt:event?.at,deltaValid:event?.deltaValid,readbackAt:after?.proof?.at}});return 'native refinement supply readback pending';
  }catch{store.transition(row.id,'UNCERTAIN',{reason:'Native smith exception; never resend'});return null;}finally{await i.closeGamePanel();}
 },{contract:require('./action-contract').contract(i,'native-refine-supply')});
}
module.exports={opportunity,eligible,receipt,tick};
