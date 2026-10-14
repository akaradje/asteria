'use strict';
const assert=require('assert/strict');
const {townServiceBudget}=require('../src/runtime/town-service-budget');
const {ActionScheduler}=require('../src/runtime/action-scheduler');
const {GameInstance}=require('../src/instance');
async function main(){
 const townMap=require('../src/runtime/town-map-walk'),source=require('fs').readFileSync('cache/'+require('../machines/fleet-client-release.json').build+'/asteria-online.io/asteria-online-visual-polish.html','utf8'),g=townMap.parse(source);
 assert(g,'current native town-map input geometry reviewed');const p=townMap.point(g,138,-2.6);assert(p);assert(Math.abs(g.cx+(p.u-.5)*g.span-138)<1e-8);assert(Math.abs(g.cz+(p.v-.5)*g.span+2.6)<1e-8);
 assert.equal(townMap.point(g,g.x1+1,0),null);assert.equal(townMap.point(g,NaN,0),null);assert.equal(townMap.parse(source.replace("$('townMapCanvas').addEventListener('pointerdown'","unknown handler")),null,'changed native map handler cannot authorize navigation');
 assert.equal(await townMap.walk({livePos:{room:'d1',at:Date.now()}},138,-2.6),null,'unsupported room/source keeps ordinary fallback; never fabricates arrival');
 let now=1000000;const svc={x:138,z:-5.2},i={livePos:{...svc,room:'town',at:now}};
 const budget=townServiceBudget(i,'potionShop',svc,{now:()=>now,maxClicks:2});
 assert(budget.check({click:true}).ok);assert(budget.check({click:true}).ok);assert.equal(budget.check({click:true}).ok,false);assert.equal(i.townServiceStatus.clicks,2);
 const cooling=townServiceBudget(i,'potionShop',svc,{now:()=>now});assert.equal(cooling.check({position:false}).reason,'NPC acquisition cooldown');
 now+=60001;i.livePos.at=now;const fresh=townServiceBudget(i,'potionShop',svc,{now:()=>now});assert(fresh.check().ok);i.livePos.room='n1';assert.equal(fresh.check({click:true}).ok,false);i.livePos.room='town';i.livePos.at=now-10001;assert.equal(fresh.check().ok,false);i.livePos.at=now;now+=60000;assert.match(fresh.check({position:false}).reason,/time budget/);
 let evaluations=0,vertical=[];const actor=()=>({livePos:{...svc,room:'town',at:Date.now()},panelName:async()=>null,walkTo:async()=>{},log:()=>{},closePanel:async()=>{},eval:async code=>{evaluations++;const y=code.match(/H \* ([0-9.]+)/);if(y)vertical.push(Number(y[1]));return {open:false};}});
 const scan=actor();const exhausted=await GameInstance.prototype.openTownService.call(scan,'potionShop');assert.match(exhausted.reason,/click budget/);assert.equal(evaluations,9,'one projection plus at most eight fallback attempts');
 assert.equal(new Set(vertical).size,6,'same eight attempts actually cover all six vertical bands');
 await GameInstance.prototype.openTownService.call(scan,'potionShop');assert.equal(evaluations,9,'cooldown sends no new UI work');
 evaluations=0;const moved=actor();moved.eval=async()=>{evaluations++;moved.livePos.room='n1';return {open:false};};assert.equal((await GameInstance.prototype.openTownService.call(moved,'potionShop')).ok,false);assert.equal(evaluations,1,'stop immediately when a click exits town');
 evaluations=0;const exact=actor();exact.eval=async()=>{evaluations++;return {open:true,panel:'potionShop'};};assert.equal((await GameInstance.prototype.openTownService.call(exact,'potionShop')).projection,true);assert.equal(evaluations,1);assert.equal(exact.townServiceStatus.state,'opened');
 let dispatched=0,clock=1000;const scheduler=new ActionScheduler({now:()=>clock}),page={evaluate:async()=>{dispatched++;return 42;}},client={page,evalTimeoutMs:100,v2:{scheduler}};
 await assert.rejects(scheduler.run('purchase',async()=>{clock+=2;return GameInstance.prototype.eval.call(client,'mutation');},{maxDurationMs:1}),/duration exceeded/);assert.equal(dispatched,0,'expired owner cannot send even its first UI mutation');
 assert.equal(await GameInstance.prototype.eval.call(client,'health read'),42,'unowned observations remain available');
 await assert.rejects(scheduler.run('purchase',()=>{scheduler.cancel();return GameInstance.prototype.eval.call(client,'mutation');}),/cancelled/);assert.equal(dispatched,1,'cancelled action cannot dispatch');
 console.log('PASS bounded NPC acquisition, no work during cooldown, stop after leaving town/stale position, exact projection success and no dispatch after scheduler cancellation/deadline');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
