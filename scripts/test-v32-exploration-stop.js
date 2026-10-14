'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{BrainMemory}=require('../src/brain-memory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-exploration-'));try{
 const brain=new BrainMemory(root,'a'),p={version:2,actorId:'a',build:'b',stopRule:{maxActiveMs:5000,maxDeaths:0,stopOnUncertain:true}},i={actorIdentity:{actorId:'a'},catalog:()=>({build:'b'}),status:'playing',lastSaveAt:100,v2:{sourceCoherence:{matches:true},journal:{rows:[]}},livePos:{dead:false}};
 assert.throws(()=>brain.setStrategy('focus_gear','fixture',100,900000,p),/eligible_active/);brain.data.adviceExposure={version:1,samples:[{at:100,ms:100000,exploration:false}],failed:{}};
 brain.setStrategy('focus_gear','fixture',100,900000,p);brain.observeStrategy(i,100);i.lastSaveAt=3100;brain.observeStrategy(i,3100);assert.equal(brain.data.strategy.activeMs,3000);i.status='paused';brain.observeStrategy(i,4100);i.status='playing';i.lastSaveAt=5100;brain.observeStrategy(i,5100);assert.equal(brain.data.strategy.activeMs,3000);i.lastSaveAt=7100;assert.equal(brain.observeStrategy(i,7100),'active_time_budget');
 brain.setStrategy('focus_gear','fixture',8000,900000,p);i.livePos.dead=true;assert.equal(brain.observeStrategy(i,8001),'death');i.livePos.dead=false;assert.throws(()=>new BrainMemory(root,'a').setStrategy('focus_gear','same failed facts',9000,900000,p),/same_evidence_failed/);brain.setStrategy('focus_exp','fixture',9000,900000,p);i.v2.journal.rows=[{status:'UNCERTAIN'}];assert.equal(brain.observeStrategy(i,9001),'uncertain_paid');assert.equal(new BrainMemory(root,'a').data.strategy.stopReason,'uncertain_paid');
 const budget=new BrainMemory(root,'budget');budget.data.adviceExposure={version:1,samples:[{at:100000,ms:60000,exploration:false}],failed:{}};const long={...p,stopRule:{...p.stopRule,maxActiveMs:900000}};i.v2.journal.rows=[];i.lastSaveAt=100000;budget.setStrategy('focus_gear','budget',100000,900000,long);budget.observeStrategy(i,100000);let stopped;for(let t=101000;t<=110000;t+=1000){i.lastSaveAt=t;stopped=budget.observeStrategy(i,t);if(stopped)break;}assert.equal(stopped,'rolling_exploration_budget');assert.throws(()=>new BrainMemory(root,'budget').setStrategy('focus_exp','new text',110001,900000,long),/rolling_exploration/);
 const operational=new BrainMemory(root,'operational'),scope=require('../src/learning/strategy-scope');
 const op={...p,maxSpend:0,expiresAt:300000,stopRule:{maxActiveMs:60000,maxDeaths:0,stopOnUncertain:true}};
 i.v2.journal.rows=[{id:'historical',at:1,kind:'refine',status:'UNCERTAIN'}];i.lastSaveAt=200000;
 const original=JSON.stringify(i.v2.journal.rows);
 operational.setStrategy('focus_gear','native intent',200000,60000,op,{mode:'operational',uncertainBaseline:scope.uncertainty(i)});
 assert.equal(operational.observeStrategy(i,200000),null,'old uncertainty does not cancel intent');
 i.lastSaveAt=201000;assert.equal(operational.observeStrategy(i,201000),null,'ordinary strategies are not route experiments');
 assert.equal(new BrainMemory(root,'operational').strategy(201000).mode,'operational');
 assert.equal(JSON.stringify(i.v2.journal.rows),original,'no settlement or ledger mutation');
 i.v2.journal.rows.push({id:'new',at:201100,kind:'craft',status:'UNCERTAIN'});i.lastSaveAt=202000;
 assert.equal(operational.observeStrategy(i,202000),'uncertain_paid','new uncertainty stops operational plan');
 assert.throws(()=>operational.setStrategy('recover','not focus',203000,60000,op,{mode:'operational',uncertainBaseline:[]}),/Invalid operational/);
 console.log('PASS active-time/exploration boundaries and operational focus persistence, old-payment preservation, new uncertainty stop');
}finally{fs.rmSync(root,{recursive:true,force:true});}
