'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {RecoveryQueue}=require('../src/runtime/recovery-queue'),{RecoveryHistory}=require('../src/runtime/recovery-history'),{decisionGate}=require('../src/runtime/freshness'),{direct}=require('../src/team-director');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-continuity-'));try{
 let now=1000,active=0,maxActive=0;const starts=[],q=new RecoveryQueue({now:()=>now,gapMs:40,wait:async ms=>{now+=ms;}});
 const action=async()=>{active++;maxActive=Math.max(maxActive,active);starts.push(now);await new Promise(r=>setImmediate(r));active--;};
 await Promise.all([q.run(0,action),q.run(1,action),q.run(0,action)]);assert.equal(maxActive,1);assert(starts[1]-starts[0]>=40);await q.run(0,action);await assert.rejects(q.run(0,action),/budget exhausted/);await q.run(2,action);
 assert(!decisionGate({lastSaveAt:now-31000},now).allowed);assert(!decisionGate({lastSaveAt:now+1},now).allowed);assert(decisionGate({lastSaveAt:now,livePos:{at:now}},now).allowed);
 const h=new RecoveryHistory(root,2),row=h.begin('reload','expired session',now);h.finish(row,null,now+100);assert.equal(new RecoveryHistory(root,2).view()[0].reason,'expired session');
 const config=require('../machines/fleet.json'),sources=['windows','tum'].map(machine=>({machine,at:now,members:config.members.filter(m=>m.machine===machine).map(m=>({...m,status:'playing',lastSaveAt:now,livePos:{at:now,room:'tw#1'},vitals:{at:now,hp:1,mp:1},readiness:{at:now,ready:true}}))}));
 assert(direct(config,sources,now).canEnter);sources[0].members[0].vitals.hp=.2;assert(direct(config,sources,now).withdraw);sources[1].at=now-20000;assert(!direct(config,sources,now).canEnter);
 const {tactics}=require('../src/team-readiness'),self={slot:0,lastSaveAt:now,lastSave:{job:'mage'},status:'playing',teamPartyId:1,livePos:{at:now,room:'tw#1',x:0,z:0},vitals:{at:now,hp:.2}},ally={...self,slot:1,lastSave:{job:'knight'},vitals:{at:now,hp:1}};assert.equal(tactics(self,[self],now).action,'hold');assert.equal(tactics(self,[self,ally],now).action,'retreat');assert.equal(tactics(self,[self,{...ally,lastSaveAt:now-40000}],now).action,'hold');
 class ProbeFixture{async screen(){return {inGame:false,loading:false,fps:20,heapMB:50};}async tick(){assert.fail('stale data must not reach strategic tick');}async hardReload(reason){this.reloaded=reason;}async stop(){}snapshot(){return {};}}
 require('../src/runtime/v2-instance').installRuntimeV2(ProbeFixture);
 const probe=new ProbeFixture();Object.assign(probe,{root,slot:9,storageSlot:9,credentials:{username:'probe-fixture'},lastSaveAt:Date.now()-31000,lastSave:{},livePos:{at:Date.now(),room:'town'}});const originalSaveAt=probe.lastSaveAt;
 await probe.tick();assert.match(probe.reloaded,/fresh screen confirms disconnected/);assert.equal(probe.lastSaveAt,originalSaveAt,'recovery detection must not fabricate a fresh save');
 console.log('PASS serialized recovery, spacing, per-slot budget, durable causes, stale/future data, six-member readiness, withdrawal and fresh allied tactics');
}finally{const target=path.resolve(root);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
