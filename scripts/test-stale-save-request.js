'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require.resolve('../src/runtime/v2-instance'),'utf8');
const expression=source.match(/v\.resaveResult=await this\.eval\(`([^`]+)`\)/)[1];
let calls=0;const net={online:true,isConnected:()=>true,handlers:{resave:()=>calls++}};
const run=()=>vm.runInNewContext(expression,{window:{AsteriaNet:net}}).requested;
assert.equal(run(),true);assert.equal(calls,1);
for(const flag of ['pause','fixed','kicked']){net[flag]=true;assert.equal(run(),false);net[flag]=false;}
net.isConnected=()=>false;assert.equal(run(),false);assert.equal(calls,1);
console.log('PASS client resave request uses real saver and respects disconnected, trade, correction and kicked guards');
