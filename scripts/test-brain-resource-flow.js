'use strict';
const assert=require('node:assert/strict'),{pair,costEvidence}=require('../src/learning/resource-flow');
const a={transferId:'t',actorId:'a',build:'b',authority:'server_accepted_exact_save_revision',rev:1,at:10,flows:[{resource:'Ore',direction:'out',amount:3}]},b={...a,actorId:'b',flows:[{resource:'Ore',direction:'in',amount:3}]};
assert.equal(pair(a,null).usable,false);assert.equal(pair(a,b).netTeamIncome,0);assert.equal(pair(a,{...b,build:'new'}).usable,false);assert.equal(pair(a,{...b,flows:[{resource:'Ore',direction:'in',amount:2}]}).state,'CONFLICT');
const p={actorId:'a',build:'b',at:100},cycle={startedAt:10,goal:{id:'wing'}},e={id:'x',kind:'craft',target:{id:'wing'},context:{actorId:'a',build:'b'},evidence:'server_accepted_exact_save_revision',status:'server_confirmed',serverReceipt:{at:90},cost:{Copper:10}};
assert.equal(costEvidence(e,cycle,p).scope,'goal');assert.equal(costEvidence({...e,target:{id:'unrelated'}},cycle,p).scope,'concurrent');assert.equal(costEvidence({...e,serverReceipt:{at:101}},cycle,p),null);assert.equal(costEvidence({...e,cost:{Copper:-1}},cycle,p).known,false);assert.equal(costEvidence({...e,status:'UNCERTAIN'},cycle,p),null);
console.log('PASS paired transfer balance, identity/build, no team income duplication, goal-scoped costs and pending/future receipt exclusion');
