'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ActionJournal}=require('../src/runtime/action-journal'),{ResultLedger}=require('../src/result-ledger');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-journal-proof-'));
try{
 const j=new ActionJournal(root,'fixture'),before={coins:10000,potions:2,bagTier:0,storeTier:0};
 const context={actorId:'actor-one',generation:1,sessionStartedAt:10,build:'build-one',baselineRev:3};j.context=()=>context;
 const row=j.begin('bag-upgrade',{item:'bag-capacity',fromTier:0,price:1000},before,100,'build-one');j.sent(row,{ok:true});
 const after={...before,coins:9000,bagTier:1};j.observe(after,200);assert.equal(row.status,'OBSERVED');assert.equal(j.begin('bag-upgrade',{item:'bag-capacity'},after,201,'build-one'),null);
 const proof={...context,authority:'server_accepted_save',rev:4,requestAt:200,at:220};
 assert.equal(j.acknowledgeAcceptedSave(after,{...proof,actorId:'another'}),false);assert.equal(j.acknowledgeAcceptedSave({...after,coins:8000},proof),false);
 assert.equal(j.acknowledgeAcceptedSave(after,proof),true);assert.equal(j.view()[0].serverConfirmed,true);
 const purchase=j.beginSupply('Red Potion',after,300,'build-one',{minimum:10,limit:8,saveAt:290,sessionStartedAt:10});j.purchaseDispatch(purchase,after,310);
 const stocked={...after,coins:8200,potions:10};j.observe(stocked,320);j.sent(purchase,{ok:true,quantity:8,price:100});
 assert.equal(j.acknowledgeAcceptedSave(stocked,{...proof,requestAt:320,at:340,rev:5}),true);
 j.importLedger([{id:'observed',kind:'craft',target:{item:'something'},at:100,status:'change_observed',evidence:'outgoing_client_save'}],'build-one');assert.equal(j.pending('something').status,'OBSERVED');
 j.importLedger([{id:'observed',kind:'craft',target:{item:'something'},at:100,status:'server_confirmed',evidence:'server_accepted_exact_save_revision'}],'build-one');assert.equal(j.pending('something'),undefined);
 const ledger=new ResultLedger(root,0);ledger.rows=Array.from({length:125},(_,n)=>({id:String(n),at:1,kind:'other',status:'unresolved'}));assert.ok(ledger.begin('equip',{},before,200));assert.equal(ledger.rows.length,126,'unresolved evidence cannot be trimmed');
 console.log('PASS outgoing journal stays OBSERVED; exact actor/session/revision/bill receipts, safe imports and unresolved retention');
}finally{fs.rmSync(root,{recursive:true,force:true});}
