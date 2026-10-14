'use strict';
const assert=require('assert/strict'),economy=require('../src/economy');
const {premiumPlan,refineTarget}=require('../src/power-plan');
const cat=economy.loadCatalog(process.cwd(),'957eabb');
assert(cat.world.PREMIUM.length>0);
for(const job of ['dawnwarden','nightfang','starweaver','lumenoracle','ranger','monk']){
 const s={coins:650,owned:[],worn:{}};const p=premiumPlan(cat.world.PREMIUM,s,job,cat.world);
 assert(p.cost<=650);assert.equal(new Set(p.items.map(i=>i.slot)).size,p.items.length);
 assert(p.items.every(i=>i.score>0));
 if(['starweaver','lumenoracle'].includes(job))assert(p.items.some(i=>i.id==='aura_frost'));
 if(['nightfang','monk'].includes(job))assert(p.items.some(i=>i.id==='aura_ember'));
 const worn=Object.fromEntries(p.items.map(i=>[i.slot,i.id]));
 assert.equal(premiumPlan(cat.world.PREMIUM,{coins:0,owned:p.items.map(i=>i.id),worn},job,cat.world).items.length,0);
 console.log(job, p.items.map(i=>i.name).join(', '),p.cost);
}
const free=premiumPlan(cat.world.PREMIUM,{coins:0,owned:['aura_frost'],worn:{}},'starweaver',cat.world);assert(free.items.some(i=>i.id==='aura_frost'));assert.equal(free.cost,0);
assert.equal(refineTarget({tier:3}),4);assert.equal(refineTarget({tier:6}),10);
const items={low:{tier:1,name:'low'},high:{tier:6,name:'high'}};
const p=economy.refinePlan({equip:{weapon:'high',head:'low'},refine:{high:9,low:4},materials:{Starmetal:99},coins:99999,items});assert.equal(p.doable.length,1);assert.equal(p.doable[0].to,10);
console.log('PASS wallet bounds, owned items, unique slots, no repurchases, role choices and +10/+4 targets');
