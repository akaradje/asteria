'use strict';
// Current native ownership can authorize a separate operation while the old
// closed-session command, its cost and its identity uncertainty stay intact.
function history(i,row,now=Date.now()){
 const cat=i.catalog(),ids=[row?.target?.id,...Object.values(row?.target?.equip||{})].filter(Boolean);
 return row?.externalOwner==='development-ledger'&&['OBSERVED','UNCERTAIN'].includes(row.status)&&['craft','refine','equip','enchant'].includes(row.kind)&&Number.isFinite(row.at)&&Number.isFinite(i.bagSessionStartedAt)&&i.bagSessionStartedAt-row.at>=60000&&row.at<=now&&(!row.legacyIdentityUnknown||/^[a-f0-9]{64}$/.test(row.originalSha256||''))&&ids.length>0&&ids.length<=8&&ids.every(id=>typeof id==='string'&&!!cat.items[id]);
}
function native(i,now=Date.now()){
 const p=i.serverSaveReceipt?.proof,s=i.serverSaveReceipt?.state;
 return /^actor-[a-f0-9]{32}$/.test(i.actorIdentity?.actorId||'')&&!!i.actorOwner&&i.registryV32?.store?.validateOwner(i.actorOwner)===true&&i.v2?.sourceCoherence?.matches===true&&p?.authority==='server_readback'&&p.actorId===i.actorIdentity.actorId&&p.build===i.catalog().build&&p.generation===i.socialInbox?.generation&&p.sessionStartedAt===i.bagSessionStartedAt&&Number.isSafeInteger(p.rev)&&p.rev>=0&&Number.isFinite(p.requestAt)&&p.requestAt>=p.sessionStartedAt&&Number.isFinite(p.at)&&p.at>=p.requestAt&&p.at<=now&&p.at-p.requestAt<=30000&&Number.isSafeInteger(s?.coins)&&s.coins>=0&&s.materials&&Object.values(s.materials).every(n=>Number.isSafeInteger(n)&&n>=0)&&s.equip&&s.refine&&require('./freshness').decisionGate(i,now).allowed;
}
const originals=new Map();
function previousRefine(i,row,id){
 let original;
 if(row.legacyIdentityUnknown){
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),file=path.join(i.root,'logs/migration-originals',row.originalSha256+'.json');
  try{if(!originals.has(file)){const bytes=fs.readFileSync(file);if(crypto.createHash('sha256').update(bytes).digest('hex')!==row.originalSha256)return null;originals.set(file,JSON.parse(bytes).rows);}original=originals.get(file)?.find(r=>'development:'+r.id===row.id&&r.kind==='refine'&&r.target?.id===id&&r.at===row.at);}catch{return null;}
 }else original=i.developmentLedger?.rows?.find(r=>'development:'+r.id===row.id&&r.kind==='refine'&&r.target?.id===id&&r.at===row.at);
 const before=original?.before?.refine?.[id]??(Object.values(original?.before?.equip||{}).includes(id)?0:null);
 return Number.isInteger(before)&&before>=0?before:null;
}
function independent(i,row,targetId,action,now=Date.now()){
 if(!['craft','refine','deposit','capacity','surplus-sale'].includes(action)||!history(i,row,now)||!native(i,now))return false;
 if(['deposit','capacity','surplus-sale'].includes(action))return true; // caller preserves every old gear footprint
 if(!targetId||!i.catalog().items[targetId])return false;
 const ids=[row.target?.id,...Object.values(row.target?.equip||{})].filter(Boolean);
 if(action==='craft')return !ids.includes(targetId);
 const s=i.serverSaveReceipt.state,live=i.lastSave;
 if(!Object.values(s.equip).includes(targetId)||!Object.values(live?.equip||{}).includes(targetId)||(s.refine[targetId]??0)!==(live.refine?.[targetId]??0))return false;
 // An old craft or free swap is a different action on already-owned gear.
 // An unknown roll on this very item is still forbidden, across all builds.
 if(row.kind!=='refine'||!ids.includes(targetId))return true;
 const before=previousRefine(i,row,targetId),current=s.refine[targetId]??0;
 // A truncated non-legacy ledger cannot supply an old before-level. Keep its
 // journal untouched; explicit fresh-intent policy permits a separately funded
 // UUID, with immutable archival enforced before ledger.begin and dispatch.
 if(before===null)return !row.legacyIdentityUnknown&&/^development:[a-f0-9-]{36}$/.test(row.id||'')&&require('./fresh-refine-attempt').allowed(i,targetId,now);
 return current!==before||require('./fresh-refine-attempt').allowed(i,targetId,now);
}
function domainClosed(i,row,now=Date.now()){
 if(history(i,row,now))return true;
 const c=row?.context,p=row?.reconciliation;
 return ['reconciled_craft_unknown','reconciled_refine_state'].includes(row?.status)&&c?.actorId===i.actorIdentity?.actorId&&p?.authority==='server_readback'&&p.actorId===c.actorId&&p.replayBlocked===true&&p.historicalSuccessKnown===false&&Number.isFinite(p.sessionStartedAt)&&p.sessionStartedAt-row.at>=60000&&p.build===i.catalog().build&&native(i,now);
}
module.exports={history,native,independent,domainClosed};
