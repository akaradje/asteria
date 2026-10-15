'use strict';
// Positive bilateral cancellation evidence, separate from unknown paid outcomes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fresh=require('./freshness').fresh,archive=require('./material-budget-recovery');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),uuid=s=>/^[a-f0-9-]{36}$/.test(s||'');
function file(root,actor,id){if(!uuid(id)||!/^actor-[a-f0-9]{32}$/.test(actor||''))throw Error('Invalid cancellation identity');return path.join(root,'logs/trade-no-dispatch',actor,id+'.json');}
function blocked(i,id){if(!i.root||!uuid(id)||!/^actor-[a-f0-9]{32}$/.test(i.actorIdentity?.actorId||''))return false;const f=file(i.root,i.actorIdentity.actorId,id);return fs.existsSync(f)||fs.existsSync(f+'.tmp');}
function unsent(r){return !!r?.sent&&typeof r.sent==='object'&&!Array.isArray(r.sent)&&Object.entries(r.sent).every(([k,v])=>['request','accept','offer','lock','confirm','cancel'].includes(k)&&v===false)&&['sessionId','receipt','confirmAt','doneAt','offerAt','protocolLeaseUntil','nativeCloseEvidence','nativeInventoryProof'].every(k=>r[k]==null);}
function cancelled(r){return r?.phase==='CANCELLED'&&unsent(r)&&(r.evidence==='no_server_trade_command_dispatched'||r.reason==='Refinement material budget changed before gathering');}
function original(root,r){
 if(!unsent(r)||!uuid(r.id)||!r.offer||!Number.isSafeInteger(r.before)||r.before<0||!Number.isFinite(r.at)||!Number.isFinite(r.deadline)||r.deadline<r.at||!Number.isSafeInteger(r.context?.generation)||!Number.isFinite(r.context?.sessionStartedAt)||r.context.build!==r.build)return null;
 if(r.readbackRecovery?.originalHash){const h=r.readbackRecovery.originalHash;if(!/^[a-f0-9]{64}$/.test(h))return null;const b=fs.readFileSync(path.join(root,'logs/migration-originals/trades',h+'.json'));if(sha(b)!==h)throw Error('Original cancellation archive changed');const o=JSON.parse(b);return cancelled(o)&&o.id===r.id&&JSON.stringify(o.context)===JSON.stringify(r.context)&&JSON.stringify(o.offer)===JSON.stringify(r.offer)&&o.before===r.before&&o.at===r.at&&o.deadline===r.deadline?{row:o,sha256:h}:null;}
 return cancelled(r)?{row:r,sha256:null}:null;
}
function proofValid(p,actor,build,now){return p?.authority==='server_readback'&&p.actorId===actor&&p.build===build&&Number.isSafeInteger(p.rev)&&p.rev>=0&&Number.isSafeInteger(p.generation)&&Number.isFinite(p.sessionStartedAt)&&p.requestAt>=p.sessionStartedAt&&p.at>=p.requestAt&&p.at-p.requestAt<=30000&&fresh(p.at,30000,now);}
function certify(i,r,a,now=Date.now()){
 const o=original(i.root,r),p=a?.proof;
 if(!o||i.autoChores===false||i.stopped||i.stopRequested||i.teamTradeIntent?.phase==='SESSION'||i.teamTradeIntent?.id===r.id&&['GATHERING','SESSION'].includes(i.teamTradeIntent.phase)||!proofValid(p,i.actorIdentity?.actorId,i.catalog().build,now)||r.context.actorId!==p.actorId||p.sessionStartedAt!==i.bagSessionStartedAt||p.generation!==i.socialInbox?.generation||p.requestAt<=r.deadline||typeof i.v2?.observations?.sessionId!=='string'||i.registryV32?.store?.validateOwner(i.actorOwner)!==true)return false;
 const f=file(i.root,p.actorId,r.id);let h;
 if(fs.existsSync(f)){const old=JSON.parse(fs.readFileSync(f));h=old.originalSha256;const saved=archive.original(i.root,h);if(saved?.kind!=='trade_no_dispatch'||saved.original.id!==r.id||JSON.stringify(saved.original.context)!==JSON.stringify(r.context)||!unsent(saved.original))throw Error('Cancellation certificate/archive changed');}
 else h=archive.preserve(i.root,{version:1,kind:'trade_no_dispatch',original:JSON.parse(JSON.stringify(r)),cancelledOriginal:o,actorId:p.actorId,host:i.machine,replayBlocked:true});
 const cert={version:1,id:r.id,actorId:p.actorId,actorName:i.character.name,host:i.machine,runtimeGeneration:i.v2.observations.sessionId,offer:r.offer,originalSha256:h,proof:{...p},at:now,replayBlocked:true,resolution:'verified_not_dispatched'};
 fs.mkdirSync(path.dirname(f),{recursive:true});const temp=f+'.tmp',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(cert));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,f);
 return true;
}
function inspect(root,q,m,host,build,now,live=true){
 const f=file(root,m.identity?.actorId,q.id),c=JSON.parse(fs.readFileSync(f)),o=archive.original(root,c.originalSha256),r=JSON.parse(fs.readFileSync(path.join(root,'logs/trades',sha(m.charName).slice(0,24),q.id+'.json')));
 if(!o||o.kind!=='trade_no_dispatch'||!original(root,r)||!unsent(r)||o.original.id!==q.id||r.id!==q.id||r.context.actorId!==m.identity.actorId||o.actorId!==m.identity.actorId||o.host!==host||c.id!==q.id||c.actorId!==m.identity.actorId||c.actorName!==m.charName||c.host!==host||c.replayBlocked!==true||JSON.stringify(c.offer)!==JSON.stringify(q.offer)||JSON.stringify(r.offer)!==JSON.stringify(q.offer)||JSON.stringify(o.original.context)!==JSON.stringify(r.context))return null;
 if(live&&(!proofValid(c.proof,m.identity.actorId,build,now)||c.proof.requestAt<=r.deadline||c.runtimeGeneration!==m.runtimeGeneration||m.status!=='playing'||m.recycling||m.actionOwner||!fresh(m.lastSaveAt,30000,now)||m.tradeAvailability?.clear!==true||!fresh(m.tradeAvailability.at,15000,now)))return null;
 return c;
}
function candidate(root,q,members,host){
 try{const names=require('../planning/host-team-scope').team(root,host)?.members.map(m=>m.charName)||[];return q.offer?.donor!==q.offer?.receiver&&[q.offer?.donor,q.offer?.receiver].every(name=>{const m=members.find(m=>m.charName===name&&m.machine===host&&names.includes(name));if(!m||!uuid(q.id))return false;const r=JSON.parse(fs.readFileSync(path.join(root,'logs/trades',sha(name).slice(0,24),q.id+'.json')));return r.id===q.id&&r.context?.actorId===m.identity?.actorId&&JSON.stringify(r.offer)===JSON.stringify(q.offer)&&!!original(root,r);});}catch{return false;}
}
function resolve(root,q,members,host,build,now=Date.now()){
 // Legacy bilateral closures retain their own evidence contract; absence of a
 // certificate introduced by this release is not contradictory evidence.
 if(q.resolution==='resolved_not_dispatched'&&!q.noDispatchResolution)return false;
 if(!['unresolved_no_replay','resolved_not_dispatched'].includes(q.resolution)||!uuid(q.id)||!q.offer||q.offer.donor===q.offer.receiver)return false;
 const names=require('../planning/host-team-scope').team(root,host)?.members.map(m=>m.charName)||[],pair=[q.offer.donor,q.offer.receiver].map(n=>members.find(m=>m.charName===n&&m.machine===host&&names.includes(n)));
 if(pair.some(m=>!m))return false;
 try{
  const closed=q.resolution==='resolved_not_dispatched',certs=pair.map(m=>inspect(root,q,m,host,build,now,!closed));
  if(closed&&!archive.original(root,q.noDispatchResolution?.originalSha256))throw Error('Bilateral cancellation archive unavailable');
  if(certs.some(c=>!c)){if(closed){q.resolution='unresolved_no_replay';q.resolutionError='Cancellation evidence contradicted or unavailable';return true;}return false;}
  if(closed)return false;
  const h=archive.preserve(root,{version:1,kind:'bilateral_trade_no_dispatch',original:JSON.parse(JSON.stringify(q)),certificates:certs,replayBlocked:true});
  q.resolution='resolved_not_dispatched';q.resolvedAt=now;q.replayBlocked=true;q.noDispatchResolution={originalSha256:h,certificates:certs,resolutionEvidence:'both_original_cancelled_journals_and_fresh_owned_native_idle_readbacks'};return true;
 }catch{if(q.resolution==='resolved_not_dispatched'){q.resolution='unresolved_no_replay';q.resolutionError='Cancellation archive or journal unavailable';return true;}return false;}
}
module.exports={blocked,unsent,cancelled,original,certify,resolve,inspect,candidate};
