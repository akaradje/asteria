'use strict';
const assert=require('node:assert/strict'),{Supervisor}=require('../src/supervisor');
(async()=>{
 let spawned=0;
 const farm=Object.assign(Object.create(Supervisor.prototype),{serialBoot:true,deferred:[2],instances:[{status:'playing'},{status:'booting'}],stopping:false,freeMb:()=>8000,windowCostMb:900,minFreeMb:600,log(){},spawn:async()=>{spawned++;}});
 await farm.launchDeferred();assert.equal(spawned,0);assert.deepEqual(farm.deferred,[2]);
 farm.instances[1].status='playing';farm.instances[1].recycling=true;await farm.launchDeferred();assert.equal(spawned,0);
 farm.instances[1].recycling=false;farm.freeMb=()=>1000;await farm.launchDeferred();assert.equal(spawned,0);
 farm.freeMb=()=>2000;await farm.launchDeferred();assert.equal(spawned,1);assert.deepEqual(farm.deferred,[]);
 console.log('PASS serial startup blocks overlapping boot/recovery and retains memory admission checks');
})().catch(e=>{console.error(e);process.exitCode=1});
