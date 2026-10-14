const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Reports,summary,loadExpTable}=require('../src/reports');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-reports-'));
try{
  const r=new Reports(root,'test',[0,0,100,300,600]),t=Date.now();
  r.save(0,'Test',{lv:1,exp:90,coins:100},t);
  r.save(0,'Test',{lv:3,exp:20,coins:60},t+2000);
  let s=summary(r.data,t+2000).rows[0];assert.equal(s.exp,230);assert.equal(s.coins,-40);assert.equal(s.expPerHour,null);
  for(let i=2;i<=30;i++)r.save(0,'Test',{lv:3,exp:20+i,coins:60},t+i*2000);
  s=summary(r.data,t+60000).rows[0];assert.equal(s.observedMs,60000);assert.equal(s.expPerHour,s.exp*60);
  r.reset(0);r.save(0,'Test',{lv:3,exp:500,coins:1000},t+61000);assert.equal(summary(r.data,t+61000).rows[0].coins,-40);
  const p={room:'town',mv:1,dead:0};r.position(0,'Test',p,'playing',t);r.position(0,'Test',p,'playing',t+2000);
  r.position(0,'Test',{...p,dead:1},'playing',t+3000);r.position(0,'Test',{...p,dead:1},'playing',t+4000);
  r.reset(0);r.position(0,'Test',{...p,dead:1},'playing',t+10000);
  s=summary(r.data,t+10000).rows[0];assert.equal(s.deaths,1);assert.equal(s.activeMs,2000);assert.equal(s.movingMs,2000);
  r.flush(t+61000,true);const restored=new Reports(root,'test',[0,0,100,300,600]);assert.equal(summary(restored.data,t+61000).rows[0].exp,260);
  restored.save(0,'Test',{lv:3,exp:999,coins:9999},t+62000);assert.equal(summary(restored.data,t+62000).rows[0].coins,-40);
  assert.equal(summary(r.data,t+7200000).rows[0].exp,0);
  assert.ok(loadExpTable(path.resolve(__dirname,'..'),'5391707')[101]>0);
  console.log('PASS: multi-level EXP, net spending, rate warmup, reconnect gaps, death deduplication, movement time, persistence, rolling expiry, actual game curve');
}finally{fs.rmSync(root,{recursive:true,force:true});}
