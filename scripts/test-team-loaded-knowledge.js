'use strict';
const assert=require('assert/strict'),path=require('path');
const {Supervisor}=require('../src/supervisor'),economy=require('../src/economy'),brain=require('../src/character-brain'),director=require('../src/director');
const originals={};const replace=(module,name,value)=>{originals[name]={module,value:module[name]};module[name]=value;};
try{
 const profiles=[],wingBuilds=[],now=Date.now();let assigned,sharedLearning;
 replace(economy,'loadWiki',()=>({maps:{maps:[]},crafting:{recipes:[]}}));
 replace(economy,'newestBuild',()=>{throw Error('must not select newest downloaded build');});
 replace(economy,'loadWings',(root,build)=>{wingBuilds.push(build);return {};});
 replace(economy,'refinePlan',()=>({}));replace(economy,'wingPlan',()=>({}));replace(economy,'petPlan',()=>({}));
 replace(brain,'profile',(save,cat)=>{profiles.push(cat.build);return {gear:[],progression:{},availableFocuses:[]};});
 replace(director,'goalCandidates',()=>[]);replace(director,'teamAssign',(rows,wiki,learnedOf)=>{assigned=rows;sharedLearning=learnedOf(120);return new Map();});
 const actor=(slot,build)=>({slot,status:'playing',cache:{dir:path.join('cache',build)},lastSaveAt:now,lastSave:{lv:120,job:'knight'},catalog:()=>({build,world:{},items:{}}),brain:{strategy:()=>null,blocked:()=>({}),data:{}},teamGoal:{label:'old'}});
 const rows=[actor(0,'loaded-a'),actor(1,'loaded-b'),actor(2,'partial'),actor(3,'stale')];rows[2].catalog=()=>({build:'newest-downloaded',world:{},items:{}});rows[3].lastSaveAt=now-31000;
 Supervisor.prototype.assignTeamGoals.call({root:'.',instances:rows,log:()=>{},choresEveryMs:600000,teamRoom:{post:()=>{}}});
 assert.deepEqual(profiles,['loaded-a','loaded-b']);assert.deepEqual(wingBuilds,profiles);assert.deepEqual(assigned.map(r=>r.slot),[0,1]);
 for(const i of rows.slice(2)){assert.equal(i.teamGoal,null);assert.equal(i.teamPlanningStatus.state,'waiting');}
 assert.equal(rows[0].teamPlanningStatus.build,'loaded-a');
 assert.equal(sharedLearning,null,'mixed loaded builds must not share empirical frontier evidence');
 const stale=actor(4,'loaded-a'),valid=actor(5,'loaded-a');
 stale.lastSaveAt=now-31000;stale.learning={source:'stale'};valid.learning={source:'valid'};
 Supervisor.prototype.assignTeamGoals.call({root:'.',instances:[stale,valid],log:()=>{},choresEveryMs:600000,teamRoom:{post:()=>{}}});
 assert.equal(sharedLearning,valid.learning,'rejected actor cannot supply learning even when first/closest in level');
 console.log('PASS team goals use each actor loaded catalog/wing tables; newer cache, catalog mismatch and stale saves cannot drive assignments');
}finally{for(const[name,{module,value}]of Object.entries(originals))module[name]=value;}
