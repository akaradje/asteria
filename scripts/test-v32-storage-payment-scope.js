'use strict';
const assert=require('node:assert/strict'),scope=require('../src/runtime/storage-payment-scope'),storage=require('../src/runtime/personal-storage');
const now=Date.now(),start=now-10000;
const old=[{kind:'purchase',status:'UNCERTAIN',at:start-100000,target:{item:'Starlight Potion'}},{kind:'refine',status:'OBSERVED',externalOwner:'development-ledger',at:start-100000,target:{id:'weapon'}}];
const cat={build:'native',items:{spare:{id:'spare',slot:'head'},weapon:{id:'weapon',slot:'weapon'}}};
function actor(){return {catalog:()=>cat,actorIdentity:{actorId:'actor'},bagSessionStartedAt:start,socialInbox:{generation:2},serverSaveReceipt:{proof:{authority:'server_readback',actorId:'actor',sessionStartedAt:start,generation:2,build:'native',requestAt:start+1,at:start+2,rev:4}},lastSaveAt:now,livePos:{room:'town',at:now},lastSave:{equip:{},locks:[]},v2:{sourceCoherence:{matches:true},journal:{rows:structuredClone(old)}}};}
let i=actor(),before=JSON.stringify(i.v2.journal.rows);
assert(scope.independent(i,{action:'capacity'},now));assert(scope.independent(i,{action:'deposit',ids:['spare']},now));
assert.equal(storage.gate(i).allowed,false,'ordinary storage operations retain quarantine');
assert.equal(storage.gate(i,{action:'capacity'}).allowed,true);
assert.equal(storage.gate(i,{action:'deposit',ids:['spare']}).allowed,true);
assert.equal(storage.gate(i,{action:'deposit',ids:['weapon']}).allowed,false);
assert(storage.protectedGear(i,'weapon'),'legacy target remains protected after unequipping');
assert.equal(JSON.stringify(i.v2.journal.rows),before,'no status/evidence/receipt/history modified');
for(const action of ['withdraw','sell','craft','refine',null])assert(!scope.independent(i,{action,ids:['spare']},now));
for(const patch of [{actorId:'other'},{generation:3},{build:'old'},{sessionStartedAt:start-1},{authority:'outgoing_client_save'},{requestAt:start-1},{at:now+1},{rev:null}])assert(!scope.independent({...i,serverSaveReceipt:{proof:{...i.serverSaveReceipt.proof,...patch}}},{action:'capacity'},now));
for(const r of [{kind:'storage-upgrade',target:{fromTier:3}},{kind:'bag-upgrade',target:{fromTier:1}},{kind:'craft',target:{id:'wing'}},{kind:'trade',target:{id:'spare'}},{kind:'refine',target:{}},{kind:'purchase',target:{item:'Unknown'}},{kind:'refine',target:{id:'weapon'},at:now}]){
 const a=actor();a.v2.journal.rows.push({status:'UNCERTAIN',at:start-100000,...r});assert(!scope.independent(a,{action:'capacity'},now));assert(!scope.independent(a,{action:'deposit',ids:['spare']},now));
}
for(const patch of [{teamControl:{}},{dailyWorkStatus:{ownsNavigation:true}},{pendingTravel:{}},{lastSaveAt:now-31000},{v2:{...i.v2,sourceCoherence:{matches:false}}},{teamTradeStatus:{phase:'OPEN'}}])assert(!storage.gate({...i,...patch},{action:'capacity'}).allowed);
const row={kind:'storage-upgrade',status:'STARTED',at:now,target:{fromTier:3}};i.v2.journal.rows.push(row);
assert(!scope.independent(i,{action:'capacity'},now));assert(scope.independent(i,{action:'capacity',payment:row},now),'only the exact active storage payment is owned');assert(!scope.independent(i,{action:'capacity',payment:{...row}},now));
const headroom=require('../src/runtime/equipment-headroom');assert(headroom.journalBlocks(i,now),'global paid/trade/combat gates unchanged');
console.log('PASS historical storage scope, immutable unknown outcomes, native identity/session evidence, old-target preservation and current/unknown/owned-payment fences');
{
 const a=actor();cat.items.wing={id:'wing',slot:'wing'};a.lastSave.equip.wing='wing';
 const r={kind:'craft',status:'OBSERVED',externalOwner:'development-ledger',at:start-100000,target:{id:'wing'},cost:{coins:150000,'materials:Warden Core':5}};
 a.v2.journal.rows.push(r);a.serverSaveReceipt.state={equip:{wing:'wing'}};const original=JSON.stringify(r);
 assert(scope.independent(a,{action:'deposit',ids:['spare']},now));assert(scope.independent(a,{action:'surplus-sale',ids:['spare']},now));
 assert(!scope.independent(a,{action:'deposit',ids:['wing']},now));assert(!scope.independent(a,{action:'craft',ids:['spare']},now));
 for(const patch of [{status:'UNCERTAIN'},{externalOwner:null},{cost:null},{cost:{coins:-1}},{at:now},{target:{id:'unknown'}}]){Object.assign(r,patch);assert(!scope.independent(a,{action:'capacity'},now));Object.assign(r,JSON.parse(original));}
 a.serverSaveReceipt.state={equip:{}};assert(!scope.independent(a,{action:'capacity'},now),'current native ownership required');
 assert.equal(JSON.stringify(r),original,'historical outcome and cost are never cleared');
}
(async()=>{
 const a=actor(),reader=require('../src/runtime/isolated-storage'),original=reader.readback;let reads=0;
 delete a.serverSaveReceipt.proof.generation;
 reader.readback=async who=>{reads++;who.serverSaveReceipt.proof.generation=who.socialInbox.generation;return who.serverSaveReceipt;};
 try{
  assert.equal((await storage.access(a,{action:'capacity'})).allowed,true);assert.equal(reads,1,'boot read refreshed once in current generation');
  assert.equal((await storage.access(a,{action:'capacity'})).allowed,true);assert.equal(reads,1,'valid readback reused');
  a.socialInbox.generation++;assert.equal((await storage.access(a,{action:'capacity'})).allowed,false);assert.equal(reads,1,'bounded refresh rate');
  a.storageReadbackAt=0;a.teamControl={};assert.equal((await storage.access(a,{action:'capacity'})).allowed,false);assert.equal(reads,1,'no read during another navigation owner');
  delete a.teamControl;a.v2.journal.rows.push({kind:'craft',status:'UNCERTAIN',at:start-100000,target:{id:'wing'}});assert.equal((await storage.access(a,{action:'capacity'})).allowed,false);assert.equal(reads,1,'unknown overlapping domain remains fenced without pointless requests');
 }finally{reader.readback=original;}
 console.log('PASS boot generation refresh, bounded native readback, owner and unknown-domain fencing');
})().catch(e=>{console.error(e);process.exitCode=1;});
