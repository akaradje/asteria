'use strict';
const assert=require('assert/strict'),vm=require('vm'),{GameInstance}=require('../src/instance');
const policy=require('../src/enchant-plan');
async function run(changeText=false){
 const i=Object.create(GameInstance.prototype),lines=[{k:'atk',s:3,v:18},null,{k:'crit',s:3,v:.06}];let rolls=0;
 Object.assign(i,{root:process.cwd(),lastSaveAt:Date.now(),lastSave:{equip:{weapon:'w'},weaponOpts:{w:lines},job:'nightfang',lv:80,coins:50000,tokens:3,runeDust:1122},catalog:()=>({items:{w:{name:'weapon',tier:4}},world:null}),openTownService:async()=>({ok:true}),closeGamePanel:async()=>{},onBrainReport:()=>{}});
 const locks=lines.map(o=>({disabled:!o,on:false,classList:{contains(){return this.owner.on;}},click(){this.on=!this.on;}}));locks.forEach(b=>b.classList.owner=b);
 const weapon={dataset:{enW:'w'},classList:{contains:()=>true}};
 const rows=lines.map(o=>({textContent:policy.text(o)}));if(changeText)rows[0].textContent='MATK +18';
 const go={disabled:false,textContent:'หมุนออฟ',click(){assert(locks[0].on&&locks[2].on);rolls++;i.lastSave={...i.lastSave,runeDust:1002,weaponOpts:{w:[lines[0],{k:'atk',s:2,v:12},lines[2]]}};i.lastSaveAt=Date.now()+1;}};
 const document={querySelector(s){if(s==='[data-en-tab="roll"]')return {click(){}};if(s==='[data-en-w].on')return weapon;if(s==='[data-en-go]')return go;if(s==='#pBody .ex-head')return {children:[{textContent:'1,122 ผงรูน'},{textContent:'3 Token'},{textContent:'50,000'}]};const m=s.match(/data-en-lock="(\d)"/);return m?locks[+m[1]]:null;},querySelectorAll(s){if(s==='[data-en-w]')return [weapon];if(s==='#pBody .en-line .val')return rows;return [];}};
 i.eval=async code=>vm.runInNewContext(code,{document});await i.enchantWeapon();return {rolls,status:i.enchantStatus};
}
(async()=>{let r=await run();assert.equal(r.rolls,1);assert(r.status.reason.includes('อยู่ครบ'));r=await run(true);assert.equal(r.rolls,0);console.log('PASS DOM locks before roll, displayed balances, preserved lines, changed UI abort');})().catch(e=>{console.error(e);process.exitCode=1;});
