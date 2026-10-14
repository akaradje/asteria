'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const gear=require('../src/gear-value'),goal=require('../src/equipment-goal'),economy=require('../src/economy'),owned=require('../src/runtime/owned-gear'),development=require('../src/runtime/development-progress');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-top10-'));
const rule={enabled:true,rarity:'legendary',refine:10,top10Progression:true,bridgeOwned:true};
const item=(id,slot,rarity,stats,tier=2)=>({id,name:id,slot,rarity,stats,tier,reqLv:1});
const cat=goal.configure({build:'fixture',world:{MAX_LV:120,MONSTERS:[{id:'pet',kind:'normal',level:1,element:'ไม่มีธาตุ'}],REFINE:{max:10,chance:[100,100,100,70,60,50,40,30,20,10],cost:()=>100,ore:()=>'Iron Ore',need:()=>1}},items:{hood:item('hood','head','uncommon',{def:5,hp:100}),epic:item('epic','weapon','epic',{atk:100}),gold:item('gold','weapon','legendary',{atk:5}),good:item('good','weapon','legendary',{atk:150}),armor:item('armor','armor','legendary',{def:20,hp:200}),ring:item('ring','acc','rare',{atk:10}),bestRing:item('bestRing','acc','legendary',{atk:30})}},rule);
const save={lv:40,job:'monk',coins:20000,potions:20,bag:['hood','ring'],equip:{weapon:'epic',armor:'armor',acc1:'bestRing'},materials:{'Iron Ore':10},refine:{},stage:{},holes:{},sockets:{},weaponOpts:{}};
cat.items.baselineWing={id:'baselineWing',slot:'wing',reqLv:1,stats:{}};
function actor(){const now=Date.now();return {root,catalog:()=>cat,lastSave:{...structuredClone(save),job:'asura',pets:{pet:0},petActive:'pet',equip:{...save.equip,wing:'baselineWing'}},lastSaveAt:now,livePos:{room:'town',at:now},vitals:{hp:1,at:now},autoChores:true,canDo:()=>true,goal:{kind:'exp'},endgameCampaign:{active:false},planBag:async function(){return economy.planBag({save:this.lastSave,bag:this.lastSave.bag,equip:this.lastSave.equip,job:this.lastSave.job,lv:this.lastSave.lv,world:cat.world,items:cat.items});},expeditionAuto:async()=>{},closeGamePanel:async()=>{}};}
async function main(){
 assert(gear.compare(save,cat,'hood').upgrade,'owned gear fills empty head');
 assert.equal(gear.compare({...save,bag:[]},cat,'hood').upgrade,false,'bridge cannot become a purchased/crafted/farmed low-rarity target');
 assert(gear.compare({...save,bag:[],storage:{gear:[{id:'hood'}]}},cat,'hood').upgrade,'plain owned storage upgrade can be withdrawn');
 assert.equal(gear.compare({...save,bag:[],storage:{gear:[{id:'hood',lk:true}]}},cat,'hood').upgrade,false);
 assert.equal(gear.compare(save,cat,'gold').upgrade,false,'Legendary color must not authorize lower whole-loadout stats');
 assert(gear.compare(save,cat,'good').upgrade);
 assert.equal(gear.compare({...save,equip:{weapon:'good'},bag:['epic']},cat,'epic').upgrade,false,'never downgrade equipped Legendary');
 const c=gear.compare(save,cat,'ring');assert(c.upgrade&&c.slot==='acc2','owned ring fills second slot while preserving Legendary first');
 assert.equal(gear.compare({...save,equip:{acc1:'bestRing',acc2:'good'}},cat,'ring').upgrade,false);
 assert(!goal.assess({...save,equip:{...save.equip,head:'hood',acc2:'ring'}},cat).complete,'bridge gear never receives final goal credit');
 const brain=require('../src/character-brain');assert.equal(brain.prioritize([{kind:'craft',priority:1,score:1},{kind:'exp',priority:9,score:1}],null,{top10Focus:'focus_growth',progression:{capped:false}})[0].kind,'exp','timed unavailable craft must not starve growth');
 let i=actor();assert.equal(development.refineOpportunity(i).to,1,'owned Legendary foundation works before cap');
 assert(development.refineOpportunity(i).early);i.lastSave.refine.armor=3;i.lastSave.refine.bestRing=3;assert.equal(development.refineOpportunity(i),null,'pre-cap queue cannot make risky +4 roll');
 const foundationCat=goal.configure({...cat,items:{...cat.items,epic:{...cat.items.epic,tier:4}}},rule);
 i=actor();i.catalog=()=>foundationCat;i.lastSave.equip={weapon:'epic',wing:'baselineWing'};let next=development.refineOpportunity(i);assert(next?.foundation&&next.to===1&&next.guaranteed,'owned Epic one guaranteed step avoids waiting indefinitely for Legendary');
 assert.equal(economy.refinePlan({equip:i.lastSave.equip,materials:i.lastSave.materials,coins:20000,items:foundationCat.items,world:foundationCat.world}).steps.length,0,'normal strict target still excludes Epic');
 i.lastSave.refine.epic=1;assert.equal(development.refineOpportunity(i),null,'interim foundation stops at +1');i.lastSave.refine.epic=0;i.lastSave.coins=4000;assert.equal(development.refineOpportunity(i),null,'foundation cannot spend upkeep');i.lastSave.coins=20000;
 const dry=await require('../src/instance').GameInstance.prototype.refineEquipped.call(i,{dryRun:true,targetId:'epic',guaranteedOnly:true,foundation:true});assert.equal(dry.doable[0]?.to,1,'actual smith adapter carries foundation into resource rechecks');
 const paid=require('../src/runtime/paid-actions'),opts={targetId:'epic',foundation:true,guaranteedOnly:true};assert.equal(paid.estimate(i,'refineEquipped',[opts]).args[0].foundation,true,'runtime capability/payment estimate admits the same bounded step');
 assert.equal(paid.estimate(i,'refineEquipped',[{...opts,guaranteedOnly:false}]),null,'capability estimate never admits risky interim spending');
 assert.equal(paid.estimate(i,'refineEquipped',[{...opts,reservedMaterials:{'Iron Ore':10}}]),null,'reserved wing ore stays out of both payment layers');assert.equal(paid.estimate(i,'refineEquipped',[{...opts,extraReserveCoins:20000}]),null,'extra wing cash preserved in payment estimate');
 assert.equal(paid.estimate(i,'refineEquipped',[{...opts,reservedMaterials:{'Iron Ore':-1}}]),null,'invalid reserve blocked before scheduling');
 const riskyCat={...foundationCat,world:{...foundationCat.world,REFINE:{...foundationCat.world.REFINE,chance:[90]}}};assert.equal(economy.refinePlan({equip:i.lastSave.equip,foundation:true,materials:i.lastSave.materials,coins:20000,items:riskyCat.items,world:riskyCat.world}).steps.length,0,'unknown or non-guaranteed foundation does not roll');
 assert.equal(goal.assess({...i.lastSave,refine:{epic:1}},foundationCat).refine10Equipped,0,'interim +1 never receives Legendary +10 credit');
 i=actor();i.lastSave.coins=4000;assert.equal(development.refineOpportunity(i),null,'upkeep reserve intact');i=actor();i.endgameCampaign={active:true,phase:'class'};assert.equal(development.refineOpportunity(i),null,'class campaign owns development');
 i=actor();i.lastSave.lv=19;assert.equal(development.refineOpportunity(i),null);i=actor();i.lastSave.materials['Iron Ore']=0;assert.equal(development.refineOpportunity(i),null);
 i=actor();i.livePos.room='w1';i.expeditionAuto=async()=>{throw Error('small early refine must not interrupt field training')};assert.equal(await development.tick(i,{}),null,'early foundation waits for an existing town visit');
 i=actor();let calls=0;i.equipItems=async rows=>{calls++;i.lastSave.equip[rows[0].slot]=rows[0].id;i.lastSaveAt=Date.now()+1;return {equipped:1};};
 await owned.tick(i,{});assert.equal(calls,1);assert.equal(i.equipmentMaintenanceStatus.status,'change_observed');
 for(const change of [a=>a.lastSaveAt-=40000,a=>a.livePos.at-=20000,a=>a.vitals.hp=.7,a=>a.teamControl=true,a=>a.pendingTravel={},a=>a.teamTradeStatus={phase:'UNCERTAIN'},a=>a.v2={sourceCoherence:{matches:false}},a=>a.v2={journal:{pending:()=>true}},a=>a.goal={monsterKind:'boss'},a=>a.survivalRecovery=true,a=>a.dailyTeamPending=true]){
  i=actor();change(i);i.equipItems=async()=>{throw Error('unsafe equip sent')};assert.equal(await owned.tick(i,{}),null);
 }
 i=actor();i.planBag=async()=>{i.lastSaveAt-=40000;return {equip:[{id:'hood',slot:'head',name:'hood'}]};};i.equipItems=async()=>{throw Error('changed evidence equip sent')};assert.equal(await owned.tick(i,{}),null);
 i=actor();i.equipItems=async()=>({equipped:0});await owned.tick(i,{});assert.equal(i.equipmentMaintenanceStatus.status,'not_sent','button attempt is not confirmed equipment');
 console.log('PASS Top10 owned-only bridge, no Legendary downgrade/stat-loss swap, strict final goal, growth priority, guaranteed under-cap foundation and fresh/owner/outcome guards');
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1});
