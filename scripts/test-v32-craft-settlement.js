'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ResultLedger}=require('../src/result-ledger'),typed=require('../src/runtime/typed-upgrade-cost'),{ActionJournal}=require('../src/runtime/action-journal'),settle=require('../src/runtime/native-reservation-result');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'craft-settlement-'));
try{
 const catalog={build:'game',items:{old:{name:'Old Wing'},wing:{name:'New Wing'}}};
 const before={coins:1000,bag:[],equip:{wing:'old'},materials:{Plume:8},keyItems:{Seal:2}};
 const after={...before,coins:500,bag:[{id:'wing'}],equip:{wing:null},materials:{Plume:2},keyItems:{Seal:1}};
 const cost={Copper:500,'Old Wing':1,Plume:6,Seal:1};
 const context={actorId:'actor',sessionStartedAt:1,generation:1,build:'game',baselineRev:10};
 const proof={...context,authority:'server_accepted_save',requestAt:102,at:103,rev:11};
 function make(slot){const l=new ResultLedger(root,slot);l.context=context;l.expectedCost=cost;l.costCatalog=catalog;const row=l.begin('craft',{id:'wing'},before,100);l.observe(after,101);return {l,row};}
 const {l,row}=make('exact');assert.equal(row.costTypes['Old Wing'].group,'gear');assert.equal(row.costTypes.Seal.group,'keyItems');
 for(const patch of [{actorId:'other'},{generation:2},{build:'other'},{sessionStartedAt:2},{rev:10},{requestAt:99}])assert(!l.acknowledgeAcceptedSave(after,{...proof,...patch}));
 assert(!l.acknowledgeAcceptedSave({...after,coins:501},proof),'ACK of same output with wrong bill cannot confirm');
 assert(!l.acknowledgeAcceptedSave({...after,keyItems:{Seal:2}},proof));
 assert(l.acknowledgeAcceptedSave({...after,bag:[],equip:{wing:'wing'}},proof),'equipping the output must not lose its craft receipt');
 assert.equal(settle.result(row,'actor'),'CONFIRMED');
 const old=make('closed'),p={...proof,authority:'server_readback',sessionStartedAt:100000,requestAt:100001,at:100002,rev:20,generation:3};
 delete old.row.costTypes; // Existing persisted recipe before the typed-cost fix.
 const current={...after,coins:640,materials:{Plume:5},bag:[],equip:{wing:'wing'}};
 for(const patch of [{actorId:'other'},{build:'changed'},{rev:10},{generation:undefined},{sessionStartedAt:200},{requestAt:99999}])assert(!old.l.reconcileCraftState(current,{...p,...patch},catalog));
 assert(!old.l.reconcileCraftState({...current,equip:{wing:null}},p,catalog));
 const backup=old.row.after.keyItems.Seal;old.row.after.keyItems.Seal=2;assert(!old.l.reconcileCraftState(current,p,catalog));old.row.after.keyItems.Seal=backup;
 assert(old.l.reconcileCraftState(current,p,catalog));assert.equal(old.row.status,'reconciled_craft_state');assert.equal(old.row.reconciliation.costKnown,false);assert.equal(settle.result(old.row,'actor'),'RECONCILED');assert(!old.l.blocking('craft'));
 const journal=new ActionJournal(root,'actor');journal.importLedger([old.row],'game');assert.equal(journal.rows[0].status,'RECONCILED');assert.equal(journal.pending(),undefined);assert.equal(journal.view()[0].serverConfirmed,false);
 let status;settle.reconcile({actorIdentity:{actorId:'actor'},developmentLedger:old.l,v2:{reservations:{data:{claims:[{id:'claim',status:'UNCERTAIN',transactionId:old.row.id}]},finish:(id,s)=>{status=s;}}}});assert.equal(status,'RECONCILED');
 const legacy=make('legacy');legacy.row.legacyIdentityUnknown=true;assert(!legacy.l.reconcileCraftState(current,p,catalog));
 const unknown=make('unknown');unknown.row.expectedCost.Mystery=1;assert(!unknown.l.reconcileCraftState(current,p,catalog));
 assert.equal(typed.resolve({Seal:1},{...before,materials:{Seal:1}},catalog),null,'ambiguous namespaces fail closed');
 assert.equal(typed.resolve({Unknown:1},before,catalog),null);
 const lost=make('missing-receipt');lost.row.after=null;lost.row.status='unresolved';
 for(const patch of [{actorId:'other'},{authority:'server_accepted_save'},{sessionStartedAt:100},{rev:10},{requestAt:99999},{generation:undefined},{at:p.at+30001}])assert(!lost.l.rebaseUncertainCraft(before,{...p,...patch},catalog,p.at));
 assert(!lost.l.rebaseUncertainCraft({...before,coins:-1},p,catalog,p.at));
 assert(lost.l.rebaseUncertainCraft(before,p,{...catalog,build:'new'},p.at)===false,'old game readback cannot rebase another build');
 assert(lost.l.rebaseUncertainCraft(before,{...p,build:'new'},{...catalog,build:'new'},p.at),'current server wallet after closing old session can rebase budget across game updates');
 assert.equal(lost.row.status,'reconciled_craft_unknown');assert.equal(lost.row.reconciliation.currentOwned,0);assert.equal(lost.row.reconciliation.historicalSuccessKnown,false);assert.equal(settle.result(lost.row,'actor'),'RECONCILED');
 assert(lost.l.blocking('craft'),'unknown craft remains replay-blocked');assert.equal(lost.l.begin('craft',{id:'wing'},before,p.at+1),null);assert.equal(lost.l.pending(),undefined,'independent progression no longer waits on obsolete budget');
 const journal2=new ActionJournal(root,'missing-actor');journal2.importLedger([lost.row],'new');assert.equal(journal2.rows[0].status,'RECONCILED');assert.equal(journal2.view()[0].serverConfirmed,false);
 assert(!typed.matches(before,after,{Copper:-1},{Copper:{group:'currency',key:'coins'}}));
 console.log('PASS typed gear/key-item costs, exact native bill, output equip transition, closed-session current-state rebase, no historical payment claim, foreign/unknown rejection');
}finally{fs.rmSync(root,{recursive:true,force:true});}
