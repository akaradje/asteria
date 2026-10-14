'use strict';
const assert=require('assert/strict'),{terminateTree}=require('../src/runtime/process-tree'),{decision}=require('./windows-farm-recovery');
(async()=>{
 const gone=()=>{const e=Error('gone');e.code='ESRCH';throw e;},failed=(_cmd,_args,_opts,done)=>done(Error('child no longer running'));
 assert((await terminateTree(424242,{platform:'win32',exec:failed,kill:gone})).terminated);
 await assert.rejects(terminateTree(424242,{platform:'win32',exec:failed,kill:()=>{}}),/child no longer/);
 await assert.rejects(terminateTree(424242,{platform:'win32',exec:failed,kill:()=>{const e=Error('permission denied');e.code='EPERM';throw e;}}));
 await assert.rejects(terminateTree(424242,{platform:'win32',exec:(_c,_a,_o,done)=>done(null),kill:()=>{}}),/still running/);
 const h={service:'asteria-panel',running:false},s={running:false,error:'process cleanup failed: missing child'};
 assert.equal(decision(h,s),'start');assert.equal(decision(h,s,{processes:[42]}),'existing-farm-process');assert.equal(decision(h,s,{stopMarker:true}),'stop-marker-present');assert.equal(decision(h,{running:false,error:null}),'no-action');assert.equal(decision({...h,running:true},s),'no-action');assert.equal(decision(h,s,{now:10000,attempts:[100,200,300]}),'recovery-limit');
 console.log('PASS missing child/root race tolerated only after root exit, live root/permission errors retained, no duplicate farm, stop intent and restart budget respected');
})().catch(e=>{console.error(e);process.exitCode=1;});
