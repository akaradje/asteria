'use strict';
const fs=require('fs'),path=require('path');
function read(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return {};}}
class TeamRoom{
 constructor(root){this.file=path.join(root,'logs/team-room.json');this.messages=read(this.file).messages||[];}
 post(from,to,text,kind='coordination'){
  text=String(text).slice(0,1500);const last=this.messages.find(m=>m.from===from&&m.to===to&&m.kind===kind);
  if(last?.text===text&&Date.now()-last.at<300000)return;
  this.messages.unshift({at:Date.now(),from,to,text,kind});this.messages=this.messages.slice(0,200);
  fs.writeFileSync(this.file+'.tmp',JSON.stringify({messages:this.messages}));fs.renameSync(this.file+'.tmp',this.file);
 }
}
function teamView(root,running,now=Date.now()){
 const s=read(path.join(root,'logs/status.json')),configured=read(path.join(root,'team.json')).members||[],instances=s.instances||[];
 const expected=configured.length?configured:instances.map(i=>({slot:i.slot,charName:i.char}));
 const fresh=running&&now-Date.parse(s.at)<90000;
 const membership=(group,name)=>!fresh||!group?.checkedAt||now-group.checkedAt>120000?'unknown':group.members?.includes(name)?'joined':'missing';
 const thoughts=(read(path.join(root,'logs/ai-auto.json')).history||[]).flatMap(h=>(h.thoughts||[]).map(m=>({at:Date.parse(h.at),from:'สมองจอ '+m.slot,to:'หัวหน้าทีม',text:m.reason,kind:'ai'})));
 const members=expected.map(m=>{const i=instances.find(i=>i.slot===m.slot),name=m.charName||i?.char||'จอ '+m.slot;
  return {slot:m.slot,name,gameStatus:fresh?(i?.status||'not-started'):'unknown',party:membership(s.party,name),guild:membership(s.guild,name),runtimeV2:i?.runtimeV2||null,personalBrain:i?.personalBrain||null,goal:i?.goal||null,readiness:fresh?i?.readiness:null,combat:fresh?i?.combatDecision:null,gearPower:i?.gearPower||null,manaStatus:fresh?i?.manaStatus:null,bossStatus:fresh?i?.bossStatus:null,outcomes:i?.outcomes||null,gearImpact:i?.gearImpact||null,investmentPlan:i?.investmentPlan||null,development:read(path.join(root,'logs',`development-${m.storageSlot??m.slot}.json`)).rows?.slice(0,12)||[]};});
 const performance=read(path.join(root,'logs/fleet-performance.json'));delete performance.samples;
 return {at:s.at,running,performance,fleet:read(path.join(root,'logs/fleet/view.json')),runtimeV2:s.runtimeV2||null,gameKnowledge:s.gameKnowledge||null,tower:fresh?s.tower:null,dungeons:read(path.join(root,'logs/dungeon-learning.json')),party:{name:s.party?.id?'ปาร์ตี้ '+s.party.id:null,leader:s.party?.leader,checkedAt:s.party?.checkedAt,complete:members.length>0&&members.every(m=>m.party==='joined')},guild:{name:s.guild?.name,checkedAt:s.guild?.checkedAt,complete:members.length>0&&members.every(m=>m.guild==='joined')},members,messages:[...(read(path.join(root,'logs/team-room.json')).messages||[]),...thoughts].sort((a,b)=>b.at-a.at).slice(0,80)};
}
module.exports={TeamRoom,teamView};
