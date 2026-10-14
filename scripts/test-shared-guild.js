'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{round,authority}=require('../src/runtime/shared-guild');
async function run(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-shared-guild-'));
 try{
  const now=1000000,config={name:'ExampleGuild',leader:'ExampleTankA'},cache=path.join(root,'native');fs.mkdirSync(path.join(cache,'asteria-online.io'),{recursive:true});fs.mkdirSync(path.join(root,'logs'));
  fs.writeFileSync(path.join(cache,'asteria-online.io/asteria-online-visual-polish.html'),["NET.social('ginv', { name })","NET.social('grank', { aid, rank: b.dataset.rank })","kind === 'guild' ? 'gans'",'data-rank="officer"'].join('\n'));
  const g={id:1,name:config.name,leader:config.leader,checkedAt:now,leaderFrom:[10],members:['ExampleTankA'],roster:[{name:'ExampleTankA',aid:10,rank:'leader'}]};
  const file=path.join(root,'logs/shared-guild-authority.json'),put=x=>fs.writeFileSync(file,JSON.stringify(x));put(g);
  const actions=[],actor={credentials:{charName:'ExampleTankB'},guildState:async()=>null,socialFrames:async()=>[{name:'Other',guild:g.name,from:10},{name:g.leader,guild:g.name,from:99},{name:g.leader,guild:g.name,from:10}],socialSend:async(t,p)=>{actions.push([t,p]);return {ok:true};}},farm={root,cache:{dir:cache},guildOn:true};
  await round(farm,[actor],config,{now:()=>now});assert.deepEqual(actions,[['gans',{from:10,ok:true}]]);assert.equal(actor.guildMembership.phase,'awaiting-server-membership');
  await round(farm,[actor],config,{now:()=>now});assert.equal(actions.length,1,'ambiguous invite acceptance not immediately replayed');
  for(const bad of [{...g,checkedAt:now-90000},{...g,checkedAt:now+1},{...g,name:'Wrong'}]){put(bad);assert.equal(authority(root,now,config),null);}
  actor.guildAccepted=null;put({...g,checkedAt:now-90000});await round(farm,[actor],config,{now:()=>now});assert.equal(actions.length,1,'expired authority cannot authorize invitation');
  put(g);actor.guildState=async()=>({id:2});await round(farm,[actor],config,{now:()=>now});assert.equal(actions.length,1);assert.equal(actor.guildMembership.phase,'blocked');
  actor.guildState=async()=>null;actor.livePos={room:'gd1'};await round(farm,[actor],config,{now:()=>now});assert.equal(actions.length,1);
  assert(actions.every(([t])=>t==='gans'),'new squad never creates guild, changes roles, starts dungeon or sends invitations');
  console.log('PASS founder identity/freshness/foreign-guild/dungeon guards and independent membership confirmation');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
