'use strict';
const assert=require('node:assert/strict'),{contract}=require('../src/runtime/action-contract'),{ActionScheduler}=require('../src/runtime/action-scheduler'),{GameInstance}=require('../src/instance');
(async()=>{
 let now=1000,valid=true;const i={page:{},buildHash:'b',actorIdentity:{actorId:'a'},actorOwner:{id:'owner'},registryV32:{policy:{policyRevision:1},store:{validateOwner:()=>valid}},socialInbox:{generation:1},lastSaveAt:now,livePos:{at:now}},s=new ActionScheduler({now:()=>now});
 const queued=contract(i,'recycle',{recovery:true,now:()=>now});i.socialInbox.generation=2;assert.throws(()=>queued.beginRecovery(),/generation/,'queued stale recovery cannot adopt another session');
 const recovery=contract(i,'recycle',{recovery:true,now:()=>now});const paid=contract(i,'craft',{now:()=>now});
 await s.run('recycle',async()=>{recovery.beginRecovery();i.page={};i.socialInbox={generation:0};s.checkpoint();i.socialInbox.generation=1;s.checkpoint();assert.throws(()=>s.validate(paid),/generation/);i.actorIdentity.actorId='other';assert.throws(()=>s.checkpoint(),/actor identity/);i.actorIdentity.actorId='a';valid=false;assert.throws(()=>s.checkpoint(),/owner fence/);valid=true;i.buildHash='new';assert.throws(()=>s.checkpoint(),/build/);i.buildHash='b';},{contract:recovery});
 const ordinary=contract(i,'craft',{recovery:true,now:()=>now});assert.throws(()=>ordinary.beginRecovery(),/Not a native/);
 let screens=0;await assert.rejects(GameInstance.prototype.bootToGame.call({screen:async()=>{screens++;throw Error('action contract rejected: owner fence');},log(){}},240000),/owner fence/);assert.equal(screens,1,'permanent fence exits boot promptly instead of four-minute retry loop');
 s.profiler?.close();console.log('PASS exact queued generation, active recovery transition, paid/actor/owner/build fences and boot fail-fast');
})().catch(e=>{console.error(e);process.exitCode=1;});
