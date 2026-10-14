'use strict';
const assert=require('node:assert/strict');
const {ControllerRecovery}=require('../src/runtime/controller-recovery');
async function main(){
 let allowed=true,revision=1,healthy=false,starts=0,probes=0,now=100000;const timers=new Map();let seq=0;
 const policy=new ControllerRecovery({allowed:()=>allowed,revision:()=>revision,probe:async()=>{probes++;return healthy;},start:()=>{starts++;return {ok:true};},now:()=>now,schedule:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
 const fire=async()=>{assert.equal(timers.size,1);const [id,t]=timers.entries().next().value;timers.delete(id);now+=t.ms;await t.fn();return t.ms;};
 for(let n=1;n<=20;n++){policy.request('exit');policy.request('duplicate');assert.equal(timers.size,1);assert.equal(await fire(),Math.min(60000,n*5000));}
 assert.equal(starts,20);policy.request('exit');assert.equal(policy.view().state,'cooldown');assert.equal(await fire(),300000);assert.equal(starts,20);assert.equal(probes,1);assert.equal(timers.size,1,'unhealthy server schedules another bounded probe');
 healthy=true;await fire();assert.equal(starts,21);assert.equal(policy.view().confirmed,false,'start request is not game success');
 policy.request('exit');revision++;await fire();assert.equal(starts,21,'manual control revision fences queued restart');
 policy.reset();policy.request('exit');allowed=false;await fire();assert.equal(starts,21,'manual stop respected');
 allowed=true;policy.reset();policy.attempts=20;let finish;policy.probe=()=>new Promise(r=>finish=r);policy.request('exit');const inflight=fire();policy.request('duplicate during health read');assert.equal(timers.size,0);policy.reset();revision++;finish(true);await inflight;assert.equal(starts,21,'late health result cannot override stop/resume epoch');
 policy.start=()=>{throw Error('temporary spawn failure');};policy.request('exit');await fire();assert.equal(timers.size,1,'synchronous spawn failure also recovers');policy.reset();assert.equal(timers.size,0);
 console.log('PASS bounded restart burst, five-minute readiness probes, no permanent abandonment, manual-stop/revision/epoch fences, duplicate suppression and spawn-failure retry');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
