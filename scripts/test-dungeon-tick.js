'use strict';
const assert=require('node:assert/strict');
const {GameInstance}=require('../src/instance');
(async()=>{
 for(const room of ['tw#123','dx#4']){
  let fight=null;
  const i=Object.create(GameInstance.prototype);
  i.runtimeV2=true;i.lastAction={};i.teamDungeonTick=async()=>{};
  Object.assign(i,{livePos:{room,at:Date.now()},lastSave:{mapId:'w1'},screen:async()=>({inGame:true,death:false,questOn:'true',autoOn:'false'}),expeditionAuto:async value=>{fight=value;},aiPending:{action:'recover'},eval:async()=>{throw Error('must not issue town respawn or ordinary travel');}});
  assert.equal(await i.tick(),'team dungeon combat');assert.equal(fight,true);assert(i.aiPending);i.aiPending={id:'expired-dungeon-plan',action:'focus_craft',expiresAt:Date.now()-1};assert.equal(await i.tick(),'team dungeon combat');assert.equal(i.aiPending,null,'expired waiting plan cannot block future planning during dungeon');assert.equal(i.aiControl.evidence,'expired_intent_not_executed');
  i.screen=async()=>({inGame:true,death:true,questOn:'false',autoOn:'false'});
  assert.equal(await i.tick(),'waiting for dungeon revive');
 }
 console.log('PASS: tower/Rift combat keeps quests and AI retargeting out; death waits for game revive');
})().catch(e=>{console.error(e);process.exitCode=1;});
