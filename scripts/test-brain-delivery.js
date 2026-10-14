'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {inventory,report}=require('../src/observability/brain-delivery'),root=path.resolve(__dirname,'..');
const spec=inventory(root);assert.equal(spec.packages.length,14);assert.equal(spec.cases.length,72);
const r=report(root,[{id:'A01',stage:'NATIVE_PASS',sourceRevision:'other',build:'b',at:1,file:'.env',sha256:'a'.repeat(64)}],{sourceRevision:'s',build:'b',now:100});assert.equal(r.complete,false);assert.equal(r.nativePassed,0);assert(r.cases.every(c=>c.status==='UNVERIFIED'));
console.log('PASS complete architecture requirement inventory; no completion inferred from missing, foreign source or unmatched evidence');
