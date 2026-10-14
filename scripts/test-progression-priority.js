'use strict';
const assert=require('assert/strict'),economy=require('../src/economy'),priority=require('../src/planning/progression-priority'),brain=require('../src/character-brain'),campaign=require('../src/planning/capped-campaign');
const root=process.cwd(),cat=economy.loadCatalog(root,economy.newestBuild(root)),wiki=economy.loadWiki(root),pet=cat.world.MONSTERS.find(m=>m.kind==='normal').id;
const [high,def]=Object.entries(cat.world.HIGH_CLASSES)[0];
const s={lv:99,job:def.from,jobLv:50,coins:1000000,pets:{},equip:{},bag:[],materials:{...cat.world.ASCEND.items},bestiary:{}};
assert.equal(priority.assess(s,cat).stage,'pet');
assert.equal(priority.assess({...s,pets:{[pet]:0}},cat).stage,'pet','owned but inactive is not completion');
assert.equal(priority.assess({...s,pets:{unknown:1000},petActive:'unknown'},cat).stage,'pet','unknown pet cannot be credited');
s.pets[pet]=0;s.petActive=pet;assert.equal(priority.assess(s,cat).stage,'class');
let plan=campaign.plan({root,catalog:()=>cat,lastSave:s});assert.equal(plan.phase,'class');assert(plan.ready,'ready promotion must not wait for level120');
let low={...s,lv:98};plan=campaign.plan({root,catalog:()=>cat,lastSave:low});assert.equal(plan.phase,'class-training');assert.equal(plan.active,false,'level training must retain safe farming rather than town wait');
for(const focus of ['focus_gear','focus_refine','focus_craft']){
 const p=brain.profile(s,cat,wiki);assert(!p.availableFocuses.includes('focus_gear'));assert(!p.availableFocuses.includes('focus_refine'));
 const choices=brain.prioritize([{kind:'gear',priority:0,score:9999},{kind:'refine',priority:0,score:9999},{kind:'wing',priority:0,score:9999},{kind:'promotion',priority:10,score:1},{kind:'exp',priority:11,score:1}],focus,p);
 assert.equal(choices[0].kind,'promotion');assert(!choices.some(c=>['gear','refine','wing'].includes(c.kind)),'explicit AI focus cannot bypass class');
}
const classWaiting=brain.profile(s,cat,wiki);assert.equal(classWaiting.craft,null,'preparing wing materials during class wait never creates a wing bill');assert.equal(classWaiting.milestones.equipmentAllowed,false,'side collection never opens paid gear before class/wing milestones');
 const now=Date.now(),coreWiki={monsters:{monsters:[{id:'boss',kind:'boss',name:'Boss',level:80,dropTable:[{item:'Core',ratePct:100}]}]},maps:{maps:[{id:'field',kind:'field',name:'Field',levelMin:1,levelMax:80,monsters:{boss:['boss']}}]}},board={_receivedAt:now,now,list:[{id:'boss',map:'field',up:true,next:0}]},corePlan={phase:'class',missing:[{name:'Core',have:0,want:1}]};
 assert.equal(campaign.chooseHunt(corePlan,s,coreWiki,board,now,{}, {now,bossBoard:board,combatReady:true}).target,null,'below-cap campaign never authorizes an unbeaten boss');
 assert(campaign.chooseHunt(corePlan,{...s,bestiary:{boss:1}},coreWiki,board,now,{}, {now,bossBoard:board,combatReady:true}).target,'personally proven safe fresh boss remains eligible');
 assert.equal(campaign.chooseHunt(corePlan,{...s,bestiary:{boss:1}},coreWiki,board,now,{}, {now,bossBoard:board,combatReady:false}).target,null,'health and supplies gate is retained');
 s.job=high;assert.equal(priority.assess(s,cat).stage,'wing');plan=campaign.plan({root,catalog:()=>cat,lastSave:s});assert.equal(plan.phase,'wing');assert.equal(plan.wing.tier,5,'first real prerequisite wing, not an invented final recipe');
