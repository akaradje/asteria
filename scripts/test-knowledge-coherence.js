'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const economy=require('../src/economy'),mastery=require('../src/knowledge/mastery-service'),encyclopedia=require('../src/knowledge/encyclopedia');
const verifier=require('../src/verify-wing-recipes');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-knowledge-coherence-'));
const originalVerify=verifier.verify,originalCompile=encyclopedia.compile;
try{
 let verifies=0,compiles=0;
 verifier.verify=(...args)=>{verifies++;return originalVerify(...args);};
 encyclopedia.compile=(...args)=>{compiles++;return originalCompile(...args);};
 const wiki={items:{equipment:[]},crafting:{recipes:[{type:'wing',resultId:'w',result:'Wing',cost:{Copper:1},reqLv:1}]},classes:{},maps:{maps:[]},monsters:{monsters:[]},quests:{},systems:{}};
 fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/wiki.json'),JSON.stringify(wiki));
 function fixture(build,world=true){const dir=path.join(root,'cache',build,'asteria-online.io');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'asteria-online-visual-polish.html'),"const ITEMS = {}; const WINGS = {w:{name:'Wing',tier:1,line:'knight',stats:{def:1}}};");if(world)fs.writeFileSync(path.join(dir,'asteria-world-system.js'),"module.exports={EQUIPMENT:[],MONSTERS:[],HIGH_CLASSES:{},MAX_LV:120};");return dir;}
 const dir=fixture('old'),first=economy.loadCatalog(root,'old');assert.equal(first.wingRecipes[0].verified,false);
 for(let n=0;n<20;n++)assert.strictEqual(economy.loadCatalog(root,'old'),first);
 assert.equal(verifies,1,'an unchanged refused recipe is not parsed twenty times');
 const book=mastery.getBook(root,'old');assert.equal(book.recipeValidation.verified,0);for(let n=0;n<6;n++)assert.strictEqual(mastery.getBook(root,'old'),book);assert.equal(compiles,1);
 assert(book.capabilities.every(c=>!c.serverVerified),'caching never upgrades evidence');
 wiki.fixtureRevision='new data';fs.writeFileSync(path.join(root,'data/wiki.json'),JSON.stringify(wiki));
 const refreshed=economy.loadCatalog(root,'old');assert.notStrictEqual(refreshed,first);assert.equal(refreshed.wingRecipes[0].verified,false);assert.notStrictEqual(mastery.getBook(root,'old'),book);assert.equal(compiles,2);
 fs.appendFileSync(path.join(dir,'asteria-online-visual-polish.html'),'\n// changed native source');assert.notStrictEqual(economy.loadCatalog(root,'old'),refreshed);
 fixture('partial',false);assert.throws(()=>economy.loadCatalog(root,'partial'),/World data unavailable/,'a partial download must not borrow another build world');
 const bounded=economy.loadCatalog(root,'old');for(let n=0;n<9;n++){fixture('b'+n);economy.loadCatalog(root,'b'+n);}assert.notStrictEqual(economy.loadCatalog(root,'old'),bounded,'catalog history has a bounded in-memory footprint');
 console.log('PASS refused-knowledge cache reuse, unchanged verification refusal, file-driven invalidation, partial-build isolation and bounded catalog history');
}finally{verifier.verify=originalVerify;encyclopedia.compile=originalCompile;assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}

(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-build-poll-'));
 try{
  let now=1000,calls=0;
  const k=new(require('../src/game-knowledge').GameKnowledge)(temp,{now:()=>now,fetcher:async()=>{calls++;throw Error('fixture offline');}});
  k.lastPolledBuild='old';k.nextAt=9000;
  assert.equal(await k.poll('old'),false);assert.equal(calls,0,'same build keeps normal interval');
  await k.poll('new');assert.equal(calls,1,'new loaded build bypasses the old timer');
  await k.poll('new');assert.equal(calls,1,'failed new-build fetch keeps retry backoff');
  k.busy=true;await k.poll('newer');assert.equal(calls,1,'collection never overlaps');k.busy=false;
  now=31001;await k.poll('new');assert.equal(calls,2,'retry resumes after backoff');
  console.log('PASS immediate loaded-build poll, normal interval, failure backoff and no concurrent collector');
 }finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
