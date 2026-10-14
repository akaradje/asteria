'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {Reports}=require('../src/reports');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'personal-history-'));
try{
 const t=Date.now(),r=new Reports(root,'build-one',[0,0,100]);
 const save={lv:1,exp:1,coins:100,job:'mage',pts:5,st:{int:8},skills:{bolt:2},equip:{weapon:'staff'},password:'NEVER_STORE',token:'NEVER_STORE',materials:{ore:3}};
 r.save(0,'First',save,t);r.damage(0,'First',321,t+1000);r.event(0,'goal','hunt',t+1000);r.flush(t+2000,true);
 const firstId=r.personalHistory.identity('First'),file=path.join(root,'logs/personal-history',firstId,new Date(t).toISOString().slice(0,10)+'.json');
 let d=JSON.parse(fs.readFileSync(file));assert.equal(d.snapshots[0].state.st.int,8);assert.equal(d.snapshots[0].state.pts,5);assert.equal(d.snapshots[0].state.materials.ore,3);assert(!fs.readFileSync(file,'utf8').includes('NEVER_STORE'));assert.equal(Object.values(d.minutes)[0].damage,321);
 r.save(0,'Second',save,t+3000);r.flush(t+4000,true);assert.equal(JSON.parse(fs.readFileSync(file)).character,'First');
 const restored=new Reports(root,'build-two',[0,0,100]);restored.save(0,'First',save,t+65000);restored.damage(0,'First',45,t+65000);restored.flush(t+66000,true);
 d=JSON.parse(fs.readFileSync(file));assert(d.snapshots.some(s=>s.build==='build-one'));assert(d.snapshots.some(s=>s.build==='build-two'));assert.equal(Object.values(d.minutes).reduce((sum,b)=>sum+b.damage,0),366);
 assert(d.events.some(e=>e.text==='hunt'));assert.notEqual(firstId,r.personalHistory.identity('Second'));
 console.log('PASS personal identity isolation, restart persistence, version separation, damage history, progression snapshots and credential exclusion');
}finally{fs.rmSync(root,{recursive:true,force:true});}