const wing=plan.target;s.bag=[wing];assert(require('../src/gear-value').compare(s,{...cat,equipmentGoal:{enabled:true,rarity:'legendary',refine:10,bridgeOwned:false}},wing).upgrade,'owned first Epic wing can actually be equipped under strict Legendary policy');assert.equal(priority.assess(s,cat).stage,'wing','owned is not yet equipped');assert.equal(campaign.plan({root,catalog:()=>cat,lastSave:s}).phase,'equip');
s.equip.wing=wing;assert.equal(priority.assess(s,cat).stage,'equipment');
const upgrade=campaign.plan({root,catalog:()=>cat,lastSave:s});
assert.equal(upgrade.phase,'wing','equipped first wing does not complete the final-wing campaign');assert(upgrade.active);assert.equal(upgrade.wing.tier,6);assert.notEqual(upgrade.target,wing);assert(!upgrade.ready);
assert(upgrade.requirements.some(r=>r.name==='Copper'&&r.want===500000),'final wing retains its own reviewed resource requirements');
const finalOwned={...s,bag:[wing,upgrade.target]};
const finalEquip=campaign.plan({root,catalog:()=>cat,lastSave:finalOwned});assert.equal(finalEquip.phase,'equip');assert.equal(finalEquip.target,upgrade.target,'owned final wing precedes prerequisite already equipped');
const complete=campaign.plan({root,catalog:()=>cat,lastSave:{...finalOwned,equip:{wing:upgrade.target}}});assert.equal(complete.phase,'complete');assert.equal(complete.active,false,'only final wing equipped completes campaign');
const unknownRecipe=campaign.assessWithWing(s,cat,wiki,{nextClass:null,promotionMissing:[]},{...upgrade.wing,recipeVerified:false,blockedReason:'fixture changed formula'});assert.equal(unknownRecipe.phase,'blocked','first wing must not approve an unknown next-tier formula');
for(const [nextJob,nextDef]of Object.entries(cat.world.HIGH_CLASSES)){
 const initial={...s,job:nextJob,lv:120,equip:{},bag:[],materials:{}},a=campaign.plan({root,catalog:()=>cat,lastSave:initial});
 if(!a.wing)continue;
 const b=campaign.plan({root,catalog:()=>cat,lastSave:{...initial,equip:{wing:a.target},bag:[a.target]}});
 assert.equal(b.phase,'wing','all usable class chains keep final wing as primary campaign: '+nextJob);assert.equal(b.wing.tier,6);
}
assert(brain.profile(s,cat,wiki).availableFocuses.includes('focus_refine'));
const blocked={...s,equip:{wing:'unknown'}};assert.equal(priority.assess(blocked,cat).equipmentAllowed,false);
const catCostume={...cat,items:{...cat.items,costume:{id:'costume',slot:'costume'}}};assert.equal(priority.assess({...s,equip:{wing:'costume'}},catCostume).wing,false,'costume is not combat wing');
const growth=require('../src/planning/endgame-growth');assert.equal(growth.assess({lastSave:blocked,catalog:()=>cat},wiki,null).candidates.length,0);
assert.equal(require('../src/runtime/development-progress').refineOpportunity({root,lastSave:blocked,catalog:()=>cat}),null);
(async()=>{
 const {GameInstance}=require('../src/instance'),i={slot:0,root,lastSave:blocked,lastSaveAt:Date.now(),catalog:()=>cat};
 const result=await GameInstance.prototype.refineEquipped.call(i,{});assert.equal(result.refined,0);assert.match(result.reason,/ปีก/);assert.equal(i.developmentLedger,undefined,'blocked spend must not create or clear a journal');
 const noPet={...i,lastSave:{...s,pets:{},petActive:null}};assert.equal((await GameInstance.prototype.advanceJob.call(noPet)).reason,'active-owned-pet-required');
 console.log('PASS native pet/class/first-wing readiness, final-wing campaign ownership, exact equip completion, unknown recipe guard, six class chains and payment boundary');
})().catch(e=>{console.error(e);process.exitCode=1;});
