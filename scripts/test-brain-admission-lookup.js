'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DurableStore}=require('../src/runtime/durable-store'),{Authority}=require('../src/registry/authority');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-admission-lookup-'));let store;
try{store=new DurableStore(path.join(root,'db'));let a=new Authority(store,{now:()=>1000});
 const req={host:'tum',actorId:'actor-test',session:'session-test',snapshot:{at:1000,freeMb:4000},estimateMb:850,floorMb:750};
 const first=a.admit(req);a=new Authority(store,{now:()=>1000});assert.equal(a.capacityLookup(req).id,first.id);
 assert.equal(a.capacityLookup({...req,session:'other'}),null);assert.equal(a.capacityLookup({...req,host:'vps'}),null);assert.equal(a.capacityLookup({...req,actorId:'other'}),null);
 assert.equal(a.admit(req).id,first.id);assert.equal(a.capacity.view().heldMb,850);assert.throws(()=>a.capacitySettled({id:first.id,host:'tum',session:'other',proof:{contextClosed:true}}));
 assert(a.capacitySettled({id:first.id,host:'tum',session:'session-test',proof:{contextClosed:true}}).released);assert.equal(a.capacityLookup(req),null);assert.equal(a.capacity.view().heldMb,0);
 const late={...req,session:'late'};assert(a.capacityCancel({...late,proof:{contextClosed:true}}).closed);assert.throws(()=>a.admit(late),/positively closed/,'cancel tombstone blocks an admission delayed in transit');
 const pending={...req,session:'pending'};a.admit(pending);assert(a.capacityCancel({...pending,proof:{contextClosed:true}}).released);assert.equal(a.capacity.view().heldMb,0);
 console.log('PASS persisted lost-ACK lookup, exact host/actor/session, no duplicate grant, positive settlement');
}finally{store?.close();fs.rmSync(root,{recursive:true,force:true});}

async function workerRegression(){
 const crypto=require('node:crypto'),rpc=require('../src/registry/rpc'),worker=require('../src/registry/worker'),owners=require('../src/registry/browser-ownership');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-admission-worker-')),db=new DurableStore(path.join(tmp,'db'));
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');fs.mkdirSync(path.join(tmp,'logs/registry-keys'),{recursive:true});fs.writeFileSync(path.join(tmp,'logs/registry-keys/worker-private.pem'),privateKey.export({type:'pkcs8',format:'pem'}));
 const originalFree=os.freemem;os.freemem=()=>4000*1048576;
 const authority=new Authority(db),server=rpc.server(authority,{hosts:{tum:{publicKey,names:['Fixture']}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const actorId='actor-'+ 'a'.repeat(32),accountId='account-'+ 'b'.repeat(32),old='orphan-session-123',session=crypto.randomUUID();
  const i={root:tmp,machine:'tum',actorIdentity:{actorId,accountId,name:'Fixture',policyRevision:1},actorOwner:{session},registryV32:{store:db,policy:{policyRevision:1,globalAuthority:{enabled:true,loopbackPort:server.address().port,capacity:{enabled:true,estimateMb:200,floorMb:500}}}}};
  db.putDocument('capacity-request:'+old,{host:'tum',actorId,session:old,state:'REQUESTED'});
  assert.equal((await owners.reconcile(tmp,old)).closed,false);
  await worker.claim(i);
  assert.equal(db.document('capacity-request:'+old).state,'CAPACITY_SETTLED');
  assert.equal((await owners.reconcile(tmp,old)).closed,false,'RAM-only recovery must not invent browser closure');
  assert.throws(()=>authority.admit({host:'tum',actorId,session:old,snapshot:{at:Date.now(),freeMb:4000},estimateMb:200,floorMb:500}),/positively closed/,'late request sealed durably');
  assert(fs.existsSync(path.join(tmp,'logs/browser-owners',session+'.json')),'intent persisted before browser launch');
  i.status='playing';i.bagSessionStartedAt=123;i.serverSaveObservation={actorId,sessionStartedAt:123,at:Date.now()};
  await worker.settled(i);assert.equal(db.document('capacity-request:'+session).state,'CAPACITY_SETTLED');
  assert.equal(db.document('capacity-request:'+session).evidence,'fresh_native_loaded');await worker.close(i);
  const blocked='unclosed-session-123';authority.admit({host:'tum',actorId,session:blocked,snapshot:{at:Date.now(),freeMb:4000},estimateMb:200,floorMb:500});
  db.putDocument('capacity-request:'+blocked,{host:'tum',actorId,session:blocked,state:'REQUESTED'});i.actorOwner={session:crypto.randomUUID()};i.globalAssignment=null;
  await assert.rejects(()=>worker.claim(i),/not positively closed/);
  assert.throws(()=>authority.capacityCancel({host:'tum',actorId,session:blocked,proof:{reservationAbsent:true}}),/atomically absent/,'concurrent admitted request cannot be cleared by absence proof');
  assert(authority.capacityLookup({host:'tum',actorId,session:blocked}));
  authority.capacityCancel({host:'tum',actorId,session:blocked,proof:{contextClosed:true}});
  await worker.claim(i);const closeSession=i.actorOwner.session;await worker.close(i);
  assert.equal(db.document('capacity-request:'+closeSession).evidence,'context_closed');
  i.actorOwner={session:crypto.randomUUID()};i.globalAssignment=null;os.freemem=()=>550*1048576;
  await assert.rejects(()=>worker.claim(i),/authority_precondition_failed/,'real signed admission still rejects insufficient simulated headroom');
  assert.equal(db.document('capacity-request:'+i.actorOwner.session).state,'REQUESTED','denied grant retains durable intent until close');await worker.close(i);
  console.log('PASS worker missing-history RAM-only recovery, late-request fencing, durable native/close settlement and active-browser quarantine');
 }finally{os.freemem=originalFree;await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(tmp,{recursive:true,force:true});}
}
workerRegression().catch(e=>{console.error(e);process.exitCode=1;});
