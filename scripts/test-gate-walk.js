'use strict';
const assert=require('assert'),fs=require('fs'),{cross,retreat}=require('../src/runtime/gate-walk');
function actor(room,x,z){return {livePos:{room,x,z,at:Date.now()},calls:[],async expeditionAuto(v){this.calls.push(['auto',v]);},async walkTo(x,z,o){this.calls.push(['walk',x,z,o.tolerance]);this.livePos={room:this.livePos.room,x,z,at:Date.now()};return {ok:true};}};}
(async()=>{
 const native=fs.readFileSync('cache/5391707/asteria-online.io/asteria-online-visual-polish.html','utf8');assert(native.includes('if(nd>2.8)gateGuard=false'));assert(native.includes('near&&nd<1.6'));
 const gate={x:115.5,z:0},a=actor('town',115.8,.5);await cross(a,gate,{from:'town',to:'w1'});assert.deepEqual(a.calls.map(x=>x[0]),['auto','walk','walk']);assert.strictEqual(a.calls[0][1],false);assert(Math.hypot(a.calls[1][1]-gate.x,a.calls[1][2]-gate.z)>2.8);assert.strictEqual(a.calls[2][3],1.5);
 const b=actor('town',160,0);await cross(b,gate,{from:'town',to:'w1'});assert.strictEqual(b.calls.filter(x=>x[0]==='walk').length,1);
 const mapWalk=require('../src/runtime/town-map-walk'),original=mapWalk.walk;
 try{
  const mapped=actor('town',202,46);mapWalk.walk=async(a,x,z,o)=>{assert(o.timeoutMs<=60000);a.livePos={room:'w1',x:0,z:0,at:Date.now()};return {ok:false,reason:'left-town'};};
  assert.equal((await cross(mapped,gate,{from:'town',to:'w1'})).reason,'native-town-gate-confirmed');assert.equal(mapped.calls.filter(c=>c[0]==='walk').length,0);
  mapWalk.walk=async()=>({ok:true,reason:'native-town-map-arrived'});const notWarped=actor('town',202,46);
  assert.equal((await cross(notWarped,gate,{from:'town',to:'w1'})).ok,false);assert.equal(notWarped.calls.filter(c=>c[0]==='walk').length,0,'no second walker after dispatched native path');
  mapWalk.walk=async(a)=>{a.livePos={room:'d1',at:Date.now()};return {ok:false,reason:'left-town'};};
  assert.equal((await cross(actor('town',202,46),gate,{from:'town',to:'w1'})).ok,false,'wrong destination never confirms');
  mapWalk.walk=async(a)=>{a.livePos={room:'w1',at:Date.now()-9000};return {ok:false,reason:'left-town'};};
  assert.equal((await cross(actor('town',202,46),gate,{from:'town',to:'w1'})).ok,false,'stale destination never confirms');
 }finally{mapWalk.walk=original;}
 const stuck=actor('town',115.5,0);stuck.walkTo=async()=>({ok:true});assert.strictEqual((await cross(stuck,gate,{from:'town',to:'w1'})).reason,'gate-rearm-not-confirmed');
 const dead=actor('town',115.5,0);dead.walkTo=async()=>({ok:false,reason:'dead'});assert.strictEqual((await cross(dead,gate,{from:'town',to:'w1'})).ok,false);
 const arrived=actor('w1',0,0);assert.strictEqual((await cross(arrived,gate,{from:'town',to:'w1'})).reason,'already-arrived');assert.strictEqual(arrived.calls.length,0);
 const field=retreat({x:0,z:40},'w1');assert.strictEqual(field.z,35);assert.strictEqual(retreat({x:0,z:0},'w1'),null);
 const home=actor('s2',0,40);home.log=()=>{};let screens=0;home.screen=async()=>{screens++;return {loc:home.livePos.room};};
 home.walkTo=async(x,z,o)=>{home.calls.push(['walk',x,z,o.tolerance]);if(o.abort){const count=screens;assert.equal(await o.abort(),false);assert.equal(screens,count,'gate polling must not dispatch a full DOM screen');}home.livePos={room:z===40?'town':'s2',x,z,at:Date.now()};return {ok:true};};
 const result=await require('../src/instance').GameInstance.prototype.returnToTown.call(home,{timeoutMs:1000});
 assert.strictEqual(result.ok,true);assert.deepEqual(home.calls.map(x=>x[0]),['auto','walk','walk']);
 assert.strictEqual(home.calls[1][2],35);assert.strictEqual(home.calls[2][3],1.5);
 assert.equal(screens,2,'initial/final DOM screen evidence retained');
 const freshRoom=require('../src/runtime/gate-walk').freshRoom;
 assert(freshRoom(home,'town'));assert(!freshRoom(home,'s2'));assert(!freshRoom({...home,livePos:{room:'town',at:Date.now()-9000}},'town'));assert(!freshRoom({...home,livePos:{room:'town',at:Date.now()+1000}},'town'));
 const blockedHome=actor('s2',0,40);blockedHome.log=()=>{};blockedHome.screen=async()=>({loc:'s2'});blockedHome.walkTo=async()=>({ok:false,reason:'dead'});
 assert.strictEqual((await require('../src/instance').GameInstance.prototype.returnToTown.call(blockedHome,{timeoutMs:1000})).ok,false);
 console.log('gate-walk PASS: native guard/radius, AUTO-off, fresh bounded rearm, blocked/dead/no replay');
})().catch(e=>{console.error(e.message);process.exitCode=1});
