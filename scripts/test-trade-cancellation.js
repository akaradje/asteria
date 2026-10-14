'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{reconcileUnsentCancellation}=require('../src/runtime/team-trade');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-trade-cancel-'));
try{
 const actor=()=>({teamTradeIntent:{id:'cancelled',phase:'CANCELLED',reason:'receiver inventory unavailable'},tradeJournal:{id:'cancelled',phase:'READY',sent:{}},tradeJournalFile:path.join(dir,'actor.json')});
 const i=actor();assert(reconcileUnsentCancellation(i));assert.equal(i.teamTradeStatus.phase,'CANCELLED');assert.equal(JSON.parse(fs.readFileSync(i.tradeJournalFile)).evidence,'no_server_trade_command_dispatched');assert(!reconcileUnsentCancellation(i),'terminal ack is idempotent');
 for(const changed of [{sessionId:1},{sent:{request:true}},{sent:{offer:true}},{sent:{confirm:true}},{receipt:{id:1}},{phase:'UNCERTAIN'},{id:'other'},{sent:null}]){const a=actor();Object.assign(a.tradeJournal,changed);assert(!reconcileUnsentCancellation(a),'sent/session/unknown/mismatched journal is never cleared');assert.equal(a.teamTradeStatus,undefined);}
 const uncertain=actor();uncertain.teamTradeIntent.phase='UNCERTAIN';assert(!reconcileUnsentCancellation(uncertain));
 console.log('PASS durable cancelled ack before dispatch; refuse sent/session/receipt/uncertain/mismatch and missing evidence; idempotent no replay');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
