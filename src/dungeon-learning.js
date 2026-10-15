'use strict';
const fs=require('fs'),path=require('path');
class DungeonLearning{
 constructor(root){this.file=path.join(root,'logs/dungeon-learning.json');try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={runs:[]};}}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 observe(team,states,now=Date.now()){
  const identities=team.map(i=>({actorId:i.actorIdentity?.actorId,build:i.catalog?.()?.build,source:i.v2?.loadedSourceIdentity?.signature}));
  this.currentScope=identities.length===3&&identities.every(i=>i.actorId&&i.build&&i.source)&&new Set(identities.map(i=>i.build)).size===1?JSON.stringify(identities.sort((a,b)=>a.actorId.localeCompare(b.actorId))):null;
  for(let n=0;n<states.length;n++){
   const s=states[n],r=s?.run;if(!r?.id)continue;
   let log=this.data.runs.find(x=>x.id===r.id);
   if(!log){log={id:r.id,scope:this.currentScope,firstSeen:now,lastSeen:now,from:r.floor,maxFloor:r.floor,members:{},status:'observed',evidence:'server_tw'};this.data.runs.unshift(log);this.data.runs=this.data.runs.slice(0,80);}
   log.lastSeen=now;log.maxFloor=Math.max(log.maxFloor||1,r.floor||1);if(r.done){log.status=String(r.done);log.finishedAt ||=now;}
   const i=team[n];if(r.member&&i){const old=log.members[i.slot]||{slot:i.slot,name:i.credentials?.charName,actorId:i.actorIdentity?.actorId||null,job:i.lastSave?.job,combatBaseline:i.combatEvidence?.view(i,now)?.current||null,level:i.lastSave?.lv,livesStart:r.lives};log.members[i.slot]={...old,livesLeft:r.lives,losses:Number.isFinite(r.lives)?Math.max(old.losses||0,(old.livesStart||0)-r.lives):old.losses||0};}
  }
  // Disappearing from telemetry is unknown, never silently promoted to a clear.
  for(const log of this.data.runs)if(log.status==='observed'&&now-log.lastSeen>180000)log.status='connection_unknown';
  this.save();
 }
 reward(runId,slot,event,at){const log=this.data.runs.find(r=>r.id===runId);if(!log)return;log.rewards ||= [];const key=slot+':'+event.floor;if(log.rewards.some(x=>x.key===key))return;log.rewards.push({key,slot,floor:event.floor,coins:event.coins||0,dust:event.dust||0,at});this.save();}
 end(runId,slot,event,at){const log=this.data.runs.find(r=>r.id===runId);if(!log)return;log.departures ||= {};log.departures[slot]={at,reason:event.lost?'server_lost':event.out?'lives_exhausted':event.quit?'quit':'ended'};if(Object.keys(log.members).length&&Object.keys(log.members).every(s=>log.departures[s])){log.finishedAt ||=at;if(log.status==='observed')log.status='ended_unclassified';}this.save();}
 choose(starts,slots){
  const ordered=[...starts].sort((a,b)=>a-b),history=this.data.runs.filter(r=>r.finishedAt&&(!this.currentScope||r.scope===this.currentScope)&&slots.every(s=>r.members[s]));
  if(!history.length)return {from:ordered[0],reason:'ยังไม่มีผลจบรอบครบทีม เริ่มชั้นต่ำสุดร่วมกัน'};
  const recent=history[0],losses=Object.values(recent.members).reduce((n,m)=>n+(m.losses||0),0);
  const ceiling=recent.status==='clear'&&losses===0?recent.maxFloor:Math.max(1,(recent.maxFloor||1)-10);
  return {from:ordered.filter(n=>n<=ceiling).at(-1)||ordered[0],reason:losses?'ลดระดับเริ่มหลังเสียชีวิต/เสียจำนวนฟื้น':'ใช้ชั้นที่มีผลรอบก่อนรองรับ'};
 }
 priorities(){const r=this.data.runs.find(r=>r.finishedAt);return r?Object.values(r.members).filter(m=>m.losses>0).sort((a,b)=>b.losses-a.losses).map(m=>({slot:m.slot,focus:'focus_gear',reason:'เสียจำนวนฟื้น '+m.losses+' ครั้งในรอบ '+r.id+' · ตรวจอุปกรณ์ป้องกันและ HP ก่อนรอบใหม่'})):[];}
 supportOutcomes(){const rows=this.data.runs.filter(r=>r.scope&&r.scope===this.currentScope&&r.finishedAt&&Object.keys(r.members).length===3&&r.status!=='connection_unknown');const complete=rows.filter(r=>r.status==='clear'),clean=complete.filter(r=>Object.values(r.members).every(m=>m.losses===0));return {scope:this.currentScope,runs:rows.length,nativeClears:complete.length,deathFreeClears:clean.length,completionRate:rows.length?complete.length/rows.length:null,deathFreeClearRate:rows.length?clean.length/rows.length:null,attribution:'complete_registered_party_outcomes_not_causal_healer_contribution',serverVerified:rows.length>0};}
 view(){return {supportOutcomes:this.supportOutcomes(),runs:this.data.runs.slice(0,12),priorities:this.priorities()};}
}
module.exports={DungeonLearning};
