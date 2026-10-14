'use strict';
const assert=require('assert/strict'),{tick}=require('../src/runtime/first-class');
async function main(){let now=Date.now(),picks=0,closed=0,available=['mage'],opened=0;const i={lastSave:{job:'novice',jobLv:10},lastSaveAt:now,livePos:{room:'town',at:now},credentials:{job:'mage'},catalog:()=>({jobs:{mage:{}}}),canDo:()=>true,expeditionAuto:async()=>{},openTownService:async()=>{opened++;return {ok:true};},eval:async()=>available,chooseJob:async prefs=>{assert.deepEqual(prefs,['mage']);picks++;i.lastSave.job='mage';i.lastSaveAt=++now;},closeGamePanel:async()=>{closed++;},v2:{sourceCoherence:{matches:true}},refreshGoal:()=>{},lastScreenAt:now};
 const opts={now:()=>now,sleep:async()=>{now+=400;}};
 assert.equal(await tick(i,{death:true},opts),null);assert.equal(picks,0);i.teamControl=true;assert.equal(await tick(i,{},opts),null);i.teamControl=false;i.lastSaveAt=now-31000;assert.equal(await tick(i,{},opts),null);i.lastSaveAt=now;
 available=['knight'];assert((await tick(i,{},opts)).includes('not offered'));assert.equal(picks,0,'never falls back to another class');assert.equal(closed,1);available=['mage'];assert.equal(await tick(i,{},opts),'first class confirmed: mage');assert.equal(i.firstClassStatus.status,'confirmed');assert.equal(picks,1);assert.equal(closed,2);assert.equal(await tick(i,{},opts),null,'confirmed class is not picked again');
 console.log('PASS novice Job10 priority, fresh/ownership/death guards, exact target only, native save confirmation and panel cleanup');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
