'use strict';
const crypto=require('node:crypto'),fresh=require('./freshness');
const pendingStatus=new Set(['pending','unresolved','change_observed','spent_without_change','STARTED','WAITING_CONFIRMATION','UNCERTAIN','OBSERVED','INTENT','SENT']);
const stableFields=['equip','refine','stage','holes','sockets','weaponOpts','plk','locks'];
const count=(rows,id)=>(rows||[]).filter(g=>(typeof g==='string'?g:g?.id)===id).length;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null));
// The native saver omits false up/lk flags; outgoing telemetry explicitly adds
// those booleans. Compare that same bounded projection, not raw JSON shapes.
// Unknown fields/flag values are not silently discarded.
function gearProjection(rows){
 if(!Array.isArray(rows)||rows.length>250||rows.some(g=>!g||typeof g!=='object'||Array.isArray(g)||typeof g.id!=='string'||!g.id||Object.keys(g).some(k=>!['id','up','lk'].includes(k))||['up','lk'].some(k=>g[k]!==undefined&&![0,1,false,true].includes(g[k]))))return null;
 return rows.map(g=>({id:g.id,up:!!g.up,lk:!!g.lk}));
}
function sameGearProjection(a,b){const x=gearProjection(a),y=gearProjection(b);return !!x&&!!y&&equal(x,y);}
function unrelated(i,id,now=Date.now()){
 const start=i.bagSessionStartedAt;
 if(!Number.isFinite(start)||start>=now)return false;
 const rows=[...(i.v2?.journal?.rows||[]),...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[]),...(i.registryV32?.store?.pending(i.actorIdentity?.actorId)||[])];
 // Known closed-session item/capacity domains only. Unknown targets stay fenced.
 return rows.filter(r=>pendingStatus.has(r.status)).every(r=>{
  if(!Number.isFinite(r.at)||r.at>=start||now-r.at<60000)return false;
  if(['bag-upgrade','storage-upgrade'].includes(r.kind))return Number.isInteger(r.target?.fromTier);
  if(['craft','refine','enchant','stage','drill','equip'].includes(r.kind)){
   const targets=[r.target?.id,...Object.values(r.target?.equip||{})].filter(x=>typeof x==='string'&&x.length);
   if(!targets.length)return false;
   return !targets.includes(id)&&!Object.values(r.before?.equip||{}).includes(id);
  }
  if(r.kind==='purchase')return ['Red Potion','Blue Potion','Orange Potion','Yellow Potion','White Potion'].includes(r.target?.item);
  return false;
 });
}
function gate(i,id,now=Date.now(),plan){
 const deny=reason=>({allowed:false,reason});
 if(!id||!i.actorIdentity?.actorId||!i.actorOwner||!i.registryV32?.store?.validateOwner(i.actorOwner))return deny('storage-owned-native-actor-required');
 if(!fresh.decisionGate(i,now).allowed||i.v2?.sourceCoherence?.matches!==true||!fresh.fresh(i.vitals?.at,15000,now)||i.vitals.hp<.85||i.livePos?.dead||i.livePos?.room!=='town')return deny('storage-fresh-owned-town-required');
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||i.recycling||i.v2?.trial?.active()||i.survivalRecovery||i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))return deny('storage-other-owner-or-trade-active');
 if(!require('./storage-spare').inspect(i,id,plan).allowed||!unrelated(i,id,now))return deny('storage-gear-footprint-not-independent');
 const s=i.lastSave,cap=i.catalog().world.storeCap?.(s.storeTier);
 if(!Number.isFinite(cap)||!Array.isArray(s.storage?.gear)||s.storage.gear.length>=cap)return deny('storage-free-existing-slot-required');
 return {allowed:true,reason:'free-personal-gear-deposit-only'};
}
function result(row,receipt,i){
 const p=receipt?.proof,s=receipt?.state,t=row?.target;
 if(!t||p?.authority!=='server_readback'||p.actorId!==row.actorId||p.generation!==row.generation||p.sessionStartedAt!==t.sessionStartedAt||p.build!==t.build||p.requestAt<row.sentAt||p.at<p.requestAt||p.rev<=t.beforeRev||i.actorOwner.session!==row.session)return null;
 if(!Array.isArray(s?.bag)||!Array.isArray(s.storage?.gear)||s.storeTier!==t.before.storeTier)return null;
 if(t.retainedCopies!=null&&(!Number.isSafeInteger(t.retainedCopies)||t.retainedCopies<0||count(s.bag,t.id)<t.retainedCopies))return null;
 if(stableFields.some(k=>!equal(s[k],t.before[k])))return null;
 // Native stMove appends one plain entry. Existing stored entries, their
 // order and all original flags must remain exactly unchanged.
 const beforeGear=t.before.storage.gear,afterGear=s.storage.gear;
 if(afterGear.length!==beforeGear.length+1||!equal(afterGear.slice(0,-1),beforeGear))return null;
 const added=afterGear.at(-1);
 if(!gearProjection([added])||added.id!==t.id||added.up||added.lk)return null;
 const ids=new Set([...t.before.bag,...s.bag,...t.before.storage.gear,...s.storage.gear].map(g=>typeof g==='string'?g:g?.id));
 for(const id of ids){if(count(s.bag,id)!==count(t.before.bag,id)-(id===t.id?1:0)||count(s.storage.gear,id)!==count(t.before.storage.gear,id)+(id===t.id?1:0))return null;}
 if(s.bag.some(g=>typeof g==='object'&&String(g?.uid)===t.uid)||s.storage.gear.some(g=>g.id===t.id&&(g.up||g.lk)))return null;
 if(['coins','tokens','runeDust','leaves'].some(k=>(s[k]||0)!==(t.before[k]||0))||!equal(s.materials,t.before.materials)||!equal(s.keyItems,t.before.keyItems))return null;
 return {id:t.id,uiUid:t.uid,bagDelta:-1,personalStorageDelta:1,rev:p.rev,currencyCost:0,nativeInstanceIdentity:'UI UID is local; native save persists plain item IDs',scope:'exact_native_ID_count_readback_after_one_uninvested_UI_instance_move'};
}
async function readback(i){
 const at=Date.now();
 await i.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.online||!n.isConnected?.()||n.pause||n.fixed||n.kicked||n.block||!n.account?.charId||typeof n.api!=='function'||typeof n.flush!=='function')return false;n.handlers.resave();await n.flush();await n.api('/api/save');return true;})()`);
 const until=Date.now()+2000;while(Date.now()<until){if(i.serverSaveReceipt?.proof?.requestAt>=at)return i.serverSaveReceipt;await new Promise(r=>setTimeout(r,50));}
 return null;
}
async function deposit(i,wanted){
 const actor=i.actorIdentity?.actorId,policy=i.registryV32?.policy;
 if(!policy?.isolatedStorageCanaryActors?.includes(actor))return {moved:0,sent:false,reason:'storage-isolation-canary-not-selected'};
 if(!/^[a-f0-9-]{36}$/.test(policy.isolatedStorageCanaryRunId||''))return {moved:0,sent:false,reason:'storage-isolation-recorder-run-required'};
 // A persistent attempt ID fences this whole canary run, including CONFIRMED
 // and NOT_APPLIED outcomes. Restart or another tile cannot spend it again.
 const store=i.registryV32.store,attempt='storage-canary:'+crypto.createHash('sha256').update(actor+'|'+policy.isolatedStorageCanaryRunId).digest('hex');
 if(store.get(attempt))return {moved:0,sent:false,reason:'storage-isolation-one-attempt-per-run',id:attempt};
 const capability=require('./capability-evidence').projection(i).storage;
 if(!['READY','VERIFIED'].includes(capability?.contracts.gearDeposit?.state))return {moved:0,sent:false,reason:'storage-isolation-current-review-required'};
 const plan=await i.planBag(i.roster),spare=require('./storage-spare');
 const pick=(wanted||[]).find(r=>spare.candidate(i,r,plan).allowed&&gate(i,r.id,Date.now(),plan).allowed);
 if(!pick)return {moved:0,sent:false,reason:'storage-gear-footprint-not-independent'};
 i.v2.scheduler.checkpoint();await i.expeditionAuto(false);
 const baseline=await readback(i),p=baseline?.proof,s=baseline?.state;
 const access=gate(i,pick.id,Date.now(),plan),checks={received:!!p,actor:p?.actorId===actor,build:p?.build===i.catalog().build,generation:p?.generation===i.socialInbox.generation,fresh:fresh.fresh(p?.at,5000),bag:equal(s?.bag,i.lastSave.bag),storage:sameGearProjection(s?.storage?.gear,i.lastSave.storage?.gear),access:access.allowed};
 if(Object.values(checks).some(v=>!v))return {moved:0,sent:false,reason:'storage-native-baseline-required',checks,accessReason:access.reason};
 const view=await require('./personal-storage').read(i,'bag');if(view.reason)return {moved:0,sent:false,reason:view.reason};
 const copy=spare.candidate(i,pick,plan);
 // Native bag tips use gu: for !plainCopy, including completely uninvested
 // IDs. It denotes a carrier, not proof of a paid upgrade. The independently
 // checked ID-level investment/lock footprint decides eligibility instead.
 const tile=view.rows.find(r=>r.id===pick.id&&!r.blocked&&/^bag\|\d+$/.test(r.key||'')&&!copy.protectedUids?.includes(r.key.split('|')[1])&&(!Number.isSafeInteger(pick.uid)||r.key==='bag|'+pick.uid)&&(!pick.key||r.key===pick.key)),uid=tile?.key?.split('|')[1],tip=tile&&(tile.upgraded?'gu:':'g:')+pick.id;
 if(!uid||!s.bag.some(g=>(typeof g==='string'?g:g?.id)===pick.id))return {moved:0,sent:false,reason:'storage-exact-native-instance-required'};
 i.v2.scheduler.checkpoint();if(!copy.allowed||!gate(i,pick.id,Date.now(),plan).allowed)return {moved:0,sent:false,reason:'storage-owner-or-footprint-changed'};
 const claim='gear-instance:'+uid;
 const row=store.begin({id:attempt,actorId:actor,session:i.actorOwner.session,generation:p.generation,kind:'storage:gearDeposit',bill:{[claim]:1},available:{[claim]:1},contractRevision:capability.revision,target:{id:pick.id,uid,retainedCopies:copy.retained,runId:policy.isolatedStorageCanaryRunId,build:p.build,sessionStartedAt:p.sessionStartedAt,beforeRev:p.rev,before:JSON.parse(JSON.stringify(s))}});
 // Persist before entering the native callback. Ambiguous evaluation stays SENT;
 // no timeout, restart, readback mismatch or foreign generation may replay it.
 store.sent(row.id);
 let sent;try{sent=await i.eval(`(()=>{const body=document.getElementById('pBody');if(body?.dataset.stView!=='mine|gear')return false;const b=Array.from(body.querySelectorAll('[data-sk]')).find(b=>b.dataset.sk===${JSON.stringify(tile.key)}&&b.dataset.tip===${JSON.stringify(tip)}&&!b.disabled&&!b.classList.contains('no'));if(!b)return false;if(!b.classList.contains('sel'))b.click();const selected=body.querySelector('[data-sk].sel'),go=body.querySelector('[data-st-go]');if(selected?.dataset.sk!==${JSON.stringify(tile.key)}||selected.dataset.tip!==${JSON.stringify(tip)}||!go||go.disabled)return false;go.click();return true;})()`);}catch{store.transition(row.id,'UNCERTAIN',{reason:'Native storage callback outcome unknown; no replay'});return {moved:0,sent:true,reason:'storage-move-awaiting-exact-native-readback',id:row.id};}
 if(!sent){store.transition(row.id,'UNCERTAIN',{reason:'Native callback not observed; retained for exact reconciliation'});return {moved:0,sent:false,reason:'storage-native-button-unverified',id:row.id};}
 let after;try{after=await readback(i);}catch{store.transition(row.id,'UNCERTAIN',{reason:'Native readback failed after sole storage callback; no replay'});return {moved:0,sent:true,reason:'storage-move-awaiting-exact-native-readback',id:row.id};}
 const proof=result(store.get(row.id),after,i);
 if(!proof){store.transition(row.id,'UNCERTAIN',{reason:'Storage inventory/currency or generation readback does not match sole attempt'});return {moved:0,sent:true,reason:'storage-move-awaiting-exact-native-readback',id:row.id};}
 const r=store.get(row.id);store.receipt(row.id,{receiptId:'storage:'+row.id+':'+after.proof.rev,actorId:actor,session:r.session,generation:r.generation,kind:r.kind,authority:'server_readback',at:after.proof.at,applied:true,proof});
 require('./capability-evidence').confirmed(i,row.id,'storage','gearDeposit');
 return {moved:1,sent:true,id:row.id,confirmed:true,evidence:'server_readback',receiptId:store.get(row.id).receipts.at(-1)};
}
module.exports={unrelated,gate,result,readback,deposit,equal,gearProjection,sameGearProjection};
