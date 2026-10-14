'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{ActionJournal}=require('../src/runtime/action-journal'),{GameInstance}=require('../src/instance');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-bag-'));try{
 let calls=0;const i={root,storageSlot:2,cache:{dir:path.join(root,'test')},credentials:{username:'fixture'},livePos:{room:'town',at:Date.now()},lastSaveAt:Date.now(),lastSave:{job:'monk',lv:100,bagTier:0,coins:20000},catalog:()=>({world:{BAG_PRICES:[5000,20000]}})};
 i.bagJournal=new ActionJournal(root,'fixture');const context={actorId:'actor-one',generation:1,sessionStartedAt:Date.now()-1000,build:'test',baselineRev:1};i.bagJournal.context=()=>context;
 i.openGamePanel=async()=>({ok:true});i.closeGamePanel=async()=>{};i.eval=async code=>{if(code.includes('const gear='))return true;calls++;i.lastSave={...i.lastSave,bagTier:1,coins:15000};i.lastSaveAt=Date.now()+1;i.bagJournal.acknowledgeAcceptedSave(i.lastSave,{...context,authority:'server_accepted_save',rev:2,requestAt:i.lastSaveAt,at:i.lastSaveAt+1});return true};
 const result=await GameInstance.prototype.bagUpgrade.call(i);assert(result.ok);assert.equal(calls,1);assert.equal(i.bagJournal.rows[0].status,'CONFIRMED');
 i.lastSave={...i.lastSave,bagTier:0,coins:14999};assert.equal((await GameInstance.prototype.bagUpgrade.call(i)).reason,'bag-upgrade-reserve-required');assert.equal(calls,1);
 i.catalog=()=>({world:{BAG_PRICES:[5000,20000],bagCap:t=>16+t*8}});i.lastSave={...i.lastSave,bagTier:2};assert.equal((await GameInstance.prototype.bagUpgrade.call(i)).reason,'bag-max-tier');assert.equal(calls,1,'native maximum never opens paid UI');i.lastSave.bagTier=3;assert.equal((await GameInstance.prototype.bagUpgrade.call(i)).reason,'bag-price-unverified','out-of-schema tier is not a native maximum');
 const j=new ActionJournal(root,'uncertain'),save={bagTier:0,coins:20000},at=Date.now(),row=j.begin('bag-upgrade',{item:'bag-capacity',fromTier:0},save,at,'test');j.sent(row,{ok:true});j.observe({...save,coins:15000},at+31000);assert.equal(row.status,'UNCERTAIN');
 const restarted=new ActionJournal(root,'uncertain');assert.equal(restarted.begin('bag-upgrade',{item:'bag-capacity',fromTier:0},save,at+40000,'test'),null,'uncertain payment cannot be replayed');
 restarted.observe({...save,bagTier:1,coins:15000},at+50000);assert.equal(restarted.rows[0].status,'OBSERVED');assert(restarted.pending(),'observed outcome stays blocked until native receipt');
 console.log('PASS paid bag expansion confirmed by tier, reserve preserved, spending alone insufficient and restart does not replay');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
