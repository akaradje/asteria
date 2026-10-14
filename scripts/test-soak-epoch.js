'use strict';
const assert=require('assert/strict'),fs=require('fs'),{aligned}=require('./soak-epoch'),now=Date.now();
const host=()=>({running:true,snapshotAt:new Date(now-1000).toISOString(),version:{at:now-1000,build:'b',sourceRevision:'core',loadedSystemRevision:'core',aligned:true}});
const fleet={machines:{windows:host(),tum:host()}};assert(aligned(fleet,'core','b',now));
for(const patch of [{sourceRevision:'other'},{loadedSystemRevision:'old'},{build:'other'},{at:now+1},{at:now-600001},{aligned:false}]){const fixture=structuredClone(fleet);Object.assign(fixture.machines.tum.version,patch);assert(!aligned(fixture,'core','b',now));}
for(const patch of [{running:false},{snapshotAt:new Date(now-45001).toISOString()},{snapshotAt:new Date(now+1).toISOString()},{version:null}]){const fixture=structuredClone(fleet);Object.assign(fixture.machines.windows,patch);assert(!aligned(fixture,'core','b',now));}
assert(!aligned(fleet,undefined,'b',now));assert(!aligned(fleet,'core',null,now));
const script=fs.readFileSync('scripts/soak-fleet.js','utf8');assert(script.includes('sourceMismatchSamples===0'));assert(script.includes('sourceAligned,versions:'));
console.log('PASS current loaded/source/build epoch, fresh host/version evidence, no future/missing observations and per-sample code-mismatch acceptance guard');
