'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{Federation}=require('../src/federation');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-party-test-'));try{
 fs.mkdirSync(path.join(root,'machines'));fs.copyFileSync(path.join(__dirname,'../machines/fleet.json'),path.join(root,'machines/fleet.json'));
 let now=Date.now(),leaves=0;const f=new Federation(root,'windows',{now:()=>now}),name=f.config.members.find(m=>m.machine==='windows').charName;
 const member={credentials:{charName:name},status:'playing',livePos:{room:'e2'},partyState:async()=>null,socialFrames:async()=>[],partyLeave:async()=>{leaves++;}};
 const farm={instances:[member]};const fresh=()=>f.save(path.join(f.dir,'tum.json'),{machine:'tum',at:now,party:{leader:f.config.leader,checkedAt:now-40000,members:[name]}});
 fresh();await f.partyRound(farm);assert.equal(leaves,0);now+=61000;fresh();await f.partyRound(farm);assert.equal(leaves,1);
 now+=60000;fresh();await f.partyRound(farm);assert.equal(leaves,1,'cooldown');member.livePos.room='dx1';now+=200000;fresh();await f.partyRound(farm);assert.equal(leaves,1,'protected room');
 member.livePos.room='e2';for(let n=0;n<3;n++){now+=181000;fresh();await f.partyRound(farm);}assert.equal(leaves,3,'bounded retries within fifteen minutes');
 now+=16000;await f.partyRound(farm);assert.equal(leaves,3,'stale telemetry cannot trigger recovery');
 console.log('PASS delayed individual party resync, fresh leader evidence, protected rooms and retry budget');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
