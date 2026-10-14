'use strict';
const assert=require('assert/strict'),{Federation}=require('../src/federation');
(async()=>{
 let now=20000,release;const calls=[];const delayed=new Promise(r=>release=r);
 const actor=name=>({status:'playing',credentials:{charName:name},towerQuery:()=>{calls.push(name+':tw');return name==='slow'?delayed:Promise.resolve({ok:true});},guildDungeonQuery:()=>{calls.push(name+':gd');return Promise.resolve({ok:true});}});
 const slow=actor('slow'),fast=actor('fast'),boot={...actor('boot'),status:'booting'};
 const fake={daily:{policy:{enabled:true}},now:()=>now,log:()=>{}};
 const refresh=()=>Federation.prototype.refreshDailyQuotas.call(fake,{instances:[slow,fast,boot]});
 refresh();await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['slow:tw','slow:gd','fast:tw','fast:gd']);
 now+=11000;refresh();await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c==='slow:tw').length,1,'in-flight query cannot overlap');assert.equal(calls.filter(c=>c==='fast:tw').length,2,'slow member cannot block other members');
 release();await new Promise(r=>setImmediate(r));assert.equal(slow.dailyQuotaQueryBusy,false);refresh();await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c==='slow:tw').length,2);
 console.log('PASS independent read-only quota heartbeat, both queries concurrent, no overlap, boot excluded, slow member isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
