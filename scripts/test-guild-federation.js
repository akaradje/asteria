'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {project,trustedInvite,round}=require('../src/runtime/guild-team');
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-guild-'));
 try{
  fs.mkdirSync(path.join(root,'logs'));fs.mkdirSync(path.join(root,'native/asteria-online.io'),{recursive:true});
  fs.writeFileSync(path.join(root,'native/asteria-online.io/asteria-online-visual-polish.html'),["NET.social('ginv', { name })","NET.social('grank', { aid, rank: b.dataset.rank })","kind === 'guild' ? 'gans'",'data-rank="officer"'].join('\n'));
  const now=1000000,native={id:1,name:'ExampleGuild',lv:1,cap:12,_receivedAt:now,members:[{name:'ExampleTankA',rank:'leader',aid:10,id:100},{name:'YouLater',rank:'member',aid:77,id:777}]};
  const g=project(native,'ExampleTankA');assert(g);assert.equal(project(native,'Other'),null);
  const invite={name:'ExampleTankA',guild:'ExampleGuild',from:100};assert(trustedInvite(invite,g,'ExampleTankA'));
  for(const bad of [{name:'Other'},{guild:'Wrong'},{from:999},{from:null}])assert(!trustedInvite({...invite,...bad},g,'ExampleTankA'));
  const actions=[],leader={credentials:{charName:'ExampleTankA'},guildState:async()=>native,guildInvite:async name=>actions.push(['ginv',name]),socialSend:async(t,p)=>{actions.push([t,p]);return {ok:true};}};
  const federation={root,config:{leader:'ExampleTankA'},now:()=>now,view:()=>({members:[{charName:'ExampleTankA',online:true},{charName:'ExampleRogue',online:true},{charName:'Offline',online:false}]}),save:(p,r)=>fs.writeFileSync(p,JSON.stringify(r))};
  const farm={guildOn:true,cache:{dir:path.join(root,'native')}};
  const file=path.join(root,'logs/guild-rank-request.json');fs.writeFileSync(file,JSON.stringify({at:now,guildId:1,guildName:'ExampleGuild',name:'YouLater',rank:'officer',status:'pending'}));
  await round(federation,farm,[leader],leader);assert.deepEqual(actions,[['ginv','ExampleRogue'],['grank',{aid:77,rank:'officer'}]]);
  assert.equal(JSON.parse(fs.readFileSync(file)).status,'sent-awaiting-confirmation');
  await round(federation,farm,[leader],leader);assert.equal(actions.length,2,'no repeated rank change or invite storm');
  native.members[1].rank='officer';await round(federation,farm,[leader],leader);assert.equal(JSON.parse(fs.readFileSync(file)).status,'confirmed');
  assert(farm.guildInfo.roles.some(m=>m.name==='YouLater'&&m.rank==='officer'));
  const receiver={credentials:{charName:'ExampleRogue'},guildState:async()=>null,socialFrames:async(t,since)=>{assert.equal(t,'ginvite');assert.equal(since,now-55000);return [{...invite,name:'Other'},invite];},socialSend:leader.socialSend};
  federation.remote=()=>({guild:g});await round(federation,farm,[receiver],null);assert.deepEqual(actions.at(-1),['gans',{from:100,ok:true}]);
  const length=actions.length;await round(federation,farm,[receiver],null);assert.equal(actions.length,length,'pending accept not replayed');
  receiver.guildState=async()=>({id:2});await round(federation,farm,[receiver],null);assert.equal(receiver.guildMembership.phase,'blocked');assert.equal(actions.length,length);
  receiver.guildState=async()=>null;receiver.guildAccepted=null;receiver.livePos={room:'tw1'};await round(federation,farm,[receiver],null);assert.equal(actions.length,length);
  receiver.livePos=null;federation.remote=()=>null;await round(federation,farm,[receiver],null);assert.equal(actions.length,length,'no stale authority acceptance');
  native.members[1].rank='member';fs.writeFileSync(file,JSON.stringify({at:now,guildId:1,guildName:'ExampleGuild',name:'YouLater',rank:'leader',status:'pending'}));await round(federation,farm,[leader],leader);assert.equal(actions.length,length,'cannot transfer leadership');
  assert(!actions.some(([t])=>/^(gdstart|dgstart|twstart|gleave|gkick)$/.test(t)),'membership never opens dungeons or removes people');
  console.log('PASS: remote roster, trusted invitation, idempotent officer confirmation, other-guild/stale/dungeon guards');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
