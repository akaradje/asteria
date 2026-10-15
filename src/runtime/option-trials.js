'use strict';
const storage=require('./isolated-storage'),combat=require('../learning/combat-evidence'),budget=require('../planning/surplus-budget');
const same=(a,b)=>storage.equal(a,b),terminal=r=>['CONFIRMED','CANCELLED'].includes(r.status);
function baseline(i,now=Date.now()){
 const signature=combat.loadout(i.socialInbox.power?.enrich?.(i,{...i.lastSave})||i.lastSave),rows=i.combatEvidence?.data?.windows||[];
 return require('../learning/combat-windows').aggregate(rows,{now}).map(combat.metrics).filter(r=>r.actorId===i.actorIdentity?.actorId&&r.build===i.catalog().build&&r.sourceSignature===i.v2.loadedSourceIdentity.signature&&r.session===i.actorOwner.session&&r.generation===i.socialInbox.generation&&r.loadoutSignature===signature&&r.ready&&r.observedMs>=300000&&!r.confounded&&!r.deaths&&r.at<=now&&now-r.at<3600000).at(-1)||null;
}
function improvement(a,b){
 if(!a||!b||!b.ready||a.observedMs<300000||b.observedMs<300000||b.confounded||b.deaths||b.startedAt<a.at||!['actorId','build','sourceSignature','session','generation','job','level','role','map','target','party'].every(k=>a[k]===b[k]))return false;
 if((a.hasParty||b.hasParty)&&(!a.partySupport?.completeParty||!b.partySupport?.completeParty||a.partyObservationSignature!==b.partyObservationSignature))return false;
 if(a.role==='dps')return a.dps>0&&b.dps>=a.dps*1.05&&a.killsPerHour>0&&b.killsPerHour>=a.killsPerHour*1.05;
 if(a.role==='tank')return a.damageTakenPerSecond>0&&b.damageTakenPerSecond<=a.damageTakenPerSecond*.95&&b.potionsPerMinute<=a.potionsPerMinute&&b.killsPerHour>=a.killsPerHour*.8;
 const x=a.partySupport,y=b.partySupport;return a.partyObservationSignature===b.partyObservationSignature&&x?.completeParty&&y?.completeParty&&y.zeroDeathSustainedMs>=300000&&y.healingApplied>x.healingApplied&&y.healEventsPerMinute>=x.healEventsPerMinute&&Object.keys(y.buffRecipientUptime||{}).every(k=>(y.buffRecipientUptime[k]||0)>=(x.buffRecipientUptime?.[k]||0));
}
function review(i){
 const rows=(i.v2?.journal?.rows||[]).filter(r=>r.externalOwner==='option-trial'),old=rows[0];
 if(old&&!terminal(old))return {allowed:false,reason:'original_option_outcome_uncertain_no_replay'};
 if(old?.status==='CONFIRMED'&&old.trialState!=='MEASURED_GAIN'){
  const after=(i.combatEvidence?.data?.windows||[]).map(combat.metrics).find(r=>r.startedAt>=old.observedAt&&r.loadoutSignature===old.afterSignature&&improvement(old.combatBefore,r));
  if(after){old.trialState='MEASURED_GAIN';old.combatAfter=after;old.estimatedBenefit=false;i.v2.journal.save();i.v2.trial?.releasePaid(i,old);}
  else return {allowed:false,reason:'comparable_post_roll_combat_required_before_next_attempt'};
 }
 if(old&&Date.now()-old.at<86400000)return {allowed:false,reason:'one_serialized_option_attempt_per_actor_per_day'};
 return {allowed:true};
}
function plan(i,kind='w'){
 const s=i.lastSave,id=kind==='p'?s.petActive:s.equip?.weapon,cat=i.catalog();if(!id||!['w','p'].includes(kind))return null;
 const lines=(kind==='p'?s.petOpts:s.weaponOpts)?.[id]||[null,null,null];if(!Array.isArray(lines)||lines.length!==3||lines.some(o=>o&&(!Number.isFinite(o.v)||!Number.isInteger(o.s)||o.s<1||o.s>5)))return null;
 const weights=require('../knowledge/modifier-effects').roleWeights(s.job,cat.world),locks=lines.map(o=>!!o); // Fill only empty lines; never gamble an existing useful line.
 if(locks.every(Boolean))return null;
 const mon=cat.world.MONSTERS?.find(m=>m.id===id),tier=kind==='p'?Math.max(1,Math.min(5,Math.ceil((mon?.level||0)/24))):cat.items[id]?.tier;
 if(kind==='p'&&(!mon?.level||!require('../knowledge/pet-option-rules').stats(lines,mon.level,require('../knowledge/pet-option-rules').read(i.root,cat.build)).complete))return null;
 if(!Number.isInteger(tier)||tier<1||tier>5||kind==='p'&&!s.pets?.[id])return null;
 const cost={Copper:100*tier*tier,'Rune Dust':Math.round(15*tier*(1+.5*locks.filter(Boolean).length)),'Guild Token':(locks[0]?1:0)+(locks[1]?1:0)+(locks[2]?2:0)};
 if(cost.Copper>Math.floor(s.coins*.01)||!budget.available(i,cost).allowed)return null;
 return {id,kind,lines,locks,cost,rune:0,star:0,rolePrior:weights};
}
function outcome(row,reply,receipt,i){
 const t=row.target,p=receipt?.proof,s=receipt?.state,c=reply?.command;
 if(!reply||reply.generation!==row.context.generation||reply.at<row.dispatchAt||reply.op!=='ench'||!reply.ok||reply.no||!c||c.at<row.dispatchAt||c.id!==t.id||c.kind!==t.kind||!same(c.locks,t.locks)||c.rune!==0||c.star!==0||reply.res?.id!==t.id||reply.res?.kind!==t.kind||!same(reply.res.locks,t.locks)||!Number.isSafeInteger(reply.rev)||reply.rev<=row.context.baselineRev)return false;
 const delta=require('../observability/market-state').delta(reply.d);if(!delta.valid||!same(delta.value,Object.fromEntries(Object.entries({coins:-t.cost.Copper,dust:-t.cost['Rune Dust'],tokens:-t.cost['Guild Token']}).filter(([,n])=>n!==0))))return false;
 if(p?.authority!=='server_readback'||p.actorId!==row.context.actorId||p.build!==row.context.build||p.sessionStartedAt!==row.context.sessionStartedAt||p.generation!==row.context.generation||p.requestAt<reply.at||p.rev<reply.rev||!s||i.actorOwner.session!==row.ownerSession)return false;
 if(['coins','runeDust','tokens'].some((k,n)=>s[k]!==row.nativeBefore[k]-[t.cost.Copper,t.cost['Rune Dust'],t.cost['Guild Token']][n]))return false;
 const lines=(t.kind==='p'?s.petOpts:s.weaponOpts)?.[t.id];if(!same(lines,reply.res.lines)||t.locks.some((l,n)=>l&&!same(lines?.[n],t.lines[n])))return false;
 const field=t.kind==='p'?'petOpts':'weaponOpts',other=t.kind==='p'?'weaponOpts':'petOpts',rest={...(s[field]||{})};if(row.nativeBefore[field]?.[t.id]===undefined)delete rest[t.id];else rest[t.id]=row.nativeBefore[field][t.id];
 return same(rest,row.nativeBefore[field]||{})&&same(s[other],row.nativeBefore[other])&&['equip','refine','stage','holes','sockets','pets','petActive','materials','keyItems','consumables','plk'].every(k=>same(s[k],row.nativeBefore[k]));
}
async function tick(i){
 if(!review(i).allowed||!require('./market-sell').gate(i)||i.v2.journal.pending()||!baseline(i)||!budget.team(i))return null;
 const selected=plan(i,'w')||plan(i,'p');if(!selected)return null;
 if(!require('../knowledge/development-source').check(i.root,i.catalog().build,'enchant',[],i.catalog(),null,i.lastSave).allowed)return null;
 const opened=await i.openTownService('enchanter');if(!opened?.ok)return null;
 try{
  await i.eval(`(()=>{const p=document.getElementById('pBody');if(p?.dataset.panel!=='enchant')return false;for(const [attr,value]of [['data-en-tab','roll'],['data-en-kind',${JSON.stringify(selected.kind)}],['data-en-w',${JSON.stringify(selected.id)}]]){const b=Array.from(p.querySelectorAll('['+attr+']')).find(b=>b.getAttribute(attr)===value);if(!b)return false;if(!b.classList.contains('on'))b.click();}return true;})()`);
  const before=await storage.readback(i);if(!before||!require('./closed-gear-scope').native(i)||!['equip','weaponOpts','petOpts','coins','runeDust','tokens'].every(k=>same(before.state[k],i.lastSave[k])))return null;
  const t=plan(i,selected.kind);if(!t||t.id!==selected.id||!same(t.lines,selected.lines)||!budget.available(i,t.cost).allowed)return null;
  const prepared=await i.eval(`(()=>{const p=document.getElementById('pBody');if(p?.dataset.panel!=='enchant'||p.querySelector('[data-en-kind].on')?.dataset.enKind!==${JSON.stringify(t.kind)}||p.querySelector('[data-en-w].on')?.dataset.enW!==${JSON.stringify(t.id)})return false;const locks=${JSON.stringify(t.locks)};for(let n=0;n<3;n++){const b=p.querySelector('[data-en-lock="'+n+'"]');if(!b)return false;if(b.classList.contains('on')!==locks[n]){if(b.disabled)return false;b.click();}}for(const attr of ['data-en-rune','data-en-star']){const b=p.querySelector('['+attr+']');if(b?.checked)b.click();}const costs=Array.from(p.querySelectorAll('.en-go .ex-cost .chip b')).map(b=>Number(b.textContent.replace(/[^0-9]/g,'')));return JSON.stringify(costs)===JSON.stringify(${JSON.stringify([t.cost['Rune Dust'],t.cost.Copper,...(t.cost['Guild Token']?[t.cost['Guild Token']]:[])])})&&!!p.querySelector('[data-en-go]:not(:disabled)');})()`);
  if(!prepared||!require('./market-sell').gate(i)||!review(i).allowed)return null;
  const row=i.v2.journal.begin('option-trial',t,i.lastSave,Date.now(),i.catalog().build);if(!row)return null;
  Object.assign(row,{externalOwner:'option-trial',context:{...require('./market-receipts').context(i),baselineRev:before.proof.rev},ownerSession:i.actorOwner.session,nativeBefore:structuredClone(before.state),combatBefore:baseline(i),trialState:'SINGLE_ATTEMPT',powerBeforeEstimate:require('../gear-value').totals(before.state,i.catalog()).score,nativeVitalsBefore:structuredClone(i.vitals)});i.v2.journal.save();
  const available=budget.reservationWindow(i,t.cost);if(!i.v2.reservations.reserve(row.id,t.cost,available,{build:row.build}).ok){row.status='CANCELLED';i.v2.journal.save();return null;}
  if(!i.v2.trial?.acquirePaid(i,row.id)){row.status='CANCELLED';row.reason='host_serialized_experiment_held';i.v2.reservations.finish(row.id,'CANCELLED');i.v2.journal.save();return null;}
  i.v2.reservations.started(row.id);i.v2.reservations.link(row.id,row.id);i.v2.scheduler.checkpoint();row.dispatchAt=Date.now();row.status='WAITING_CONFIRMATION';i.v2.journal.save();
  try{
   // One native doEnchant callback performs native save/flush/social dispatch.
   const hit=await i.eval(`(()=>{const n=window.AsteriaNet,p=document.getElementById('pBody'),b=p?.querySelector('[data-en-go]');if(!n?.online||!n.isConnected?.()||n.pause||n.fixed||n.kicked||!b||b.disabled||b.textContent.includes('ยืนยัน')||p.querySelector('[data-en-w].on')?.dataset.enW!==${JSON.stringify(t.id)}||p.querySelector('[data-en-kind].on')?.dataset.enKind!==${JSON.stringify(t.kind)}||${JSON.stringify(t.locks)}.some((v,n)=>p.querySelector('[data-en-lock=\"'+n+'\"]')?.classList.contains('on')!==v)||p.querySelector('[data-en-rune]')?.checked||p.querySelector('[data-en-star]')?.checked)return false;b.click();return true;})()`);
   if(!hit)throw Error('sole_callback_not_observed');
   const until=Date.now()+10000;let reply;while(Date.now()<until){reply=i.socialInbox.power.combat.forge;if(reply?.at>=row.dispatchAt)break;await new Promise(r=>setTimeout(r,100));}
   const after=await storage.readback(i);if(!outcome(row,reply,after,i))throw Error('exact_option_outcome_unproven');
   row.status='CONFIRMED';row.nativeReceipt=structuredClone(reply);row.readback=structuredClone(after.proof);row.observedAt=after.proof.at;row.afterSignature=combat.loadout(i.socialInbox.power.enrich(i,{...after.state}));row.powerAfterEstimate=require('../gear-value').totals(after.state,i.catalog()).score;row.trialState='WAIT_COMPARABLE_COMBAT';row.evidence='exact_native_forge_payment_retained_lines_and_server_readback';i.v2.reservations.finish(row.id,'CONFIRMED');
  }catch{row.status='UNCERTAIN';row.reason='original_option_attempt_never_resent';i.v2.reservations.finish(row.id,'UNCERTAIN');}
  i.v2.journal.save();i.optionTrialStatus={at:Date.now(),id:row.id,status:row.status,kind:t.kind,trialState:row.trialState,measuredBenefit:false,reason:row.reason||row.evidence};return i.optionTrialStatus;
 }finally{await i.closeGamePanel().catch(()=>{});}
}
module.exports={baseline,improvement,review,plan,outcome,tick};
