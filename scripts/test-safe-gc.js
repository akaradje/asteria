'use strict';
const assert=require('assert/strict');
const {GameInstance}=require('../src/instance');
(async()=>{
 const calls=[];const cdp={async send(name){calls.push(name);return name==='Performance.getMetrics'?{metrics:[{name:'JSHeapUsedSize',value:1024}]}:{};}};
 const i={ctx:{},page:{},status:'playing',cdp,async eval(){return 0;},log(){}};
 assert.ok(await GameInstance.prototype.purgeMemory.call(i,'test'));
 assert(calls.includes('HeapProfiler.collectGarbage'));
 assert(!calls.some(n=>n.startsWith('Memory.')),'live game must not be subjected to simulated OOM/pressure');
 assert.equal(i.lastPurge.mode,'non-destructive-gc');
 console.log('PASS live memory reclamation preserves context: no OOM intervention or simulated pressure');
})().catch(e=>{console.error(e);process.exitCode=1;});
