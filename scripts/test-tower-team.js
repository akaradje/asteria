'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {TowerTeam}=require('../src/tower-team');
async function scenario(change=()=>{}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tower-team-'));let now=1000000,run=null;const events=[];
 const party={id:4,leader:3,members:Array.from({length:6},(_,slot)=>({aid:slot,name:'hero'+slot}))};
 const team=party.members.map((m,slot)=>({slot,credentials:{charName:m.name},status:'playing',lastSaveAt:now,lastSave:{hp:100,lv:30+slot*10,potions:20,equip:{weapon:'w',armor:'a',head:'h',boots:'b'}},town:false,member:false,left:3,
  async towerQuery(){this.received=now;},
  async towerState(){return {_receivedAt:this.received,left:this.left,runs:3,minLv:15,starts:[1,11],run:run&&{...run,member:this.member}};},
  async partyState(){return party;},async expeditionAuto(f){events.push(['auto',slot,f]);},
  async returnToTown(){this.town=true;events.push(['town',slot]);return {ok:true};},
  async screen(){return {inGame:true,hp:'100 / 100',mp:'50 / 50',loc:this.town?'Asteria Town':'field'};},async prepareDungeon(){return {ready:true,name:m.name};},
  async towerStart(from){assert.equal(slot,3);assert(team.every(i=>i.town));events.push(['start',slot,from]);run={id:9,floor:from};this.member=true;this.left--;},
  async towerJoin(id){assert(run);assert.equal(id,9);assert(team[3].member);events.push(['join',slot]);this.member=true;this.left--;}
 }));
 const options={now:()=>now,wait:async ms=>{now+=ms;},report:()=>{}};
 const coordinator=new TowerTeam(root,options);
 try{await change({team,coordinator,events,setRun:r=>{run=r;},advance:ms=>{now+=ms;},root,options});await coordinator.run(team,6);return {info:coordinator.info,events,team};}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}
(async()=>{
 assert(require('../src/supervisor').Supervisor.prototype.maybeRunTower.toString().includes('towerTeam'),'supervisor must delegate to the coordinator');
 let r=await scenario();assert.equal(r.info.phase,'running');assert.equal(r.info.joined.length,6);assert.equal(r.events.filter(e=>e[0]==='start').length,1);assert.equal(r.events.find(e=>e[0]==='start')[2],1);assert(r.team.every(i=>!i.teamControl));
 r=await scenario(({team})=>{team[2].prepareDungeon=async()=>({ready:false,name:'hero2'});});assert.equal(r.info.phase,'preparing');assert(!r.events.some(e=>e[0]==='start'));
 r=await scenario(({team})=>{team[2].screen=async()=>({inGame:true,loc:'town',hp:'10 / 100',mp:'50 / 50'});});assert.equal(r.info.phase,'preparing');assert(!r.events.some(e=>e[0]==='start'));
 r=await scenario(({team})=>{team[2].left=0;});assert.equal(r.info.phase,'waiting');assert(!r.events.some(e=>e[0]==='start'));
 r=await scenario(({team})=>{team[1].returnToTown=async()=>({ok:false});});assert(r.info.missing.includes('hero1'));assert(!r.events.some(e=>e[0]==='start'));
 r=await scenario(({team})=>{team[0].towerState=async()=>({_receivedAt:1,left:3});});assert.equal(r.info.phase,'waiting');assert(!r.events.length);
 r=await scenario(({team})=>{team[3].towerStart=async()=>{};});assert.equal(r.info.phase,'uncertain');assert(!r.events.some(e=>e[0]==='join'));
 r=await scenario(({team})=>{team[5].towerJoin=async()=>{};});assert.equal(r.info.phase,'partial');assert(r.info.missing.includes('hero5'));
 r=await scenario(({setRun,team})=>{setRun({id:9,floor:7});team[3].member=true;});assert.equal(r.info.phase,'running');assert(!r.events.some(e=>e[0]==='join'||e[0]==='start'));
 r=await scenario(({coordinator,root,options})=>{coordinator.saved={attemptAt:options.now()-1000,deadline:options.now()+119000};coordinator.persist();const recovered=new TowerTeam(root,options);coordinator.saved=recovered.saved;});assert.equal(r.info.phase,'cooldown');assert(!r.events.some(e=>e[0]==='start'));
 console.log('tower-team: leader first, six confirmed, server quotas, gathering failure, stale data, ambiguous start, timeout and restart guard passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
