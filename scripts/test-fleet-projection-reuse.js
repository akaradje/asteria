'use strict';
const assert=require('assert');
const {Federation}=require('../src/federation');
const workboard=require('../src/planning/team-workboard');
const trade=require('../src/planning/team-trade');
const economy=require('../src/economy');
const originalProject=workboard.project,originalWiki=economy.loadWiki;
try {
 let calls=0;
 workboard.project=i=>{calls++;return {needs:[{name:'fixture-material',want:2}],reserved:{},marker:i.slot+':'+calls};};
 economy.loadWiki=()=>({});
 const instances=Array.from({length:3},(_,slot)=>({slot,credentials:{charName:'C'+slot},character:{name:'C'+slot},status:'playing',lastSaveAt:Date.now(),lastSave:{bag:[],equip:{},materials:{'fixture-material':slot+1}},catalog:()=>({items:{},world:{bagCap:()=>20}})}));
 for(const machine of ['windows','tum','vps']){
  calls=0;let reconciled;
  const f={root:'.',machine,coordinator:machine!=='windows',sources:current=>[current],now:Date.now,dir:'.',remote:()=>null,view:()=>({}),save:()=>{},workboard:{state:{},reconcile:sources=>{reconciled=sources[0].members;}},activity:{state:{phase:'IDLE'},reconcile:()=>{},view:()=>({phase:'IDLE'})},daily:{policy:{enabled:true},view:{},reloadControls:()=>{},reconcile:()=>{}},trade:{state:{phase:'IDLE'},view:()=>null,reconcile:()=>{}}};
  Federation.prototype.publish.call(f,instances,null,'fixture');
  assert.equal(calls,3,'one work projection per actor for each publication on '+machine);
  for(const [index,member]of f.local.members.entries()){
   assert.equal(member.teamInventory.materials['fixture-material'],index+1);
   assert.equal(member.teamWork.marker,index+':'+(index+1));
  }
  if(machine!=='windows')assert.strictEqual(f.local.members,reconciled,'coordinator publishes the same consistent actor observation it reconciled');
 }
 calls=0;assert(trade.inventory(instances[0]));assert.equal(calls,1,'standalone callers still derive their work projection');
 console.log('PASS one projection per actor/publication, same coordinator observation, preserved material needs and standalone inventory compatibility');
}finally{workboard.project=originalProject;economy.loadWiki=originalWiki;}
