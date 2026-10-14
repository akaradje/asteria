'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {ActionScheduler}=require('../src/runtime/action-scheduler');
const {ActionJournal}=require('../src/runtime/action-journal');
const {roomPolicy}=require('../src/runtime/room-policy');
const {terminateTree}=require('../src/runtime/process-tree');
const {CapabilityPolicy}=require('../src/knowledge/capability-policy');
const {ContextLearning}=require('../src/learning/context-learning');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-runtime-v2-'));
 try{
  const s=new ActionScheduler(),order=[];let release;
  const a=s.run('travel',async()=>{order.push('travel');await s.run('nested',async()=>order.push('nested'));await new Promise(r=>release=r);order.push('end');});
  await new Promise(r=>setImmediate(r));
  const b=s.run('shop',async()=>order.push('shop')),c=s.run('recovery',async()=>order.push('recovery'),{priority:0});
  assert.equal(s.view().queued.length,2);release();await Promise.all([a,b,c]);assert.deepEqual(order,['travel','nested','end','recovery','shop']);
  const fail=s.run('fail',async()=>{throw Error('bad');});await assert.rejects(fail,/bad/);assert.equal(await s.run('next',async()=>4),4);
  const cancelled=new ActionScheduler();let end;const active=cancelled.run('a',async()=>{await new Promise(r=>end=r);cancelled.checkpoint();});
  await new Promise(r=>setImmediate(r));const queued=cancelled.run('b',async()=>assert.fail());const q=assert.rejects(queued,/shutdown/);cancelled.cancel('shutdown');end();await assert.rejects(active,/cancelled/);await q;
  for(const room of ['tw#1','dx#2','gd#3','gd1'])assert.equal(roomPolicy(room).allowTown,false);assert.equal(roomPolicy('town').allowTown,true);
  const j=new ActionJournal(root,'test'),r=j.begin('purchase',{item:'Red Potion'},{coins:500,potions:0},100,'build');j.sent(r,{ok:true});assert.equal(j.begin('purchase',{item:'Red Potion'},{},110,'build'),null);j.observe({coins:400,potions:0},30200);assert.equal(r.status,'UNCERTAIN');
  const blue=j.begin('purchase',{item:'Blue Potion'},{consumables:{'Blue Potion':0}},30300,'build');assert.ok(blue);j.sent(blue,{ok:true});j.observe({potions:0,consumables:{'Blue Potion':10}},30400);assert.equal(blue.status,'OBSERVED');assert.equal(r.status,'UNCERTAIN'); const recovered=new ActionJournal(root,'test');assert.equal(recovered.pending().status,'OBSERVED');recovered.observe({coins:400,potions:20},31000);assert.equal(recovered.rows.find(x=>x.id===r.id).status,'OBSERVED');assert.equal(recovered.rows.find(x=>x.id===r.id).evidence,'outgoing_client_save');
  const sourceDir=path.join(root,'cache/a/asteria-online.io');fs.mkdirSync(sourceDir,{recursive:true});for(const name of ['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js'])fs.writeFileSync(path.join(sourceDir,name),'explicit source fixture '+name);const identity=require('../src/knowledge/loaded-source').capture(root,'a');
  const policy=new CapabilityPolicy(root),knowledge={liveBuild:'a',current:{build:'a',sourceHashes:identity.sourceHashes,fingerprints:{routes:'r',investment:'i',worldTables:'w',bossMechanics:'b',client:'c'}}};assert.equal(policy.check(knowledge,'a','investment').allowed,false);policy.baseline(knowledge,'a','fixture evidence');assert.equal(policy.check(knowledge,'a','investment').allowed,true);knowledge.current.fingerprints.investment='changed';assert.equal(policy.check(knowledge,'a','investment').allowed,false);assert.equal(policy.check(knowledge,'old','travel').allowed,false);
  let now=1000;const learning=new ContextLearning(root,'tester',{now:()=>now}),i={lastSaveAt:now,lastSave:{lv:10,job:'mage',exp:1,coins:10,equip:{weapon:'a'}},livePos:{room:'w1',at:now}};learning.observe(i,'build1');now+=10000;i.lastSaveAt=now;i.livePos.at=now;i.lastSave.exp=101;learning.observe(i,'build1');assert.equal(learning.view()[0].exp,100);
  now+=10000;i.lastSaveAt=now;i.livePos.at=now;i.lastSave.exp=201;learning.observe(i,'build2');assert.equal(learning.view().length,1); // Never blend builds.
  const kills=[];await terminateTree(424242,{platform:'linux',list:()=>[424244,424243],kill:(pid,sig)=>kills.push([pid,sig])});assert.deepEqual(kills.slice(0,3),[[424244,'SIGTERM'],[424243,'SIGTERM'],[424242,'SIGTERM']]);
  console.log('runtime v2: serialization, nested ownership, priority, cancellation, room policy, durable purchases, build gates, context learning, Linux cleanup passed');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
