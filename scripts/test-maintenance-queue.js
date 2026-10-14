'use strict';
const assert=require('assert/strict'),{GameInstance}=require('../src/instance');
(async()=>{
 let finish;
 const a=Object.create(GameInstance.prototype),b=Object.create(GameInstance.prototype);
 a.choresPass=()=>new Promise(resolve=>{finish=resolve;});
 b.choresPass=async()=>['second'];
 const first=a.runTownChores();assert.equal(GameInstance.maintenanceOwner,a);
 assert.deepEqual(await b.runTownChores(),[]);assert(!b.choresBusy);
 finish(['first']);assert.deepEqual(await first,['first']);assert.equal(GameInstance.maintenanceOwner,null);
 assert.deepEqual(await b.runTownChores(),['second']);assert.equal(GameInstance.maintenanceOwner,null);
 a.choresPass=async()=>{throw Error('NPC unavailable');};await assert.rejects(a.runTownChores());
 assert.equal(GameInstance.maintenanceOwner,null);assert.equal(a.choresBusy,false);
 console.log('PASS: one maintenance pass at a time, waiting characters remain recyclable, errors release ownership');
})().catch(e=>{console.error(e);process.exitCode=1;});
