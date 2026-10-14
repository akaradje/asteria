'use strict';
const assert=require('assert/strict'),{readyBuild,developmentSample}=require('../src/observability/soak-evidence');
const members=Array.from({length:6},(_,n)=>({key:'slot'+n,online:true,detailsFresh:true,details:{fpsFresh:true,developmentProgress:{at:100,saveAt:99,stage:'craft',confirmed:[{at:70,kind:'craft'},{at:110,kind:'equip',target:{id:'w'},evidence:'outgoing_client_save'}]}}}));
const fleet={machines:{windows:{build:'current'},tum:{build:'current'}},online:6,complete:true,members};
assert.equal(readyBuild(fleet),'current');assert.equal(readyBuild({...fleet,machines:{windows:{build:'old'},tum:{build:'current'}}}),null);assert.equal(readyBuild({...fleet,members:[...members.slice(1),members[1]]}),null);assert.equal(readyBuild({...fleet,members:members.map((m,n)=>n?m:{...m,detailsFresh:false})}),null);
assert.deepEqual(developmentSample(members[0],100).confirmed,[{at:110,kind:'equip',target:{id:'w'},evidence:'outgoing_client_save'}]);assert.equal(developmentSample({...members[0],detailsFresh:false},100),null);
console.log('PASS matching loaded build and six fresh distinct accounts; old/stale development outcomes excluded from this run');
