'use strict';
const assert=require('assert/strict');
const brain=require('../src/character-brain');
const items={
 old:{id:'old',name:'Old',slot:'weapon',tier:6,rarity:'legendary',stats:{atk:5}},
 milestone:{id:'milestone',name:'Milestone',slot:'weapon',tier:7,rarity:'legendary',stats:{atk:50}},
 dream:{id:'dream',name:'Dream',slot:'weapon',tier:7,rarity:'legendary',stats:{atk:300}},
 unknown:{id:'unknown',name:'Unknown',slot:'armor',tier:7,rarity:'legendary',stats:{def:100}},
 ring:{id:'ring',name:'Ring',slot:'acc',tier:7,rarity:'legendary',stats:{atk:10}},
 lower:{id:'lower',name:'Lower',slot:'weapon',tier:7,rarity:'legendary',stats:{atk:1}},
 premature:{id:'premature',name:'Premature',slot:'weapon',tier:7,rarity:'legendary',reqLv:121,stats:{atk:500}},
};
const recipe=(id,cost)=>({type:'gear',resultId:id,result:items[id].name,reqLv:1,cost:{Copper:10000,...cost},verified:true,verifiedBuild:'checked'});
const recipes=[recipe('dream',{Heart:6,tokens:20}),recipe('milestone',{Ore:10}),recipe('unknown',{Mystery:1}),recipe('ring',{Ore:10}),recipe('lower',{}),recipe('premature',{})];
const cat={build:'checked',items,world:{MAX_LV:120,MONSTERS:[{id:'pet',kind:'normal',element:'ไฟ',level:1}]}},wiki={crafting:{recipes},monsters:{monsters:[
 {id:'ore-mob',name:'Ore mob',kind:'normal',level:110,dropTable:[{item:'Ore',ratePct:20}]},
 {id:'heart-boss',name:'Heart boss',kind:'boss',level:120,dropTable:[{item:'Heart',ratePct:100}]},
]},maps:{maps:[{id:'c1',name:'Field',kind:'field',levelMin:100,levelMax:120,monsters:{normal:['ore-mob'],boss:['heart-boss']}}]}};
items.baselineWing={id:'baselineWing',slot:'wing',reqLv:1,stats:{}};
const save={pets:{pet:0},petActive:'pet',lv:120,job:'dragonknight',coins:100000,equip:{wing:'baselineWing',weapon:'old'},materials:{Ore:0},bag:[]};
let p=brain.profile(save,cat,wiki);
assert.equal(p.craft.id,'ring','known normal-material empty-slot milestone precedes timed high-gain recipe');
assert.equal(p.craft.acquisition.tier,1);assert.equal(p.craft.recipeEvidence,'reviewed_loaded_build');
assert.equal(p.craftPortfolio.aspirational.id,'dream','higher-gain long-term target remains visible');
assert(p.craftPortfolio.alternatives.some(r=>r.id==='dream'&&r.acquisition.requirements.some(m=>m.method==='activity_currency')));
assert(p.craftPortfolio.alternatives.some(r=>r.id==='unknown'&&r.acquisition.tier===3));
assert(!p.craftPortfolio.alternatives.some(r=>['lower','premature'].includes(r.id)),'downgrades and level-ineligible items never become candidates');
assert(!p.craft.ready);assert(p.craft.acquisition.requirements[0].sources.length);
p=brain.profile({...save,materials:{Ore:10,Heart:6},tokens:20},cat,wiki);
assert(p.craft.ready);assert.equal(p.craft.id,'ring','ready empty slot still takes priority');
p=brain.profile({...save,equip:{wing:'baselineWing',weapon:'old',acc1:'ring'},materials:{Ore:10}},cat,wiki);
assert.equal(p.craft.id,'milestone');assert(p.craft.ready);
assert.equal(brain.profile({...save,coins:12000,materials:{Ore:10}},cat,wiki).craft.ready,false,'upkeep is not spent');
p=brain.profile({...save,locks:['Ore'],materials:{Ore:10}},cat,wiki);
assert(!p.craftPortfolio.alternatives.find(r=>r.id==='ring')?.ready,'locked ingredient never appears payable');
assert(p.craftPortfolio.alternatives.find(r=>r.id==='ring')?.acquisition.requirements.some(r=>r.protected));
const locked=brain.profile({...save,locks:['Ore']},cat,{...wiki,crafting:{recipes:[recipes[1]]}});
assert.equal(locked.craft,null,'all-locked recipes do not own gathering or payment');assert(!locked.availableFocuses.includes('focus_craft'));
assert(!brain.profile(save,{...cat,build:'different'},wiki).craft,'recipe from another loaded build is refused');
const noProof={...wiki,crafting:{recipes:[{...recipes[1],verified:undefined,verifiedBuild:undefined}]}};
assert.equal(brain.profile({...save,materials:{Ore:10}},cat,noProof).craft.recipeEvidence,'requires_native_validation','resource readiness is not recipe authorization');
const mixedProof={...wiki,crafting:{recipes:[{...recipes[3],cost:{Copper:1},verified:undefined,verifiedBuild:undefined},recipes[1]]}};
const proofFirst=brain.profile(save,cat,mixedProof);
assert.equal(proofFirst.craft.id,'milestone','unreviewed ready empty slot cannot hijack a reviewed craft path');
assert(proofFirst.craftPortfolio.alternatives.some(r=>r.id==='ring'&&r.recipeEvidence==='requires_native_validation'),'uncertain recipe retained visibly for review');
assert(!proofFirst.craftPortfolio.workCandidates.some(r=>r.id==='ring'),'unreviewed side recipes cannot redirect farming');
const outOfReach={...wiki,monsters:{monsters:wiki.monsters.monsters.map(m=>({...m,level:140}))}};
assert.equal(brain.profile(save,cat,outOfReach).craft.acquisition.tier,3,'above-level drops cannot make a target look attainable');
const stable=brain.profile(save,cat,wiki);assert.equal(stable.craft.id,'ring','repeat reads and alternate source tables do not poison index');
assert(stable.craftPortfolio.alternatives.length<=6);
console.log('PASS feasible craft milestone, aspirational alternatives, source/build/level guards, reserve and locked input, deterministic bounded portfolio');
