'use strict';
const fs=require('node:fs'),path=require('node:path'),cap=require('../knowledge/capability-registry'),cache=new WeakMap(),sources=new Map();
// Review attestations never imply a server outcome. They are bound to exact
// source and domain hashes; actor-specific native receipts remain in SQLite.
function projection(i){
 const cat=i.catalog(),now=Date.now(),prior=cache.get(i);if(prior&&prior.cat===cat&&now-prior.at<30000)return prior.value;
 let source=sources.get(i.root);if(!source||now-source.at>=30000){source={at:now,revision:require('../knowledge/system-version').inventory(i.root).revision};sources.set(i.root,source);}
 let reviews={};try{const p=JSON.parse(fs.readFileSync(path.join(i.root,'logs/capability-reviews-v32.json')));if(p.version===1&&p.sourceRevision===source.revision)reviews=p.reviews||{};}catch(e){if(e.code!=='ENOENT')i.capabilityReviewError='unreadable_review_preserved_no_approval';}
 if(i.registryV32?.policy?.adaptiveCombatActions===true&&i.v2?.sourceCoherence?.matches===true&&cat.nativeSemanticContracts?.astral?.allowed){const domain=cap.registry(cat).astral;reviews.astral={build:cat.build,revision:domain.revision,checksPassed:true,evidence:'AST_structural_contract',actions:Object.fromEntries(['aspt','asbt'].map(a=>[a,{revision:domain.revision,checksPassed:true}]))};}
 const outcomes=i.registryV32?.store.document('capability-outcomes:'+i.actorIdentity?.actorId)||{};
 const value=cap.registry(cat,{reviews,outcomes});cache.set(i,{cat,at:now,value});return value;
}
function astralConfirmed(i,id){
 const store=i.registryV32.store,r=store.get(id),action=r?.kind?.replace('astral:',''),c=cap.registry(i.catalog()).astral;
 const receiptId=r?.receipts?.at(-1);if(r?.status!=='CONFIRMED'||!['aspt','asbt','asrst'].includes(action)||r.actorId!==i.actorIdentity.actorId||r.session!==i.actorOwner.session||r.generation!==i.socialInbox.generation||r.contractRevision!==c.revision||!receiptId)return false;
 const raw=store.db.prepare('SELECT data FROM receipts WHERE id=? AND intent=?').get(receiptId,id),receipt=raw&&JSON.parse(raw.data);
 if(receipt?.authority!=='server_socket'||receipt.actorId!==r.actorId||receipt.session!==r.session||receipt.generation!==r.generation||receipt.applied!==true)return false;
 const key='capability-outcomes:'+r.actorId,old=store.document(key)||{},effects=c.actionEffects[action];
 old.astral||={actions:{}};old.astral.actions[action]={build:i.catalog().build,revision:c.revision,authority:receipt.authority,confirmed:true,receiptId,effects,at:receipt.at};
 store.putDocument(key,old);cache.delete(i);return true;
}
function confirmed(i,id,domain,action){
 const store=i.registryV32.store,r=store.get(id),c=cap.registry(i.catalog())[domain],contract=c?.contracts[action],receiptId=r?.receipts?.at(-1);
 if(!contract||r?.status!=='CONFIRMED'||r.kind!==domain+':'+action||r.actorId!==i.actorIdentity.actorId||r.session!==i.actorOwner.session||r.generation!==i.socialInbox.generation||r.contractRevision!==c.revision||!receiptId||r.target?.build!==i.catalog().build)return false;
 const raw=store.db.prepare('SELECT data FROM receipts WHERE id=? AND intent=?').get(receiptId,id),receipt=raw&&JSON.parse(raw.data);
 if(!['server_socket','server_readback'].includes(receipt?.authority)||receipt.actorId!==r.actorId||receipt.session!==r.session||receipt.generation!==r.generation||receipt.applied!==true)return false;
 const key='capability-outcomes:'+r.actorId,old=store.document(key)||{};old[domain]||={actions:{}};
 old[domain].actions[action]={build:i.catalog().build,revision:c.revision,authority:receipt.authority,confirmed:true,receiptId,effects:contract.resourceEffects,at:receipt.at};store.putDocument(key,old);cache.delete(i);return true;
}
function outcomes(i){const data=i.registryV32?.store.document('capability-outcomes:'+i.actorIdentity?.actorId)||{};return Object.entries(data).flatMap(([domain,v])=>Object.entries(v.actions||{}).map(([action,r])=>({actorId:i.actorIdentity.actorId,kind:domain+':'+action,...r}))).slice(-32);}
module.exports={projection,astralConfirmed,confirmed,outcomes};
