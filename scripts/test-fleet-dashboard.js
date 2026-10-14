'use strict';
const assert=require('assert'),{assemble,clean}=require('../src/fleet-dashboard');
const now=Date.now();const stale=assemble({},now+60000);
assert.equal(stale.members.length,6);assert.equal(new Set(stale.members.map(m=>m.key)).size,6);
assert.equal(stale.online,0);assert.equal(stale.complete,false);
assert(stale.members.every(m=>!m.fresh&&!m.detailsFresh&&m.status==='stale'));
assert.deepEqual(clean({password:'secret',account:'private',nested:{token:'secret',lv:12}}),{nested:{lv:12}});
console.log('Fleet dashboard: six distinct identities, stale data, credential filtering passed');
