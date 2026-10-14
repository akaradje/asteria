'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {CompletionMeasurements,context}=require('../src/learning/completion-measurements');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-completion-'));fs.mkdirSync(path.join(root,'machines'));fs.writeFileSync(path.join(root,'machines/runtime-v32.json'),JSON.stringify({version:1,realm:'fixture',epoch:'one',epochEvidence:'fixture',policyRevision:1,durableDocuments:true}));
try{
 const s={job:'asura',lv:120,equip:{weapon:'w'},refine:{w:2},skills:{},materials:{Ore:0},bestiary:{m:0}},i={lastSave:s,goal:{monsterId:'m',mapId:'z'},livePos:{room:'z',at:100},v2:{sourceCoherence:{matches:true},journal:{rows:[],pending:()=>null}},developmentProgress:{target:{id:'item'}}},memory=new CompletionMeasurements(root,'a');
 const proof=(at,rev)=>({authority:'server_accepted_save',actorId:'a',build:'b',generation:1,at,rev});
 for(let n=0;n<12;n++){i.livePos.at=100+n*30000;s.materials.Ore=n;s.bestiary.m=n;memory.observe(i,s,proof(100+n*30000,n+1));}
 const learned=i.acquisitionMeasurements._yield['z:m:Ore'];assert(learned.samples>=10&&learned.observedMs>=300000&&learned.netPerHour===120);
 const row={id:'r',kind:'craft',target:{id:'item'},status:'server_confirmed',evidence:'server_accepted_exact_save_revision',at:1,finishedAt:2,serverReceipt:{at:2},context:{actorId:'a',build:'b',loadoutSignature:context(s)}};i.developmentLedger={rows:[row]};memory.observe(i,s,proof(360100,13));assert.equal(memory.data.stages[0].samples,1);memory.observe(i,s,proof(390100,14));assert.equal(memory.data.stages[0].samples,1,'duplicate native row never inflates completed sample count');
 row.id='client-only';row.status='change_observed';i.livePos.at=420100;memory.observe(i,s,proof(420100,15));assert.equal(memory.data.stages[0].samples,1);memory.observe(i,s,{...proof(450100,16),actorId:'other'});assert.equal(memory.previous.at,420100);
 assert(!memory.view({...s,refine:{w:3}},'b',420100)._yield['z:m:Ore']);assert(!memory.view(s,'new-build',420100)._yield['z:m:Ore']);
 const {changes,measure}=require('../src/runtime/progression-controller'),a={...i,lastSaveAt:10,lastSave:{...s,qIndex:1,qv:2,qHave:5},catalog:()=>({items:{w:{rarity:'legendary'}}})};const before=measure(a);a.lastSaveAt++;a.lastSave.qHave=0;assert(!changes(before,measure(a)).includes('quest-state'));a.lastSave.qHave=6;assert(changes(before,measure(a)).includes('quest-state'));
 console.log('PASS T51/T58/T84/T90 exact native completed-stage dedupe, actor/build/loadout scope, measured net resource yield, client-only exclusion and semantic quest progress');
}finally{require('../src/runtime/durable-store').shared(root).close();fs.rmSync(root,{recursive:true,force:true});}
