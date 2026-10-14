'use strict';
const assert=require('node:assert/strict'),{BuildLabState,entryPlan}=require('../src/observability/build-lab-state'),{roomPolicy}=require('../src/runtime/room-policy'),{poll}=require('../src/runtime/research-poll');
(async()=>{
 const l=new BuildLabState();l.reset(1);l.receive({t:'bt',fee:50,copper:100000,min:30,vip:true,vipLeft:1,vipFree:2},1000);assert(l.view(1000).fresh);assert(!l.view(31001).fresh);
 const inputs={status:l.status,now:1000,wallet:200000,reserve:150000,held:0,maxCopper:100000,ownerFree:true,saveClean:true,sourceAligned:true};assert.equal(entryPlan(inputs).pay,'vip');assert.equal(entryPlan({...inputs,status:{...l.status,vip:false}}).action,'defer');assert.equal(entryPlan({...inputs,saveClean:false}).action,'observe');
 assert(!l.receive({t:'btenter',ok:true,room:'town',now:1,until:2},1001));assert(!l.session);
 l.receive({t:'btenter',ok:true,room:'bt#1',now:1000,until:2000,free:true,token:'secret'},1001);assert(l.session.active);assert(!JSON.stringify(l).includes('secret'));l.receive({t:'btend',why:'time'},2000);assert(!l.session.active);l.reset(2);assert(!l.status&&!l.session);
 assert.equal(roomPolicy('bt#123').allowInvestment,false);assert.equal(roomPolicy('bt').kind,'build_lab');assert.equal(roomPolicy('bthorn').kind,'field');
 let hits=0;const combat=new(require('../src/runtime/combat-observer').CombatObserver)({startCombat(){},damage(){hits++;},clientHit(){hits++;}},0,()=> 'a',{lab:()=>true});combat.message({t:'welcome',id:1},0);combat.message({t:'dmgs',l:[[1,9999,1]]},0);combat.sent(JSON.stringify({t:'hit',l:[[1,9999]]}));assert.equal(hits,0,'lab damage never counted as field gain');
 const sent=[],i={slot:0,status:'playing',lastSaveAt:1000,lastSave:{job:'final'},v2:{sourceCoherence:{matches:true}},catalog:()=>({world:{}}),socialInbox:{generation:1,market:{board:null},buildLab:l},socialSend:async(t)=>{sent.push(t);return {ok:true};}};
 await poll(i,1000);assert.deepEqual(sent,['mq','btq']);await poll(i,2000);assert.equal(sent.length,2);i.researchPollAt=0;i.slot=1;await poll(i,2000);assert.equal(sent.length,2);i.slot=0;i.resourceHealth={mode:'reduced'};await poll(i,2000);assert.equal(sent.length,2);
 console.log('PASS native lab scope/cost/quota/secret exclusion, no premium fallback, host-coalesced read queries and load shedding');
})().catch(e=>{console.error(e);process.exitCode=1;});
