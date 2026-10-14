'use strict';
const assert=require('assert/strict'),{exact,validState,validReceipt}=require('./create-guild-team');
const side=n=>({coins:n,gear:[],stacks:[]});
assert(exact(side(10000),10000));assert(!exact({...side(10000),gear:['x']},10000));assert(!exact({...side(10000),stacks:[['Ore',1]]},10000));assert(!exact(side(9999),10000));
const s={id:12,me:side(10000),them:side(0)};assert(validState(s,12,10000,true));assert(!validState(s,13,10000,true));assert(!validState({...s,dropped:['coins']},12,10000,true));assert(!validState(s,12,10000,false));
const r={id:12,with:'ExampleTankA',rev:5,gave:side(10000),got:side(0)};assert(validReceipt(r,12,'ExampleTankA',10000,true));assert(!validReceipt({...r,with:'Other'},12,'ExampleTankA',10000,true));assert(!validReceipt({...r,rev:null},12,'ExampleTankA',10000,true));assert(!validReceipt({...r,got:side(1)},12,'ExampleTankA',10000,true));
assert(validReceipt({...r,gave:{coins:10000},got:{}},12,'ExampleTankA',10000,true),'native tradeApply treats absent gear/stacks/zero coins as empty');
console.log('PASS exact Copper-only offers, session/partner/revision/receipt checks; no extra item or counterparty payment');
