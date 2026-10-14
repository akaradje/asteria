'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {Reports,summary}=require('../src/reports');
const {CombatObserver}=require('../src/runtime/combat-observer');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-statistics-'));
try{
 const t=Math.floor(Date.now()/60000)*60000+1000,r=new Reports(root,'fixture',[0,0,100,300]);let now=t;
 const observer=new CombatObserver(r,0,()=> 'Player',{now:()=>now});
 observer.receive(JSON.stringify({t:'dmgs',l:[[1,999,7]]}));assert.equal(Object.keys(r.data.slots).length,0,'no attribution before welcome');
 observer.receive(JSON.stringify({t:'b',l:[{t:'welcome',id:7},{t:'dmgs',l:[[1,200,7],[2,500,8],[3,100,'7'],[4,-10,7],[5,'99',7]]}]}));
 observer.receive(JSON.stringify({t:'hit',l:[[1,999]]}));
 observer.receive(JSON.stringify({t:'dmgs',l:[[1,300,7]]}));
 r.position(0,'Player',{room:'w1',dead:0,mv:0},'playing',t);
 r.position(0,'Player',{room:'w1',dead:0,mv:0},'playing',t+2000);
 r.save(0,'Player',{lv:1,exp:1,coins:100,bestiary:{rat:10}},t);
 r.save(0,'Player',{lv:1,exp:10,coins:75,bestiary:{rat:12}},t+2000);
 const result=summary(r.data,t+3000),p=result.series[0].points[0];
 assert.equal(p.damage,600);assert.equal(p.hits,3);assert.equal(p.maxHit,300);assert.equal(p.dps,300);assert.equal(p.kills,2);assert.equal(p.coins,-25);
 observer.receive('{bad json');assert.equal(summary(r.data,t+3000).series[0].points[0].damage,600);
 r.data.slots[1]={slot:1,name:'Legacy',buckets:[{at:t-3*3600000,exp:15,coins:10}]};
 const legacy=summary(r.data,t).series.find(x=>x.slot===1);assert.equal(legacy.points.length,1,'24h history includes older EXP');assert.equal(legacy.points[0].damage,null,'historical damage never fabricated');
 r.flush(t+3000,true);const restored=new Reports(root,'fixture',[0,0,100,300]);assert.equal(summary(restored.data,t+3000).series[0].points[0].damage,600);
 console.log('PASS server-confirmed own damage, batched frames, foreign damage rejection, DPS denominator, kill deltas, net spending, 24h history and persistence');
}finally{fs.rmSync(root,{recursive:true,force:true});}
