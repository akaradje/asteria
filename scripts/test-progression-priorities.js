'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),economy=require('../src/economy'),survival=require('../src/runtime/survival'),{GearImpact}=require('../src/gear-impact');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-priorities-')),old=economy.loadWiki;try{
 economy.loadWiki=()=>({maps:{maps:[]}});let retreats=0;const i={lastSaveAt:Date.now(),lastSave:{lv:104,consumables:{'White Potion':20}},catalog:()=>({world:{MAX_LV:120}}),brain:{data:{deaths:{}},blocked:()=>({})},livePos:{room:'c1'},canDo:()=>true,expeditionAuto:async()=>{},returnToTown:async()=>{retreats++;i.livePos.room='town';return {ok:true};}};
 assert((await survival.tick(i,{hp:'30 / 100'})).includes('town confirmed'));assert(i.survivalRecovery);assert((await survival.tick(i,{hp:'60 / 100'})).includes('recovering'));assert.equal(retreats,1);await survival.tick(i,{hp:'85 / 100'});assert.equal(i.survivalRecovery,false);
 i.livePos.room='tw#1';assert.equal(await survival.tick(i,{hp:'20 / 100'}),null);assert.equal(retreats,1);
 const g=new GearImpact(root,0),save={job:'knight',lv:120,exp:0,coins:0,equip:{weapon:'a'},stage:{a:1}},pos={room:'c1',at:1000};g.observe(save,pos,1000,false,'build');g.observe({...save,exp:10},{...pos,at:2000},2000,false,'build');g.observe({...save,stage:{a:2},exp:20},{...pos,at:3000},3000,false,'build');g.observe({...save,stage:{a:2},exp:30},{...pos,at:4000},4000,false,'build');assert.equal(g.data.groups.length,2);assert.equal(g.view().ready,false,'no premature before/after claims');
 console.log('PASS: critical HP retreat, recovery hysteresis, dungeon ownership and stage-specific measured equipment contexts');
 const planner=require('../src/planning/capped-campaign'),campaign=require('../src/runtime/capped-campaign'),originalPlan=planner.plan;let equips=0;
 try{planner.plan=()=>({active:true,phase:'wing',target:'next_wing',ready:false,missing:[],requirements:[]});
 const actor={root,catalog:()=>({build:'fixture',world:{}}),character:{name:'Test'},lastSaveAt:Date.now(),lastSave:{job:'dragonknight',equip:{}},livePos:{room:'town'},canDo:()=>true,planBag:async()=>({equip:[{slot:'wing',id:'aegis_wing'},{slot:'weapon',id:'sword'}]}),equipItems:async(rows)=>{assert.equal(rows.length,1);assert.equal(rows[0].slot,'wing');equips++;return {equipped:1};},queryBosses:async()=>{throw Error('equip should return before unrelated actions');},craftAtExchange:async()=>{throw Error('equip must not craft');}};
 assert.equal(await campaign.tick(actor,{}),'campaign: owned prerequisite wing equipped');assert.equal(equips,1);
 actor.teamControl=true;assert.equal(await campaign.tick(actor,{}),null);assert.equal(equips,1);
 console.log('PASS: owned intermediate wing equipped during campaign, no craft replay and team ownership respected');
 }finally{planner.plan=originalPlan;}
 }finally{economy.loadWiki=old;fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
