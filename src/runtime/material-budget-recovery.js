'use strict';
// Rebase current material budgets only. Never infer an old receipt or replay it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fresh=require('./freshness').fresh;
const uuid=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
function preserve(root,value){
 const bytes=Buffer.from(JSON.stringify(value)),hash=sha(bytes),file=path.join(root,'logs/material-budget-originals',hash+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 let fd;try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
 if(!fs.readFileSync(file).equals(bytes))throw Error('Material budget original differs');return hash;
}
function original(root,hash){if(!/^[a-f0-9]{64}$/.test(hash||''))return null;try{const b=fs.readFileSync(path.join(root,'logs/material-budget-originals',hash+'.json'));return sha(b)===hash?JSON.parse(b):null;}catch{return null;}}
function gate(i,now=Date.now()){
 const p=i.serverSaveReceipt?.proof,s=i.serverSaveReceipt?.state,v=i.v2;
 if(i.status!=='playing'||i.autoChores!==true||i.tickBusy||i.choresBusy||i.fleetActivityBusy||i.activeResourceClaim||i.activeDevelopmentAttempt||i.nativeFreshSaveFlight||i.paidReadbackFlight||i.tradeReadbackFlight||i.tradeHistoryFlight||i.recycling||i.healthRecovery||i.survivalRecovery||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pendingTravel||i.pvpMission||v?.trial?.active()||!v?.scheduler||v.scheduler.closed||v.scheduler.active||v.scheduler.queue?.length)return false;
 if(!require('./closed-gear-scope').native(i,now)||!fresh(p?.at,15000,now)||!fresh(i.livePos?.at,10000,now)||i.livePos.dead||/^(tw|dx|gd|pv)/.test(i.livePos.room||'')||i.tradeAvailability?.clear!==true||!fresh(i.tradeAvailability.at,15000,now))return false;
 if(['GATHERING','SESSION'].includes(i.teamTradeIntent?.phase)||['GATHERING','READY','SESSION','CONFIRM_SENT','VERIFYING'].includes(i.teamTradeStatus?.phase))return false;
 if(Object.values(i.activityState||{}).some(a=>a?.run&&!a.run.done))return false;
 const open=i.socialInbox?.last?.('tropen');if(open&&open._receivedAt>=i.bagSessionStartedAt&&![i.socialInbox.last('trclosed')?.id,i.socialInbox.last('trdone')?.id].some(id=>id!=null&&String(id)===String(open.id)))return false;
 const pending=new Set(['pending','unresolved','change_observed','spent_without_change','STARTED','SENT','WAITING_CONFIRMATION','UNCERTAIN','OBSERVED','INTENT']);
 const rows=[...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[]),...(v.journal?.rows||[]),...(i.registryV32.store.pending(i.actorIdentity.actorId)||[])];
 if(rows.some(r=>pending.has(r.status)&&(!Number.isFinite(r.at)||r.at>=i.bagSessionStartedAt||now-r.at<600000)))return false;
 return Number.isSafeInteger(s.coins)&&s.coins>=0&&s.materials&&Object.values(s.materials).every(n=>Number.isSafeInteger(n)&&n>=0);
}
function closed(at,deadline,p,now){return Number.isFinite(at)&&Number.isFinite(deadline)&&deadline>=at&&now-at>=600000&&p.sessionStartedAt>deadline&&p.sessionStartedAt-at>=60000&&p.requestAt>=p.sessionStartedAt;}
function certificate(i,at,deadline,hash,now){const p=i.serverSaveReceipt.proof,s=i.serverSaveReceipt.state;return {version:1,at:now,actorId:i.actorIdentity.actorId,host:i.machine,actorName:i.character.name,runtimeGeneration:i.v2.observations?.sessionId,originalAt:at,deadline,originalSha256:hash,proof:{...p},currentWallet:s.coins,currentMaterials:{...s.materials},budgetRebased:true,replayBlocked:true,historicalSuccessKnown:false,historicalCostKnown:false};}
function reserve(i,now=Date.now()){
 if(!gate(i,now))return 0;
 const v=i.v2.reservations,p=i.serverSaveReceipt.proof,identity=i.credentials?.username;
 if(!identity||!v||path.resolve(v.file)!==path.resolve(i.root,'logs/reservations',sha(String(identity)).slice(0,24)+'.json'))return 0;
 // This recovery covers orphan craft bills with a verified native recipe.
 // A missing target is not guessed from inventory, nor a refine/payment receipt.
 const cat=i.catalog(),wiki=require('../economy').withNativeRecipes(require('../economy').loadWiki(i.root),cat),recipes=(wiki.crafting?.recipes||[]).filter(r=>r.verified&&r.verifiedBuild===cat.build);
 let count=0;
 for(const r of v.data.claims){
  if(r.status!=='UNCERTAIN'||r.transactionId||r.dispatchTracking||!uuid(r.id)||!closed(r.at,r.deadline,p,now)||!r.cost||Object.entries(r.cost).some(([k,n])=>!Number.isSafeInteger(n)||n<=0||k!=='Copper'&&!Object.hasOwn(i.serverSaveReceipt.state.materials,k)))continue;
  if(!recipes.some(x=>Object.keys(x.cost||{}).length===Object.keys(r.cost).length&&Object.entries(r.cost).every(([k,n])=>x.cost[k]===n)))continue;
  if((i.developmentLedger?.rows||[]).some(x=>x.id===r.id)||(i.v2.journal?.rows||[]).some(x=>x.id===r.id||x.id==='development:'+r.id))continue;
  const hash=preserve(i.root,{version:1,kind:'orphan_material_claim',actorId:i.actorIdentity.actorId,host:i.machine,reservationFile:path.relative(i.root,v.file).replace(/\\/g,'/'),original:JSON.parse(JSON.stringify(r)),replayBlocked:true});
  r.reconciliation=certificate(i,r.at,r.deadline,hash,now);r.status='RECONCILED';r.replayBlocked=true;v.save();count++;
 }
 return count;
}
function tradeFile(root,name,id){if(!uuid(id))throw Error('Invalid material trade UUID');return path.join(root,'logs/trades',sha(name).slice(0,24),id+'.json');}
function certFile(root,actor,id){if(!/^actor-[a-f0-9]{32}$/.test(actor||'')||!uuid(id))throw Error('Invalid material rebase identity');return path.join(root,'logs/material-budget-rebases',actor,id+'.json');}
function readCert(root,actor,id){try{return JSON.parse(fs.readFileSync(certFile(root,actor,id)));}catch{return null;}}
function sameOffer(a,b){return a?.kind==='material'&&b?.kind==='material'&&['donor','receiver','name','quantity'].every(k=>a[k]===b[k]);}
function trade(i,now=Date.now()){
 if(!gate(i,now))return 0;
 const scope=require('../planning/host-team-scope').team(i.root,i.machine),names=scope?.members.map(m=>m.charName)||[],p=i.serverSaveReceipt.proof;
 let count=0;
 for(const q of i.teamTradeIntent?.quarantined||[]){
  if(q.resolution!=='unresolved_no_replay'||q.offer?.kind!=='material'||!i.catalog().world?.REFINE?.ORES?.includes(q.offer.name)||q.offer.donor===q.offer.receiver||!names.includes(q.offer.donor)||!names.includes(q.offer.receiver)||![q.offer.donor,q.offer.receiver].includes(i.character.name)||!uuid(q.id))continue;
  let r;try{r=JSON.parse(fs.readFileSync(tradeFile(i.root,i.character.name,q.id)));}catch{continue;}
  if(!sameOffer(r.offer,q.offer)||!['UNCERTAIN','VERIFYING','CONFIRMED','CONFIRM_SENT','CANCELLED'].includes(r.phase)||r.context?.actorId!==i.actorIdentity.actorId||!Number.isSafeInteger(r.context?.generation)||!Number.isFinite(r.context?.sessionStartedAt)||r.context.sessionStartedAt>=p.sessionStartedAt||!closed(r.at,r.deadline,p,now)||!Number.isSafeInteger(q.offer.quantity)||q.offer.quantity<=0||!Object.hasOwn(i.serverSaveReceipt.state.materials,q.offer.name))continue;
  const prior=readCert(i.root,i.actorIdentity.actorId,q.id);
  let hash=prior?.originalSha256;
  if(hash&&!original(i.root,hash))throw Error('Material trade archive missing');
  if(!hash){
   let historical=null;if(r.readbackRecovery?.originalHash){const h=r.readbackRecovery.originalHash;if(!/^[a-f0-9]{64}$/.test(h))continue;const b=fs.readFileSync(path.join(i.root,'logs/migration-originals/trades',h+'.json'));if(sha(b)!==h)throw Error('Trade original changed');historical={sha256:h,bytes:b.toString('base64')};}
   hash=preserve(i.root,{version:1,kind:'closed_material_trade',actorId:i.actorIdentity.actorId,host:i.machine,original:r,historical,replayBlocked:true});
  }
  const c={...certificate(i,r.at,r.deadline,hash,now),id:q.id,offer:{...q.offer}};
  const file=certFile(i.root,i.actorIdentity.actorId,q.id);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(c));fs.renameSync(file+'.tmp',file);count++;
 }
 return count;
}
function validCertificate(root,c,q,m,host,build,now){
 const p=c?.proof,o=original(root,c?.originalSha256),r=o?.original;
 return !!c&&c.version===1&&c.id===q.id&&c.actorId===m?.identity?.actorId&&c.actorName===m.charName&&c.host===host&&typeof c.runtimeGeneration==='string'&&c.runtimeGeneration===m.runtimeGeneration&&o?.host===host&&o?.actorId===c.actorId&&o.kind==='closed_material_trade'&&r?.id===q.id&&r.context?.actorId===c.actorId&&sameOffer(c.offer,q.offer)&&sameOffer(r.offer,q.offer)&&c.budgetRebased===true&&c.replayBlocked===true&&c.historicalSuccessKnown===false&&c.historicalCostKnown===false&&fresh(c.at,30000,now)&&p?.authority==='server_readback'&&p.actorId===c.actorId&&p.build===build&&Number.isSafeInteger(p.rev)&&p.rev>=0&&Number.isSafeInteger(p.generation)&&Number.isFinite(p.sessionStartedAt)&&p.sessionStartedAt>r.context.sessionStartedAt&&closed(r.at,r.deadline,p,now)&&fresh(p.at,30000,now)&&p.at>=p.requestAt&&p.at-p.requestAt<30000&&Number.isSafeInteger(c.currentWallet)&&c.currentWallet>=0&&Number.isSafeInteger(c.currentMaterials?.[q.offer.name])&&c.currentMaterials[q.offer.name]>=0&&m.status==='playing'&&!m.recycling&&!m.actionOwner&&m.tradeAvailability?.clear===true&&fresh(m.tradeAvailability.at,15000,now)&&fresh(m.lastSaveAt,30000,now);
}
function resolve(root,q,members,host,build,now=Date.now()){
 if(q.resolution!=='unresolved_no_replay'||q.offer?.kind!=='material'||q.offer.donor===q.offer.receiver)return false;
 const scope=require('../planning/host-team-scope').team(root,host),names=scope?.members.map(m=>m.charName)||[];
 const pair=[q.offer.donor,q.offer.receiver].map(n=>members.find(m=>m.charName===n&&m.machine===host));
 if(pair.some(m=>!m||!names.includes(m.charName)))return false;
 const certificates=pair.map(m=>readCert(root,m.identity?.actorId,q.id));
 if(!pair.every((m,n)=>validCertificate(root,certificates[n],q,m,host,build,now)))return false;
 const hash=preserve(root,{version:1,kind:'material_trade_coordinator',original:JSON.parse(JSON.stringify(q)),certificates,replayBlocked:true});
 q.resolution='rebased_current_material_budget';q.replayBlocked=true;q.budgetRebase={at:now,originalSha256:hash,certificates:certificates.map(c=>({actorId:c.actorId,originalSha256:c.originalSha256,proof:c.proof})),historicalSuccessKnown:false,historicalCostKnown:false};return true;
}
function replayBlocked(i,id){if(!uuid(id)||!/^actor-[a-f0-9]{32}$/.test(i.actorIdentity?.actorId||'')||!i.root)return false;return fs.existsSync(certFile(i.root,i.actorIdentity.actorId,id));}
function tick(i,now=Date.now()){
 if(!gate(i,now)||now-(i.materialBudgetRecovery?.at||0)<10000)return false;
 try{const reservations=reserve(i,now)+require('./legacy-material-reserve').recover(i,now),trades=trade(i,now);i.materialBudgetRecovery={at:now,reservations,trades,replayBlocked:true};return reservations+trades>0;}catch{i.materialBudgetRecovery={at:now,state:'blocked_archive_or_proof',replayBlocked:true};return false;}
}
module.exports={certificate,gate,closed,preserve,original,reserve,trade,resolve,readCert,validCertificate,replayBlocked,tick};
