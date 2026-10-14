'use strict';
const assert=require('assert/strict'),economy=require('../src/economy'),{profile}=require('../src/character-brain');
const root=require('path').resolve(__dirname,'..'),build=economy.newestBuild(root),cat=economy.loadCatalog(root,build),wiki=economy.loadWiki(root),wings=economy.loadWings(root,build);
// T5 is an Epic prerequisite, not the persistent Legendary equipment goal.
// Exercise the legacy generic investment path separately from capped wingPlan ownership.
const legacyCat={...cat,equipmentGoal:{enabled:false}};
assert.equal(cat.wingRecipes.length,12);assert(cat.wingRecipes.every(r=>r.verified));
function make(job,held=[],materials={},coins=1000000,lv=120,recipes=wiki.crafting.recipes){return economy.wingPlan({job,held,materials,coins,lv,world:cat.world,items:cat.items,wings,recipes});}
for(const job of Object.values(economy.BASE_TO_PROMOTED)){
 const p=make(job);assert.equal(p.tier,5);assert.equal(p.reqLv,60);assert.equal(p.coinsNeeded,150000);assert.equal(p.totalCost.Copper,650000);assert.equal(p.totalCost['Celestial Plume'],8);assert(p.chainNote);
 const base=p.target,r=wiki.crafting.recipes.find(r=>r.resultId===base),m=Object.fromEntries(Object.entries(r.cost).filter(([k])=>k!=='Copper').map(([k,v])=>[k,v+1]));
 assert(make(job,[],m).craftable,'T5 is craftable without first owning T5');assert(!make(job,[],m,150000).craftable,'maintenance/class reserve respected');
 assert(!make(job,[],m,1000000,59).craftable);assert.equal(make(job,[],m,1000000,60).reqLv,60);
 const next=make(job,[base]);assert.equal(next.tier,6);assert.equal(next.coinsNeeded,500000);assert(next.requirements.some(r=>r.kind==='item'&&r.have===1));assert.equal(next.totalCost['Celestial Plume'],6);assert(!next.missing.some(r=>r.name==='Ancient Bark'));
 const done=make(job,[next.target]);assert(done.completed);assert.equal(done.missing.length,0);assert(!done.craftable);
 const highJob=Object.entries(cat.world.HIGH_CLASSES).find(([,c])=>c.from===job)[0],petId=cat.world.MONSTERS.find(m=>m.kind==='normal').id;
 const ready=profile({pets:{[petId]:0},petActive:petId,job:highJob,lv:120,coins:1000000,equip:{},bag:[],materials:m},legacyCat,wiki);assert(ready.craft.ready);assert.equal(ready.craft.type,'wing');
 assert.equal(require('../src/investment-plan').choose({job,lv:120,coins:1000000,equip:{},materials:m},legacyCat,wiki).selected,null,'capped campaign owns class-before-wing paid actions');
 assert.equal(require('../src/investment-plan').choose({pets:{[petId]:0},petActive:petId,job:highJob,lv:119,coins:1000000,equip:{},materials:m},legacyCat,wiki).selected,null,'first wing retains dedicated campaign ownership before cap too');
}
const changed=structuredClone(wiki.crafting.recipes);changed.find(r=>r.resultId==='halo_feather_wing').cost['Ancient Bark']=99;
assert.equal(make('lumenoracle').requirements.find(r=>r.name==='Ancient Bark').short,6,'include the protected High Class ingredient in the missing count');
assert.equal(require('../src/verify-wing-recipes').verify(root,build,wings,changed).find(r=>r.resultId==='halo_feather_wing').verified,false);
assert.equal(make('lumenoracle',[],{},1000000,120,changed).recipeVerified,false);
const missing=make('lumenoracle',[],{},1000000,120,[]);assert(!missing.recipeVerified);assert(!missing.craftable);
assert.equal(make('priest',['halo_feather_wing']).classOk,false);
const fs=require('fs'),path=require('path'),temp=fs.mkdtempSync(path.join(require('os').tmpdir(),'asteria-wing-refresh-'));
try{
 const dir=path.join(temp,'cache',build,'asteria-online.io');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(temp,'data'));for(const name of ['asteria-online-visual-polish.html','asteria-world-system.js'])fs.copyFileSync(path.join(root,'cache',build,'asteria-online.io',name),path.join(dir,name));
 const file=path.join(temp,'data/wiki.json');fs.writeFileSync(file,JSON.stringify(wiki));assert(economy.loadCatalog(temp,build).items.halo_feather_wing.recipeVerified);
 const altered=structuredClone(wiki);altered.crafting.recipes.find(r=>r.resultId==='halo_feather_wing').cost['Ancient Bark']=999;fs.writeFileSync(file,JSON.stringify(altered));assert(!economy.loadCatalog(temp,build).items.halo_feather_wing.recipeVerified,'changed Wiki invalidates a cached successful verification');
 fs.writeFileSync(file,JSON.stringify(wiki));assert(economy.loadCatalog(temp,build).items.halo_feather_wing.recipeVerified,'repaired source is retried without restarting');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('PASS all 12 live Wiki/client recipes, six class chains, exact T5/T6/total bills, prerequisite consumption, level/class gates, reserves, craft selection, completed wings and unknown/mismatched formula blocking');
