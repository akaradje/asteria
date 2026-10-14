'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{ResultLedger}=require('../src/result-ledger');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-receipt-'));
try{const l=new ResultLedger(root,'a'),before={coins:1000,equip:{weapon:'w'},refine:{w:0},materials:{Ore:5}},after={...before,coins:900,refine:{w:1},materials:{Ore:4}};
 l.context={actorId:'actor',sessionStartedAt:1,generation:2,build:'build',baselineRev:10};l.expectedCost={Copper:100,Ore:1};const r=l.begin('refine',{id:'w'},before,100);l.observe(after,101);assert.equal(r.status,'change_observed');assert(l.blocking('refine'),'client state does not permit replay');
 const p={authority:'server_accepted_save',actorId:'actor',sessionStartedAt:1,generation:2,build:'build',requestAt:101,at:102,rev:11};
 assert(!l.acknowledgeAcceptedSave(after,{...p,authority:'outgoing_client_save'}));assert(!l.acknowledgeAcceptedSave(after,{...p,generation:1}));assert(!l.acknowledgeAcceptedSave({...after,refine:{w:2}},p));assert(!l.acknowledgeAcceptedSave(after,{...p,rev:10}));assert.equal(r.status,'change_observed');
 assert(l.acknowledgeAcceptedSave(after,p));assert.equal(r.status,'server_confirmed');assert(!l.acknowledgeAcceptedSave(after,p));assert(!l.blocking('refine'));
 const r2=l.begin('refine',{id:'w'},after,200);l.observe({...after,coins:800,materials:{Ore:4},refine:{w:2}},201);assert(!l.acknowledgeAcceptedSave({...after,coins:800,materials:{Ore:4},refine:{w:2}},{...p,requestAt:201,at:202,rev:12}),'unrelated resource change cannot confirm paid bill');assert(l.blocking('refine'));
 const settle=require('../src/runtime/native-reservation-result').result;assert.equal(settle(r,'actor'),'CONFIRMED');assert.equal(settle({...r,status:'change_observed'},'actor'),null);assert.equal(settle({...r,status:'spent_without_change'},'actor'),null);assert.equal(settle({...r,legacyIdentityUnknown:true},'actor'),null);assert.equal(settle({...r,serverReceipt:{...r.serverReceipt,generation:999}},'actor'),null);assert.equal(settle(r,'foreign-actor'),null);
 console.log('PASS T17/T26/T27 exact native accepted-save revision, actor/session/generation, target and bill; client observations and unrelated spending do not release claims');
}finally{fs.rmSync(root,{recursive:true,force:true});}
