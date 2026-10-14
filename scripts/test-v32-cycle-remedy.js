'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),trade=require('../src/runtime/team-trade');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-soft-cycle-'));const now=Date.now();
try{const i={root,character:{name:'Receiver'},lastSaveAt:now,lastSave:{bagTier:0,bag:[{id:'w'}]},livePos:{room:'town',at:now},v2:{sourceCoherence:{matches:true}},catalog:()=>({build:'b',world:{bagCap:()=>2}}),tradeJournal:{id:'x',phase:'GATHERING',sent:{},at:now},tradeJournalFile:path.join(root,'trade.json'),teamTradeIntent:{id:'x',phase:'GATHERING',build:'b',deadline:now+60000,offer:{kind:'gear',receiver:'Receiver'}}};
 assert.equal(trade.cancelUncommittedForSpace(i,now),true);assert.equal(i.teamTradeStatus.phase,'CANCELLED');assert.equal(i.teamTradeStatus.noDispatch,true);assert.equal(i.teamTradeIntent.phase,'GATHERING','original coordinator is preserved until peer acknowledgements');
 i.tradeJournal.phase='GATHERING';i.tradeJournal.sent.request=true;assert.equal(trade.cancelUncommittedForSpace(i,now),false);i.tradeJournal.sent={};i.teamControl={};assert.equal(trade.cancelUncommittedForSpace(i,now),false);
 console.log('PASS T90/T93 soft inventory-trade cycle remedy releases only proven undispatched intent; committed/native and team ownership preserved');
}finally{fs.rmSync(root,{recursive:true,force:true});}
