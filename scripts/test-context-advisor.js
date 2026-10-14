'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {ContextLearning}=require('../src/learning/context-learning');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-context-'));
try{
 let now=1000;const l=new ContextLearning(root,'account',{now:()=>now});
 const i={lastSave:{job:'mage',lv:10,exp:0,coins:100,equip:{armor:'a',weapon:'w'}},lastSaveAt:now,livePos:{room:'w1',at:now}};
 function sample(room,exp){now+=30000;i.lastSaveAt=now;i.livePos={room,at:now};i.lastSave.exp=exp;l.observe(i,'build');}
 l.observe(i,'build');for(let n=1;n<=11;n++)sample('w1',n*100);
 const count=l.view()[0].samples;now+=1000;i.livePos.at=now;l.observe(i,'build');assert.equal(l.view()[0].samples,count,'same save is not a second independent sample');
 i.lastSave.equip={weapon:'w',armor:'a'};sample('w2',1200);for(let n=1;n<=11;n++)sample('w2',1200+n*200);
 const maps=[{id:'w1',kind:'field',levelMin:1},{id:'w2',kind:'field',levelMin:10}];
 assert.equal(l.recommend(i.lastSave,'build',maps,{},'w1').mapId,'w2');
 assert.equal(l.recommend(i.lastSave,'new-build',maps,{},'w1'),null);
 assert.equal(l.recommend({...i.lastSave,equip:{weapon:'changed'}},'build',maps,{},'w1'),null);
 assert.equal(l.recommend({...i.lastSave,skills:{newSkill:1}},'build',maps,{},'w1'),null);
 assert.equal(l.recommend(i.lastSave,'build',maps,{w2:true},'w1'),null);
 const restarted=new ContextLearning(root,'account',{now:()=>now});assert.equal(restarted.recommend(i.lastSave,'build',maps,{},'w1').mapId,'w2');
 const best=Object.values(restarted.data.contexts).find(r=>r.map==='w2'),current=Object.values(restarted.data.contexts).find(r=>r.map==='w1');best.exp=current.exp*1.1;best.elapsedMs=current.elapsedMs;assert.equal(restarted.recommend(i.lastSave,'build',maps,{},'w1'),null,'small gain should not switch maps');
 now+=86400001;assert.equal(restarted.recommend(i.lastSave,'build',maps,{},'w1'),null);
 console.log('PASS durable comparable context advisor: duplicate saves, key order, build/gear isolation, blocked maps, restart and expiry');
}finally{fs.rmSync(root,{recursive:true,force:true});}
