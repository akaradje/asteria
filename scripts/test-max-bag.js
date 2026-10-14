'use strict';
const assert=require('assert/strict'),{plan,tick}=require('../src/runtime/max-bag');
const world={BAG_PRICES:[5000,20000,60000,150000],bagCap:t=>16+t*8};
(async()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{ActionJournal}=require('../src/runtime/action-journal');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-bag-test-'));
 try {const j=new ActionJournal(root,'fixture'),r=j.begin('bag-upgrade',{item:'bag-capacity-to-maximum',fromTier:1,price:20000},{bagTier:1,coins:500000},1000,'fixture');j.sent(r,{ok:true});
 assert.equal(j.reconcileBagLoad({bagTier:1},{at:2000,sessionStartedAt:500,rev:2}),false);assert(j.pending(r.target.item));
 assert(j.reconcileBagLoad({bagTier:1},{at:3000,sessionStartedAt:2500,rev:3}));assert.equal(r.status,'NOT_APPLIED');assert.equal(j.pending(r.target.item),undefined);
 const next=j.begin('bag-upgrade',r.target,{bagTier:1,coins:500000},4000,'fixture');j.sent(next,{ok:true});assert(j.reconcileBagLoad({bagTier:2},{at:6000,sessionStartedAt:5500,rev:4}));assert.equal(next.status,'CONFIRMED');assert.equal(next.evidence,'authoritative_server_load_after_session_restart');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
 const s={bagTier:1,coins:333000,lv:102};assert.equal(plan(s,world).remainingCost,230000);assert.equal(plan(s,world).maxCapacity,48);assert(plan(s,world).ready);
 assert(plan({bagTier:4,coins:0},world).complete);assert(!plan({coins:999999},world).ready);assert(!plan({bagTier:1,coins:21000,lv:102},world).ready);
 const i={lastSave:s,lastSaveAt:Date.now(),catalog:()=>({world}),livePos:{room:'e1'},canDo:()=>true,closeGamePanel:async()=>{},bagUpgrade:async opts=>{assert.equal(opts.toMaximum,true);i.lastSave={...i.lastSave,bagTier:i.lastSave.bagTier+1,coins:i.lastSave.coins-world.BAG_PRICES[i.lastSave.bagTier]};return {ok:true};}};
 for(let n=0;n<3;n++)assert((await tick(i,{})).includes('confirmed'));
 assert.equal(i.lastSave.bagTier,4);assert.equal(i.lastSave.coins,103000);assert.equal(await tick(i,{}),null);
 i.lastSave={...s};i.livePos.room='tw#1';assert.equal(await tick(i,{}),null);i.livePos.room='e1';i.pendingTravel={mapId:'e3'};assert.equal(await tick(i,{}),null);i.pendingTravel=null;
 i.lastSaveAt=Date.now()-40000;assert.equal(await tick(i,{}),null);
 console.log('PASS: live tier/price limits, 48 slots, sequential confirmation, upkeep reserve, no purchase after maximum, protected dungeon/travel and stale saves');
})().catch(e=>{console.error(e);process.exitCode=1;});
