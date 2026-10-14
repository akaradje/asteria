'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
// Version the context so pre-stage/pet observations cannot support new decisions.
// Friendship only changes these reviewed tiers; raw kills would fragment a window.
function context(build,s){const friendship=s.petActive?s.pets?.[s.petActive]:null,petTier=Number.isFinite(friendship)&&friendship>=0?[0,100,300,600,1000].filter(n=>friendship>=n).length:null;return JSON.stringify(stable(['context-v5',build,s.job,Math.floor((s.lv||1)/5),s.equip,s.refine,s.stage||{},s.weaponOpts,s.manualT>0,s.elixirT>0,s.rested>0,s.st,s.skills,s.sockets,s.holes,s.autoOpt,Array.isArray(s.autoTargets)?[...new Set(s.autoTargets)].sort():null,s.petActive||null,petTier,s.cardAlbum??null]));}
function farmWindowEligible(i,now=Date.now()){
 const p=i.livePos,policy=require('../runtime/room-policy'),intent=i.teamTradeIntent,name=i.character?.name||i.credentials?.charName||i.char;
 // Coordinator UNCERTAIN is a quarantined terminal outcome, not an active
 // navigation owner. A real unresolved local session remains excluded below.
 const trading=intent?.offer&&[intent.offer.donor,intent.offer.receiver].includes(name)&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(intent.phase);
 const journalBusy=i.tradeJournal?.sessionId&&!['CONFIRMED','CANCELLED'].includes(i.tradeJournal.phase);
 return !!(i.lastSave&&Number.isFinite(i.lastSaveAt)&&now-i.lastSaveAt>=0&&now-i.lastSaveAt<=30000&&typeof p?.room==='string'&&p.room&&Number.isFinite(p.at)&&now-p.at>=0&&now-p.at<=10000&&p.room!=='town'&&!policy.isGuildHall(p.room)&&!policy.roomPolicy(p.room).dungeon&&!i.pendingTravel&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.pvpMission&&!i.choresBusy&&!i.recycling&&!i.healthRecovery&&!trading&&!journalBusy);
}
class ContextLearning{
 constructor(root,identity,{now=Date.now}={}){this.file=path.join(root,'logs','context-learning',crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0,16)+'.json');this.now=now;this.previous=null;try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={version:1,contexts:{}};}}
 interrupt(){this.previous=null;}
 observe(i,build){
  const now=this.now(),s=i.lastSave,p=i.livePos;if(!farmWindowEligible(i,now)){this.previous=null;return;}
  if(!build||!Number.isFinite(s.exp)||!Number.isFinite(s.coins)||!Number.isFinite(i.lastSaveAt)||!Number.isFinite(p.at)||i.lastSaveAt>now||p.at>now){this.previous=null;return;}
  const signature=context(build,s),key=JSON.stringify([signature,p.room]);
  if(this.previous?.saveAt===i.lastSaveAt)return;
  const sample={key,saveAt:i.lastSaveAt,at:now,lv:s.lv,exp:s.exp,coins:s.coins,materials:{...s.materials},dead:!!p.dead};const before=this.previous;this.previous=sample;
  if(!before||before.key!==key||now-before.at>90000||now<=before.at||before.lv!==sample.lv)return;
  if(sample.exp<before.exp)return; // Reset or ambiguous level transition is not a yield window.
  const row=this.data.contexts[key]||={build,signature,map:p.room,job:s.job,samples:0,elapsedMs:0,exp:0,netCoins:0,deaths:0};
  row.samples++;row.elapsedMs+=now-before.at;row.exp+=Math.max(0,sample.exp-before.exp);row.netCoins+=sample.coins-before.coins;if(sample.dead&&!before.dead)row.deaths++;
  row.netMaterials ||= {};for(const name of new Set([...Object.keys(sample.materials),...Object.keys(before.materials||{})])){const delta=(sample.materials[name]||0)-(before.materials?.[name]||0);if(delta)row.netMaterials[name]=(row.netMaterials[name]||0)+delta;}
  row.updatedAt=now;row.confidence=row.elapsedMs>=300000&&row.samples>=10?'observational':'insufficient_samples';
  const entries=Object.entries(this.data.contexts).sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,500);this.data.contexts=Object.fromEntries(entries);
  fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);
 }
 recommend(s,build,maps,blocked={},currentMap){
  if(!s||!build)return null;const signature=context(build,s),now=this.now();
  const eligible=new Set((maps||[]).filter(m=>m.kind==='field'&&m.levelMin<=s.lv&&!blocked[m.id]).map(m=>m.id));
  const rows=Object.values(this.data.contexts).filter(r=>r.signature===signature&&r.build===build&&eligible.has(r.map)&&r.samples>=10&&r.elapsedMs>=300000&&r.deaths===0&&now-r.updatedAt<86400000&&r.updatedAt<=now&&r.exp>0).map(r=>({...r,expPerHour:r.exp*3600000/r.elapsedMs})).sort((a,b)=>b.expPerHour-a.expPerHour);
  if(rows.length<2)return null;const best=rows[0],current=rows.find(r=>r.map===currentMap);
  if(current&&best.map!==current.map&&best.expPerHour<current.expPerHour*1.2)return null;
  const trial={build,mapId:best.map,baselineMap:current?.map||null,expPerHour:Math.round(best.expPerHour),baselineExpPerHour:current?Math.round(current.expPerHour):null,samples:best.samples,minutes:Math.round(best.elapsedMs/60000),at:now,status:'observational_trial_passed',evidence:'comparable_observed_windows',limits:'observational comparison, not a controlled causal experiment'};
  this.data.trials ||= {};this.data.trials[build]=trial;
  return {...trial,signature};
 }
 view(){return Object.values(this.data.contexts).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8).map(r=>({...r,expPerHour:r.elapsedMs?r.exp*3600000/r.elapsedMs:0,coinsPerHour:r.elapsedMs?r.netCoins*3600000/r.elapsedMs:0}));}
}
module.exports={ContextLearning,context,farmWindowEligible};
