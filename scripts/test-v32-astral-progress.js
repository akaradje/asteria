'use strict';
const assert=require('node:assert/strict'),{AstralState}=require('../src/observability/astral-state'),{changes}=require('../src/runtime/progression-controller');
const as=new AstralState();as.reset(1);as.receive({t:'as',s:1,exp:10,need:100,p:{}},1000);
as.receive({t:'as',lite:true,s:1,exp:30,need:100},31000);as.receive({t:'as',lite:true,s:1,exp:40},61000);
assert.equal(as.view(61000).progress.netExpPerHour,1800);
as.receive({t:'as',lite:true,s:1,exp:20,died:20},91000);assert(as.view(91000).progress.netExpPerHour<1800,'death loss reduces measured net yield');
assert.deepEqual(changes({saveAt:1,astral:{at:1,generation:1,star:1,exp:10}},{saveAt:1,astral:{at:2,generation:1,star:1,exp:20}}),['Astral-EXP']);
as.receive({t:'as',lite:true,gate:true},92000);assert.equal(as.view(92000).progress.nextStarEtaMs,null);
as.reset(2);as.receive({t:'as',s:0,exp:0,need:100,p:{}},93000);assert.equal(as.view(93000).progress.netExpPerHour,null);
const rules={max:200,minMonLv:110,nodes:[{id:'heal',max:1000}],gateEvery:10},cat={build:'fixture',world:{MAX_LV:120,HIGH_CLASSES:{inquisitor:{}},ASTRAL:rules,astralPts:a=>a.p}},actor={lastSave:{job:'inquisitor',lv:120},catalog:()=>cat,socialInbox:{astral:{view:()=>({fresh:true,completeness:'full',state:{s:200,p:{heal:199},exp:0,need:100,gate:true}})}}};
assert.equal(require('../src/planning/astral-objective').plan(actor).action,'aspt','unspent points must not stall at a capped gate');
async function pollingDuringTeamOwner(){
 const {poll}=require('../src/runtime/astral');let sends=0,release;
 const i={actorIdentity:{actorId:'actor-test'},status:'playing',socialInbox:{generation:1},v2:{sourceCoherence:{matches:true}},teamControl:{kind:'guild'},socialSend:async(kind,payload)=>{assert.equal(kind,'asq');assert.deepEqual(payload,{});sends++;await new Promise(r=>release=r);return {ok:true};}};
 const first=poll(i,100000);assert.equal(await poll(i,100001),false,'one flight only');assert.equal(sends,1);release();assert.equal(await first,true,'team owner permits observer reads only');
 assert.equal(await poll(i,120000),false,'query budget bounded');assert.equal(i.astralQueryStatus.reason,'native_read_requested');
 for(const changed of [{status:'stopped'},{recycling:true},{v2:{sourceCoherence:{matches:false}}},{actorIdentity:null}])assert.equal(await poll({...i,...changed},200000),false);
 i.socialSend=async()=>{throw Error('do not publish secret native error');};assert.equal(await poll(i,200000),false);assert.equal(i.astralQueryFlight,false);assert.equal(i.astralQueryStatus.reason,'native_read_unavailable');
 assert(!i.socialInbox.astral,'a query cannot fabricate a fresh native state');
 console.log('PASS bounded one-flight native Astral reads during team ownership without a point mutation or fabricated freshness');
}
pollingDuringTeamOwner().catch(e=>{console.error(e);process.exitCode=1;});
const held=require('../src/runtime/paid-actions').heldResources({catalog:()=>({build:'b'}),actorIdentity:{actorId:'a'},registryV32:{store:{held:id=>{assert.equal(id,'a');return {Copper:70,Ore:2};}}},v2:{reservations:{totals:()=>({Copper:30})}}});assert.deepEqual(held,{Copper:100,Ore:2},'equipment sees durable Astral currency claims');
console.log('PASS T44–T46: star progress, net death loss, honest ETA/gate/session reset, capped point priority and cross-domain budget holds');
const {journalBlocks}=require('../src/runtime/astral'),row={kind:'refine',status:'OBSERVED',at:10},old={bagSessionStartedAt:20,v2:{journal:{pending:()=>row,rows:[row]}}};assert(!journalBlocks(old,'aspt'),'zero-cost points do not replay/change an old item transaction');assert(journalBlocks(old,'asbt'),'paid breakthrough retains quarantine');assert(journalBlocks({...old,bagSessionStartedAt:10},'aspt'),'current operation blocks');assert(journalBlocks({...old,v2:{journal:{pending:()=>row,rows:[{...row,kind:'unknown'}]}}},'aspt'),'unknown effects remain blocked');assert.equal(row.status,'OBSERVED','old evidence is not cleared');

const oldCraftPoint={...old,v2:{journal:{pending:()=>row,rows:[{kind:'craft',at:10,status:'OBSERVED'}]}}};assert(!journalBlocks(oldCraftPoint,'aspt'));assert(journalBlocks(oldCraftPoint,'asbt'));assert(journalBlocks({...oldCraftPoint,bagSessionStartedAt:5},'aspt'));assert.equal(oldCraftPoint.v2.journal.rows[0].status,'OBSERVED');
