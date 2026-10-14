'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {installRuntimeV2}=require('../src/runtime/v2-instance'),{Learning}=require('../src/director');
const trade=require('../src/runtime/team-trade'),pvp=require('../src/runtime/pvp-mission');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-learning-runtime-'));
const realNow=Date.now,realTradeTick=trade.tick,realPvPTick=pvp.tick;let now=1000000;
class Actor{
 async gotoAndBoot(){}
 async screen(){return {inGame:true};}
 async tick(){return 'farm';}
 async planBag(){return {equip:[],sell:[]};}
 async stop(){}
 snapshot(){return {};}
 catalog(){return {build:'b1',items:{},world:{}};}
 async runTownChores(){this.choresBusy=true;try{this.lastSave.coins+=1000;this.learning.observe({...this.lastSave,mapId:'w1'},now);}finally{this.choresBusy=false;}return 'chores';}
}
async function run(){
 const cache=path.join(root,'cache/b1/asteria-online.io');fs.mkdirSync(cache,{recursive:true});for(const name of ['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js'])fs.writeFileSync(path.join(cache,name),'explicit source fixture '+name);
 Date.now=()=>now;installRuntimeV2(Actor);
 trade.tick=async()=> 'trade handled';pvp.tick=async i=>i.pvpMission?'pvp handled':null;
 let slot=0;
 for(const mode of ['trade','trade-cleanup','pvp','stale-save','stale-position','maintenance']){
  const i=new Actor();Object.assign(i,{root,slot:slot++,credentials:{username:mode,charName:'Actor'},character:{name:'Actor'},status:'playing',buildHash:'b1',lastSave:{job:'asura',lv:120,exp:0,coins:1000,equip:{},bestiary:{prey:0}},lastSaveAt:now,livePos:{room:'w1',at:now},campaignGoal:{kind:'pet-unlock',monsterId:'prey',mapId:'w1',score:100}});
  i.learning=new Learning(root,i.slot,null);i.observeAdvanced=()=>{};
  await i.screen();await i.gotoAndBoot();i.v2.objectiveAt=now;i.v2.gearCheckAt=now;
  await i.tick(); // Synchronize the build-scoped legacy store before baseline saves.
  const sample=async()=>{i.lastSaveAt=now;i.livePos.at=now;i.v2.objectiveAt=now;i.v2.gearCheckAt=now;i.learning.observe({...i.lastSave,mapId:'w1'},now);return i.tick();};
  await sample();now+=30000;i.lastSave.exp=10;i.lastSave.coins+=10;i.lastSave.bestiary.prey=1;await sample();
  const row=Object.values(i.v2.learning.data.contexts)[0],feedback=Object.values(i.v2.goalFeedback.rows)[0];assert.equal(row.netCoins,10);assert.equal(feedback.kills,1);
  now+=15000;i.lastSaveAt=now;i.livePos.at=now;
  if(mode==='trade'||mode==='trade-cleanup'){
   i.teamTradeIntent={id:'owned',phase:mode==='trade'?'SESSION':'UNCERTAIN',build:'b1',offer:{donor:'Actor',receiver:'Other'}};
   if(mode==='trade-cleanup')i.tradeJournal={id:'owned',phase:'UNCERTAIN',sessionId:1,sent:{}};
  }
  if(mode==='pvp')i.pvpMission={id:'owned'};
  if(mode==='stale-save'){i.lastSaveAt=now-30001;i.v2.probeAt=now;}
  if(mode==='stale-position'){i.livePos.at=now-10001;i.v2.probeAt=now;}
  if(mode==='maintenance')assert.equal(await i.runTownChores(),'chores');
  else{ i.lastSave.coins+=1000;i.learning.observe({...i.lastSave,mapId:'w1'},now);assert.notEqual(await i.tick(),'farm',mode+' must run real early-return path'); }
  assert.equal(i.v2.learning.previous,null,mode+' resets context baseline');assert.equal(i.v2.goalFeedback.previous,null,mode+' resets goal baseline');assert.equal(feedback.quietMs,0,mode+' breaks continuous quiet interval');assert.equal(i.learning.prev,null,mode+' resets socket-driven legacy baseline');assert.equal(i.learning.prevAt,0);
  delete i.teamTradeIntent;delete i.tradeJournal;delete i.pvpMission;
  now+=15000;i.lastSave.bestiary.prey+=100;i.lastSave.exp+=1000;await sample();
  assert.equal(row.netCoins,10,mode+' cannot bridge coins through interruption');assert.equal(row.exp,10,mode+' cannot bridge EXP through interruption');assert.equal(feedback.kills,1,mode+' cannot bridge kills through interruption');assert.equal(i.learning.data.maps.w1.coins,10,mode+' socket learning excludes owned-action gains');
  now+=30000;i.lastSave.exp+=5;i.lastSave.coins+=5;i.lastSave.bestiary.prey+=1;await sample();
  assert.equal(row.exp,15,mode+' resumes subsequent real farming window');assert.equal(feedback.kills,2);assert.equal(i.learning.data.maps.w1.coins,15);
 }
 console.log('PASS actual v2 trade/cleanup/PvP/freshness early returns and maintenance boundaries reset both learning baselines; socket legacy observations reject nonfarm gains; farm windows resume without bridging');
}
run().finally(()=>{Date.now=realNow;trade.tick=realTradeTick;pvp.tick=realPvPTick;assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}).catch(error=>{console.error(error);process.exitCode=1;});
