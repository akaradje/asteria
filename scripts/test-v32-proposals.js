'use strict';
const assert=require('node:assert/strict'),{facts,verify}=require('../src/learning/proposal-contract');
const m={actorId:'a',slot:0,build:'b',level:120,status:'playing',saveAgeSeconds:1,currentGoal:{label:'Legendary'},personalBrain:{coins:100,reserve:50}},at=100000;
const evidenceIds=facts(m).map(e=>e.id),p={evidenceIds,assumptions:['Net benefit unknown'],effects:[{kind:'refine',direction:'improve',basis:'proposal_only'}],stopRule:{maxActiveMs:100000,maxDeaths:0,stopOnUncertain:true}};
const r=verify(p,m,{snapshotAt:new Date(at).toISOString(),now:at+1000});assert.equal(r.maxSpend,0);assert.equal(r.confirmed,false);assert.equal(r.actorId,'a');
assert.throws(()=>verify({...p,evidenceIds:['invented']},m,{snapshotAt:new Date(at).toISOString(),now:at+1000}));assert.throws(()=>verify({...p,effects:[{...p.effects[0],gain:999}]},m,{snapshotAt:new Date(at).toISOString(),now:at+1000}));assert.throws(()=>verify({...p,stopRule:{...p.stopRule,maxDeaths:3}},m,{snapshotAt:new Date(at).toISOString(),now:at+1000}));assert.throws(()=>verify(p,m,{snapshotAt:new Date(at).toISOString(),now:at-1}));
console.log('PASS T84/T86/T87 bounded evidence references, assumptions, no invented gain, endgame effects, actor scope and zero-spend stop rule');
