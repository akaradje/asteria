'use strict';
const assert=require('assert/strict'),vm=require('vm'),{potionBudget}=require('../src/runtime/potion-budget');
const base={coins:1007,price:100,have:8,minimum:10,essential:true,limit:20,reserve:1000};
assert.equal(potionBudget(base).qty,2,'near-reserve actor can obtain exactly missing minimum');
assert.equal(potionBudget({...base,essential:false}).qty,0,'optional purchases keep reserve');
assert.equal(potionBudget({...base,coins:199,have:0}).qty,1,'cannot exceed real affordability');
assert.equal(potionBudget({...base,coins:99}).qty,0);assert.equal(potionBudget({...base,have:10}).qty,0,'no emergency spend above minimum');
assert.equal(potionBudget({...base,minimum:20,have:18}).qty,2,'capped readiness needs twenty, not ten');
assert.equal(potionBudget({...base,coins:10000}).qty,20,'ordinary refill retains cash reserve');
 assert.equal(potionBudget({...base,coins:10000,limit:100,observedStock:true}).qty,80,'observed essential stock bounded at80');
 assert.equal(potionBudget({...base,coins:10000,limit:80}).qty,20,'unmeasured stock retains old20 cap');
 assert.equal(potionBudget({...base,coins:10000,limit:80,observedStock:true,essential:false}).qty,20,'optional purchases cannot use adaptive HP cap');
 assert.equal(potionBudget({...base,limit:80,observedStock:true}).qty,2,'emergency spend remains exactly missing minimum');
 assert.equal(potionBudget({...base,coins:10000,limit:80,essential:false,observedManaStock:true}).qty,80,'measured MP stock amortizes trips within native affordability');
 assert.equal(potionBudget({...base,limit:80,essential:false,observedManaStock:true}).qty,0,'MP stock never spends the HP/upgrade reserve as an emergency');
assert.equal(potionBudget({...base,price:NaN}).qty,0);assert.equal(potionBudget({...base,coins:NaN}).qty,0);
for(let coins=0;coins<3000;coins+=37)for(let have=0;have<=20;have++){const r=potionBudget({...base,coins,have});assert(r.qty*base.price<=coins);assert(r.qty<=20);if(r.emergency)assert(r.qty<=Math.max(0,10-have));}
const serialized=vm.runInNewContext(`(${potionBudget})`);assert.equal(serialized(base).qty,2,'native evaluator has no module dependency');
console.log('PASS HP emergency minimum, optional reserve, affordability, capped supply and serialized native budget');
