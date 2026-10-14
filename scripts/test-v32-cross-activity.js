'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-v32-activity-'));
try{
 fs.mkdirSync(path.join(root,'logs/fleet'),{recursive:true});
 const feed={at:Date.now(),build:'current',workflow:{id:'workflow-one',at:Date.now(),build:'current',participants:[{machine:'vps',slot:0,actorId:'actor-one'}],phase:'GATHERING',deadline:Date.now()+30000}};
 fs.writeFileSync(path.join(root,'logs/fleet/primary.json'),JSON.stringify(feed));
 const cross=require('../src/planning/cross-party');assert.equal(cross.primary(root),null);assert.equal(cross.receivedPrimary(root).workflow.phase,'GATHERING');
 assert.equal(cross.receivedPrimary(root,feed.at+15001),null);
 const i={slot:0,status:'playing',actorIdentity:{actorId:'actor-one'},queryDailyQuotas:async()=>[{ok:true},{ok:true}]};
 let acted=0;const farm={machine:'vps',root,cache:{dir:'current'},instances:[i],crossPartyActivity:{act:async()=>{acted++;}}};
 // Adapter proof is a separate gate; the protocol still reads real quotas.
 require('../src/runtime/cross-party-activities').pulse(farm);
 assert.equal(i.dailyQuotaQueryBusy,true);assert.equal(i.dailyTeamPending,true);
 assert.equal(acted,0,'missing loaded adapter proof cannot dispatch');
 feed.build='other';fs.writeFileSync(path.join(root,'logs/fleet/primary.json'),JSON.stringify(feed));require('../src/runtime/cross-party-activities').pulse(farm);
 assert.equal(i.dailyTeamPending,false,'different build cannot reserve actor');
 console.log('PASS VPS received-feed path, quota refresh, stale/build fencing and adapter gate');
}finally{fs.rmSync(root,{recursive:true,force:true});}
