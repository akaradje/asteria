'use strict';
function compatiblePriorBuilds(root,build){
 if(build!=='5e3eefcf')return [];
 const fs=require('fs'),crypto=require('crypto'),expected={'asteria-online-visual-polish.html':'75ffe8539270e80be768884c2a4da41636244e753a25187ac098007a4580d625','asteria-world-system.js':'0cff990c9ef597abf4e523036c55d6675bc74ca1f0c13baf0480698d00122e22','asteria-net.js':'46c7ffd89a61f548fd3c203fe255ba752e4a84b7479516494386f7c95c029248'};
 try{for(const [name,hash]of Object.entries(expected))if(crypto.createHash('sha256').update(fs.readFileSync(root+'/cache/'+build+'/asteria-online.io/'+name)).digest('hex')!==hash)return [];return ['7a4a3700'];}catch{return [];}
}

function marketEffect(r,s,{at,after=0}={}){
 return r?.kind==='market-class'&&r.externalOwner==='class-market'&&['WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status)&&Number.isFinite(r.dispatchAt)&&Number.isFinite(r.deadline)&&r.deadline>r.dispatchAt&&Number.isFinite(at)&&at>r.deadline+after&&Number.isSafeInteger(r.before?.coins)&&Number.isSafeInteger(r.beforeMaterial)&&Number.isSafeInteger(r.target?.price)&&r.target.price>0&&Number.isSafeInteger(r.target.n)&&r.target.n>0&&typeof r.target.item==='string'&&s?.coins===r.before.coins-r.target.price&&s.materials?.[r.target.item]===r.beforeMaterial+r.target.n;
}
function reconcile(journal,reservations,save,{at,sessionStartedAt,rev,build,root,identity,actorId,acceptedPriorBuilds=[]}={}){
 if(!Number.isFinite(sessionStartedAt)||!Number.isFinite(at)||at<=sessionStartedAt||!Number.isInteger(rev)||rev<0)return [];
 const settled=[];for(const r of journal.rows){
  if(r.build!==build&&!acceptedPriorBuilds.includes(r.build))continue;
  if(r.marketContractVersion===2&&(!require('./market-receipts').persisted(r)||r.context.actorId!==actorId))continue;
  const e=r.serverLoadEvidence;
  if(r.status==='CONFIRMED'&&r.evidence==='authoritative_server_load_after_original_market_session_closed_exact_wallet_and_material'&&e&&Number.isInteger(e.rev)&&e.rev>=0&&e.sessionStartedAt>r.deadline&&e.at>e.sessionStartedAt&&marketEffect({...r,status:'UNCERTAIN'},{coins:e.coins,materials:{[r.target.item]:e.material}},{at:e.at})){
   const claims=reservations||(root&&identity?new(require('../planning/resource-reservations').ResourceReservations)(root,identity):null),claim=claims?.data?.claims?.find(c=>c.id===r.claimId&&c.transactionId===r.id&&c.cost?.Copper===r.target.price);
   if(claim&&['UNCERTAIN','STARTED','RESERVED'].includes(claim.status)){claims.finish(r.claimId,'CONFIRMED');settled.push(r.id);}continue;
  }
  if(r.deadline>=sessionStartedAt||!marketEffect(r,save,{at}))continue;
  const claims=reservations||(root&&identity?new(require('../planning/resource-reservations').ResourceReservations)(root,identity):null);
  if(!claims)continue;
  r.status='CONFIRMED';r.observedAt=at;r.evidence='authoritative_server_load_after_original_market_session_closed_exact_wallet_and_material';
  r.serverLoadEvidence={at,sessionStartedAt,rev,coins:save.coins,material:save.materials[r.target.item]};r.reason='original purchase persisted on server; never resent';
  claims.finish(r.claimId,'CONFIRMED');settled.push(r.id);
 }if(settled.length)journal.save();return settled;
}
function canCloseMarket(i,row,now,root){
 const fs=require('fs'),crypto=require('crypto');
 if(i.status!=='playing'||i.livePos?.room!=='town'||(!Number.isFinite(i.vitals?.hp)||i.vitals.hp<.85)||!Number.isFinite(i.lastSaveAt)||now-i.lastSaveAt<0||now-i.lastSaveAt>=30000||!row?.id)return false;
 try{const file=root+'/logs/actions/'+crypto.createHash('sha256').update(String(i.account||'')).digest('hex').slice(0,16)+'.json',j=JSON.parse(fs.readFileSync(file));
  const r=j.rows.find(r=>r.id===row.id),pinned=i.runtimeV2?.loadedSourceIdentity;
  if(i.runtimeV2?.sourceCoherence?.matches!==true){
   if(!r||pinned?.build!==r.build||!pinned.signature||pinned.missing?.length)return false;
   for(const [name,key]of Object.entries({'asteria-online-visual-polish.html':'client','asteria-world-system.js':'world','asteria-net.js':'network'}))if(crypto.createHash('sha256').update(fs.readFileSync(root+'/cache/'+r.build+'/asteria-online.io/'+name)).digest('hex')!==pinned.sourceHashes?.[key])return false;
  }
  return marketEffect(r,{coins:i.coins,materials:i.materials},{at:i.lastSaveAt,after:15000});
 }catch{return false;}
}
module.exports={marketEffect,reconcile,canCloseMarket,compatiblePriorBuilds};
