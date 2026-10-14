'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),economy=require('../src/economy');
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-dev-progress-'));
 try{
  const real=economy.loadCatalog(process.cwd(),economy.newestBuild(process.cwd())),now=Date.now();
  const cat={...real,equipmentGoal:{...real.equipmentGoal,dynamicProgression:false,nativeMax:false,refine:10},items:{w:{id:'w',name:'W',slot:'weapon',tier:6,rarity:'legendary',stats:{atk:20}},better:{id:'better',name:'Better',slot:'weapon',tier:7,rarity:'legendary',stats:{atk:90}},a:{id:'a',name:'A',slot:'acc',tier:6,rarity:'legendary',stats:{atk:10}},b:{id:'b',name:'B',slot:'acc',tier:6,rarity:'legendary',stats:{atk:8}}},nativeRecipes:[{type:'gear',resultId:'better',result:'Better',reqLv:1,cost:{Copper:1000,Starmetal:2},source:'reviewed_native_client'},{type:'gear',resultId:'a',result:'A',reqLv:1,cost:{Copper:1000,Starmetal:2},source:'reviewed_native_client'}]};
  cat.items.baselineWing={id:'baselineWing',slot:'wing',reqLv:1,stats:{}};
  const petId=real.world.MONSTERS.find(m=>m.kind==='normal').id;
  const save={pets:{[petId]:0},petActive:petId,lv:120,job:'windstrider',equip:{wing:'baselineWing',weapon:'w',acc1:null,acc2:null},coins:100000,materials:{},bag:[],potions:20};
  const profile=require('../src/character-brain').profile(save,cat,null);
  assert.equal(profile.craft.id,'a','an empty slot precedes replacing an existing weapon at equal readiness');assert.equal(profile.craft.ready,false);
  const ceiling=require('../src/planning/equipment-ceiling').assess(save,cat,null);
  assert.equal(ceiling.rows.find(r=>r.slot==='acc1').target.id,'a');assert.equal(ceiling.rows.find(r=>r.slot==='acc2').target.id,'b','second accessory has a distinct conditional target');
  const actor={root,lastSave:save,lastSaveAt:now,catalog:()=>cat,equipmentCeiling:ceiling,endgameCampaign:{phase:'complete'},livePos:{at:now,room:'c1'},vitals:{hp:1,at:now},autoChores:true,canDo:()=>true,goal:{label:'Farm'},developmentLedger:{view:()=>[],blocking:()=>null}};
  const GameInstance=require('../src/instance').GameInstance;const snapActor=Object.assign(Object.create(GameInstance.prototype),actor,{credentials:{charName:'Fixture'},character:{name:'Fixture'},brain:{strategy:()=>null,blocked:()=>({}),data:{}},status:'playing',campaignGoal:{label:'owned campaign',mapId:'c1'},root});const ownedGoal=snapActor.goal;const snapshot=snapActor.snapshot();assert(snapshot.personalBrain.availableFocuses.includes('focus_refine'),'capped campaign actor publishes native strategic actions even without refreshGoal');assert.equal(snapActor.goal,ownedGoal,'observation never retargets current owner');assert.equal(snapshot.personalBrain.craft.id,'a');
  const needs=require('../src/planning/team-workboard').project(actor).needs;assert(needs.some(n=>n.name==='Starmetal'&&n.want===2),'zero stock and unready native craft creates a team demand');
  const objective=require('../src/planning/progression-objective').objective(save,cat,null);assert(objective.nodes.some(n=>n.id==='a'&&n.source==='craft'),'objective retains native recipe evidence');
  let progress=require('../src/planning/development-progress').view(actor,now);assert.equal(progress.stage,'gather');assert(progress.personalBrain.availableFocuses.includes('focus_craft'));assert(progress.personalBrain.availableFocuses.includes('focus_refine'));assert.equal(actor.personalBrain,undefined,'view projection independent of refreshGoal early return');assert.equal(progress.personalBrain.build,cat.build);assert(progress.missing.some(m=>m.name==='Starmetal'&&m.have===0));assert.equal(progress.craftPortfolio.selected.id,progress.target.id,'display and planner use the same current craft milestone');
  const staleView=require('../src/planning/development-progress').view({...actor,lastSaveAt:now-31000},now);assert.equal(staleView.stage,'waiting');assert.deepEqual(staleView.personalBrain.availableFocuses,[]);
  actor.lastSave={...save,materials:{Starmetal:2}};assert.equal(require('../src/planning/development-progress').view(actor,now).stage,'craft');
  actor.v2={reservations:{totals:()=>({Starmetal:2,Copper:1000})}};
  const heldPlan=require('../src/planning/development-progress').view(actor,now);assert.notEqual(heldPlan.stage,'craft');assert.equal(heldPlan.missing.find(m=>m.name==='Starmetal').have,0,'unknown paid holds create a real gather demand');assert.equal(actor.lastSave.materials.Starmetal,2,'planning never rewrites observed inventory');assert.equal(heldPlan.reservedResources.Starmetal,2);
  const heldInvestment=require('../src/investment-plan').choose(actor.lastSave,cat,null,{campaignComplete:true,reserved:{Starmetal:2}});assert.equal(heldInvestment.selected,null,'town investment cannot repeatedly choose ore already reserved');
  actor.v2=null;
  const investment=require('../src/investment-plan').choose({...actor.lastSave,materials:{Starmetal:200,[cat.world.REFINE.ore(6)]:200}},cat,null,{campaignComplete:true});
  assert(investment.candidates.some(c=>c.kind==='refine'),'fixture contains competing cheap refine');
  assert.equal(investment.selected.kind,'craft','ready replacement is not starved by repeated cheaper refinement');assert.equal(investment.selected.id,'a');
  const noBudget=require('../src/investment-plan').choose({...actor.lastSave,coins:0},cat,null,{campaignComplete:true});assert.equal(noBudget.selected,null,'priority never bypasses wallet reserve');
  {
   const oldRefine=economy.refinePlan;let observed;
   try{
    economy.refinePlan=options=>{observed=options;return {steps:[],doable:[]};};
    const funded={...save,materials:{Starmetal:1},coins:100000},goalCat={...cat,equipmentGoal:{enabled:true,rarity:'legendary',refine:10},nativeRecipes:cat.nativeRecipes.map(r=>({...r,verified:true,verifiedBuild:cat.build}))};
    require('../src/investment-plan').choose(funded,goalCat,null,{campaignComplete:true});
    assert.equal(observed.materials.Starmetal,0,'partial stock for missing Legendary cannot be spent on another refinement');
    assert.equal(observed.coins,87000,'Legendary craft budget and supplies are both preserved');
    const runtime=require('../src/runtime/development-progress');
    runtime.refineOpportunity({...actor,catalog:()=>goalCat,lastSave:funded,v2:{sourceCoherence:{matches:true}}});
    assert.equal(observed.materials.Starmetal,0,'runtime refinement applies the same reserve as town investment');
    assert.equal(observed.coins,87000);
   }finally{economy.refinePlan=oldRefine;}
  }
  const campaignActor={...actor,endgameCampaign:{active:true,phase:'wing',target:'wing1',wing:{name:'Main Wing'},missing:[{name:'Tyrant Ember',have:1,want:8}],ready:false}};
  const campaignView=require('../src/planning/development-progress').view(campaignActor,now);assert.equal(campaignView.target.name,'Main Wing');assert.equal(campaignView.missing[0].name,'Tyrant Ember','display follows owning campaign instead of unrelated ready gear');assert.equal(campaignView.craftPortfolio,null,'active campaign keeps ownership over alternative equipment milestones');
  assert.equal(require('../src/planning/development-progress').view({...actor,lastSave:{...save,lv:20},endgameCampaign:{active:false,phase:'wing-training'}},now).stage,'training','known below-level wing gate retains training rather than an equipment campaign');
  assert.equal(require('../src/planning/development-progress').view({...actor,lastSave:{...save,lv:20},endgameCampaign:{active:false}},now).stage,'campaign','missing native wing recipe in this synthetic catalog must remain visible; first wing does not approve an unknown formula');
  let returns=0;actor.expeditionAuto=async()=>{};actor.returnToTown=async()=>{returns++;return {ok:false};};
  const runtime=require('../src/runtime/development-progress');await runtime.tick(actor,{});assert.equal(returns,1,'ready craft returns via native travel');
  {
   const originalSave=actor.lastSave,originalBlocking=actor.developmentLedger.blocking;
   const unknown={kind:'craft',status:'reconciled_craft_unknown',target:{id:'a'},evidence:'native_current_budget_after_closed_craft_session'};
   actor.lastSave={...actor.lastSave,materials:{Starmetal:300,[cat.world.REFINE.ore(6)]:300}};
   actor.developmentLedger.blocking=kind=>kind==='craft'?unknown:null;
   const fenced=require('../src/planning/development-progress').view(actor,now);
   assert.equal(fenced.stage,'craft-blocked');assert.equal(fenced.target.ready,true,'recipe readiness does not imply execution permission');assert.equal(fenced.executionGates.craft.target,'a');
   assert(runtime.refineOpportunity(actor),'fixture has spare, independently payable refinement after preserving the craft bill');
   const alternative=require('../src/investment-plan').choose(actor.lastSave,cat,null,{campaignComplete:true,blockedKinds:{craft:true}});assert.equal(alternative.selected.kind,'refine','town investment selects payable work rather than the fenced ready recipe');
   assert.equal(require('../src/investment-plan').choose(actor.lastSave,cat,null,{campaignComplete:true,blockedKinds:{craft:true,refine:true,enchant:true}}).selected,null,'global pending fences forbid all payments');
   await runtime.tick(actor,{});assert.equal(returns,2,'fenced ready craft cannot starve an independent native refine return');assert.equal(actor.equipmentMaintenanceStatus.kind,'refine');
   assert.equal(actor.lastSave.materials.Starmetal,300,'planning never spends or edits inventory');
   actor.developmentLedger.blocking=()=>({...unknown,kind:'refine'});await runtime.tick(actor,{});assert.equal(returns,2,'a native refinement fence is preserved');
   actor.lastSave=originalSave;actor.developmentLedger.blocking=originalBlocking;
  }
  actor.developmentLedger.view=()=>[{kind:'craft',status:'pending',target:{name:'A'},at:now}];await runtime.tick(actor,{});assert.equal(returns,2,'pending paid result does not return/replay');
  actor.developmentLedger.view=()=>[{kind:'craft',status:'change_observed',target:{name:'A'},finishedAt:now,evidence:'outgoing_client_save'}];progress=require('../src/planning/development-progress').view(actor,now);assert.equal(progress.confirmed.length,0);assert.equal(progress.observed.length,1);
  actor.survivalRecovery=true;await runtime.tick(actor,{});assert.equal(returns,2,'survival retains ownership');
  console.log('PASS empty-slot priority, distinct accessory targets, zero-stock unready native team demand, native graph, fresh/uncertain proof, ready return and survival protection');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
