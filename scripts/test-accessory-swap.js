'use strict';
const assert=require('assert/strict'),vm=require('vm'),fs=require('fs'),os=require('os'),path=require('path');
const {GameInstance}=require('../src/instance'),{ResultLedger}=require('../src/result-ledger');
const cat={world:{bagCap:()=>8},items:{strong:{id:'strong',name:'Strong',slot:'acc',stats:{atk:100}},weak:{id:'weak',name:'Weak',slot:'acc',stats:{atk:1}},better:{id:'better',name:'Better',slot:'acc',stats:{atk:20}}}};
function fixture({full=false,failWear=false,detachedProof=true}={}){
 const i={lastSaveAt:Date.now(),lastSave:{job:'ranger',lv:120,equip:{acc1:'strong',acc2:'weak'},bag:[{id:'better',uid:3}]},catalog:()=>cat,async openGamePanel(){return {ok:true};},async closeGamePanel(){}};
 if(full)i.lastSave.bag=Array.from({length:8},(_,n)=>({id:'better',uid:n+3}));
 let selected=null,uid=10;
 const touch=()=>{i.lastSaveAt=Date.now()+2;};
 const pop={hidden:false};
 const equip={disabled:false,click(){if(failWear&&selected==='better')return;const p=i.lastSave.bag.findIndex(x=>x.id===selected);if(p<0)return;const slot=['acc1','acc2'].find(k=>!i.lastSave.equip[k])||'acc1';const old=i.lastSave.equip[slot];i.lastSave.bag.splice(p,1);if(old)i.lastSave.bag.push({id:old,uid:uid++});i.lastSave.equip[slot]=selected;touch();}};
 const unequip={disabled:false,click(){if(!detachedProof)return;const slot=selected.slice(5),old=i.lastSave.equip[slot];i.lastSave.bag.push({id:old,uid:uid++});i.lastSave.equip[slot]=null;touch();}};
 const document={getElementById:()=>pop,querySelector(s){if(s.includes('.eslot-n'))return {textContent:'Strong'};if(s.includes('.eslot'))return {classList:{contains:()=>!i.lastSave.equip.acc2},click(){selected='slot:acc2';}};if(s.includes('[data-act="unequip"]'))return unequip;if(s.includes('[data-act="equip"]'))return equip;return null;},querySelectorAll(s){return s.includes('.tile')?i.lastSave.bag.map(x=>({dataset:{k:String(x.uid)},title:cat.items[x.id].name,querySelector:()=>null,click(){selected=x.id;}})):[];}};
 i.eval=code=>Promise.resolve(vm.runInNewContext(code,{document}));return i;
}
(async()=>{
 let i=fixture(),r=await GameInstance.prototype.equipItems.call(i,[{id:'better',name:'Better',slot:'acc2'}]);assert.equal(r.equipped,1);assert.deepEqual(i.lastSave.equip,{acc1:'strong',acc2:'better'});assert(i.lastSave.bag.some(x=>x.id==='weak'));assert(!i.lastSave.bag.some(x=>x.id==='strong'));
 i=fixture({full:true});r=await GameInstance.prototype.equipItems.call(i,[{id:'better',name:'Better',slot:'acc2'}]);assert.equal(r.equipped,0);assert.equal(i.lastSave.equip.acc2,'weak');
 i=fixture();r=await GameInstance.prototype.equipItems.call(i,[{id:'better',name:'Better',slot:'acc1'}]);assert.equal(r.equipped,0);assert.equal(i.lastSave.equip.acc1,'strong');
 i=fixture();i.slot=0;i.root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-acc-live-replan-'));r=await GameInstance.prototype.equipItems.call(i,[{id:'better',name:'Better',slot:'acc1'}]);assert.equal(r.equipped,1);assert.equal(i.lastSave.equip.acc1,'strong');assert.equal(i.lastSave.equip.acc2,'better');assert.deepEqual(i.equipmentLedger.rows[0].target.equip,{acc2:'better'});
 i=fixture({failWear:true});r=await GameInstance.prototype.equipItems.call(i,[{id:'better',name:'Better',slot:'acc2'}]);assert.equal(r.equipped,0);assert.equal(i.lastSave.equip.acc2,'weak');assert(r.missed[0].includes('restored'));
 i=fixture({detachedProof:false});i.slot=0;i.root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-acc-unknown-'));r=await GameInstance.prototype.equipItems.call(i,[{id:'better',name:'Better',slot:'acc2'}]);assert.equal(r.equipped,0);assert(r.missed[0].includes('outcome-unknown'));assert.equal(i.equipmentLedger.rows[0].status,'pending');assert.equal(i.lastSave.equip.acc1,'strong');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-acc-ledger-')),l=new ResultLedger(dir,0),state={coins:100,equip:{acc1:'strong',acc2:'weak'},bag:[]};let row=l.begin('equip',{equip:{acc2:'better'}},state,1);
 l.observe({...state,coins:50,equip:{acc1:'strong',acc2:null}},2);assert.equal(row.status,'pending');l.observe({...state,equip:{acc1:'better',acc2:'weak'}},3);assert.equal(row.status,'pending');l.observe({...state,equip:{acc1:'strong',acc2:'better'}},4);assert.equal(row.status,'change_observed');
 row=l.begin('equip',{},state,10);assert(!l.reconcileEquipLoad(state,{at:20,sessionStartedAt:15}));assert(!l.reconcileEquipLoad({equip:{}},{at:70011,sessionStartedAt:70010}));assert(l.reconcileEquipLoad(state,{at:70011,sessionStartedAt:70010,rev:2}));assert.equal(row.status,'reconciled_equip_state');assert.equal(row.reconciliation.historicalSuccessKnown,false);
 row=l.begin('enchant',{id:'strong'},state,70020);assert(!l.reconcileEquipLoad(state,{at:140030,sessionStartedAt:140020}));assert.equal(row.status,'pending');
 const anti=require('../src/runtime/accessory-swap').reversesRecentSwap,history={rows:[{kind:'equip',status:'change_observed',finishedAt:100,before:{equip:{boots:'old'}},after:{equip:{boots:'new'}}}]};assert(anti(history,'boots','old',200));assert(!anti(history,'boots','old',600100));assert(!anti(history,'acc2','old',200));assert(!anti(history,'boots','other',200));
 console.log('PASS accessory acc2 native routing, retained acc1, full-bag/stale-plan guard, rollback, exact-slot ledger and free-only authoritative reconciliation');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
