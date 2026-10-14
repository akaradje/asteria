'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DurableStore}=require('../src/runtime/durable-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-v32-ledger-')),file=path.join(root,'store.db');
let db=new DurableStore(file);
try{
 const args={actorId:'a',session:'s',generation:1,kind:'craft',bill:{Copper:10},available:{Copper:15},at:1};
 const row=db.begin({...args,id:'one'});assert.throws(()=>db.begin({...args,id:'two'}));assert.deepEqual(db.held('a'),{Copper:10});assert.deepEqual(db.held('other'),{});
 assert.throws(()=>db.receipt(row.id,{receiptId:'bad',actorId:'a',session:'s',generation:1,kind:'craft',authority:'outgoing_client_save',at:2,applied:true,proof:{}}));
 db.sent(row.id,2);db.observed(row.id,{authority:'outgoing_client_save'});assert.equal(db.get(row.id).status,'OBSERVED');
 db.close();db=new DurableStore(file);assert.equal(db.recover('a'),1);assert.equal(db.get(row.id).status,'UNCERTAIN');
 assert.throws(()=>db.begin({...args,id:'one'}));assert.throws(()=>db.begin({...args,id:'three'}));
 const receipt={receiptId:'receipt1',actorId:'a',session:'s',generation:1,kind:'craft',authority:'server_socket',at:3,applied:true,proof:{item:'native-outcome'}};
 assert.throws(()=>db.receipt('one',{...receipt,session:'other'}));db.receipt('one',receipt);db.receipt('one',receipt);
 assert.equal(db.get('one').status,'CONFIRMED');db.begin({...args,id:'four'});
 assert.equal(db.importDocument('legacy',{rows:[{status:'UNCERTAIN'}]}).imported,true);
 assert.equal(db.importDocument('legacy',{rows:[]}).imported,false);assert.equal(db.document('legacy').rows.length,1);
 const owner=db.acquire({accountId:'account',actorId:'a',host:'host',pid:1});assert(db.validateOwner(owner));
 assert.throws(()=>db.acquire({accountId:'account',actorId:'a',host:'host',pid:1}),/drained/,'same-process second browser cannot reuse an account grant');assert.equal(db.acquire({accountId:'account',actorId:'a',host:'host',pid:1,session:owner.session}).generation,1);
 assert.throws(()=>db.acquire({accountId:'account',actorId:'b',host:'other',pid:2}));
 assert.throws(()=>db.stopOwner(owner,{closed:false}));db.stopOwner(owner,{closed:true});
 const next=db.acquire({accountId:'account',actorId:'b',host:'other',pid:2});assert.equal(next.generation,2);assert(!db.validateOwner(owner));
 console.log('PASS durable intent-before-send, crash uncertainty, replay/resource holds, exact receipt, idempotent import and owner fencing');
}finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
