'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-host-teams-')),base=path.resolve(__dirname,'..');
const write=(n,v)=>{const f=path.join(root,n);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v));};
const policy=JSON.parse(fs.readFileSync(path.join(base,'machines/host-teams.json'))),topology=JSON.parse(fs.readFileSync(path.join(base,'machines/topology-v32.json')));
const {team}=require('../src/planning/host-team-scope'),{Federation}=require('../src/federation');
async function main(){
 assert.equal(team(undefined,'vps'),null,'unknown fixture root cannot authorize local scope');
 assert.equal(team(root,'tum'),null,'old fixtures/configurations remain compatible');
 write('machines/host-teams.json',policy);write('machines/topology-v32.json',topology);write('machines/fleet.json',JSON.parse(fs.readFileSync(path.join(base,'machines/fleet.json'))));write('machines/daily-team-activities.json',{enabled:false});
 assert.equal(team(root,'windows'),null,'Windows scope is unchanged');
 for(const host of ['tum','vps']){const t=team(root,host);assert.equal(t.members.length,3);assert.equal(t.coordinatorHost,host);assert(t.members.every(m=>m.machine===host));assert(!t.members.some(m=>['ExampleRogueB','ExampleMageB','ExampleMonkB'].includes(m.charName)));}
 for(const mutate of [p=>p.teams.vps.members[2]='ExampleRogueB',p=>p.teams.vps.members[2]=p.teams.vps.members[0],p=>p.teams.vps.leader='ExampleTankA',p=>p.teams.vps.members.push('ExampleMonkB'),p=>p.teams.windows=p.teams.vps]){const bad=structuredClone(policy);mutate(bad);write('machines/host-teams.json',bad);assert.throws(()=>team(root,'vps'),/Host team/);}
 write('machines/host-teams.json',policy);const at=Date.now(),commands=[];
 for(const host of ['tum','vps']){
  const f=new Federation(root,host,{now:()=>at});assert(f.localScope&&f.coordinator);assert.equal(f.remote(),null);assert.deepEqual(f.sources({machine:host}),[{machine:host}]);
  const t=team(root,host),native=t.members.map((m,n)=>({name:m.charName,aid:n+10}));
  const instances=t.members.map(m=>({slot:m.slot,status:'playing',credentials:{charName:m.charName,password:'NEVER_SEND'},lastSave:{job:m.baseJob,lv:120},lastSaveAt:at,livePos:{room:'town',at},party:native,
   async partyState(){return this.party.length?{id:1,leader:10,members:this.party,_receivedAt:at}:null;},async partyLeave(){commands.push(['leave',m.charName]);this.party=[];},async partyInvite(name){commands.push(['invite',name]);},async socialFrames(){return [];}}));
  f.publish(instances,{id:1,leader:t.leader,members:native.map(m=>m.name),checkedAt:at},'game');
  assert.equal(f.view().expected,3);assert.equal(f.view().scope,'host');assert.equal(f.view().members.length,3);assert.equal(f.workboard.state.build,'game','VPS board uses its own source build');assert.equal(f.peers(instances).length,3);assert.equal(f.local.workflow.leader,undefined,'idle workflow is not an invented activity success');
  const before=JSON.stringify(f.local);await f.exchange();assert.equal(JSON.stringify(f.local),before);assert.equal(f.busy,false,'no remote transport requested');
  instances[0].party=[...native,{name:'ForeignActor',aid:99}];await f.partyRound({instances,guildOn:false});assert(commands.some(c=>c[0]==='leave'&&c[1]===t.leader));assert(!commands.some(c=>c[0]==='invite'&&c[1]==='ForeignActor'));
  const count=commands.length;instances[0].party=[...native,{name:'ForeignActor',aid:99}];instances[0].livePos.room='gd#protected';await f.partyRound({instances,guildOn:false});assert.equal(commands.length,count,'protected native run is never split');
  const cross=require('../src/runtime/cross-party-activities');cross.pulse({root,machine:host,instances:[{get status(){throw Error('Foreign workflow should not touch local actor');}}]});
 }
 // Sent/unknown original trade records remain byte-identical at construction.
 const unknown={id:'old-transfer',phase:'UNCERTAIN',offer:{donor:'ExampleTankA',receiver:'ExampleTankB'},reason:'receipt_unknown'};write('logs/fleet/team-trade.json',unknown);const bytes=fs.readFileSync(path.join(root,'logs/fleet/team-trade.json'));new Federation(root,'vps',{now:()=>at});assert.deepEqual(fs.readFileSync(path.join(root,'logs/fleet/team-trade.json')),bytes);
 console.log('PASS exact registered 3+3 assignment, paused/foreign/duplicate rejection, local coordinator/board/peers without other-host feed, no remote exchange/delegation, safe native party separation and original uncertainty preservation');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
