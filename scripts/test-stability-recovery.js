'use strict';
const assert=require('assert/strict'),{contract}=require('../src/runtime/action-contract'),{ActionScheduler}=require('../src/runtime/action-scheduler');
(async()=>{
 let now=1000000;const i={page:{},lastSaveAt:now,livePos:{at:now},buildHash:'fixture'},clock=()=>now;
 const recovery=contract(i,'recycle',{recovery:true,now:clock}),purchase=contract(i,'restockPotions',{now:clock});
 assert.equal(recovery.deadline-now,900000);assert.equal(purchase.deadline-now,180000);
 const scheduler=new ActionScheduler({now:clock});
 await scheduler.run('recycle',async()=>{now+=240001;scheduler.checkpoint();},{contract:recovery});
 assert.throws(()=>scheduler.validate(purchase),/expired/,'recovery does not extend paid actions');
 now=1000000;const limit=contract(i,'hardReload',{recovery:true,now:clock});
 await assert.rejects(scheduler.run('hardReload',async()=>{now+=900001;scheduler.checkpoint();},{contract:limit}),/duration exceeded|expired/,'recovery remains bounded');
 console.log('PASS native boot beyond three minutes, bounded recovery hard deadline and unchanged paid-action deadline');
})().catch(e=>{console.error(e);process.exitCode=1;});
