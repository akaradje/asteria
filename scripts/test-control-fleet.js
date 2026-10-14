'use strict';
const assert=require('assert/strict'),{control}=require('./control-fleet');
(async()=>{const calls=[],send=async(a,m)=>{calls.push([a,m]);return {ok:true};};
 await control('restart','both',{send});assert.deepEqual(calls,[['stop','windows'],['start','windows'],['stop','tum'],['start','tum']]);
 calls.length=0;await control('start','tum',{send});assert.deepEqual(calls,[['start','tum']]);
 calls.length=0;await assert.rejects(control('restart','windows',{send:async(a,m)=>{calls.push([a,m]);throw Error('stop failed');}}),/stop failed/);assert.deepEqual(calls,[['stop','windows']]);
 await assert.rejects(control('restart','other',{send}),/Use/);console.log('PASS ordered restart, machine scope, failed-stop refuses start, invalid scope refusal');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
