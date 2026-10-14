'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {context,farmWindowEligible}=require('./context-learning');
const {delta}=require('../observability/level-progress');
const fresh=(at,ms,now)=>Number.isFinite(at)&&at<=now&&now-at<ms;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,24);
function pots(s){return (s.potions||0)+['Orange Potion','Yellow Potion','White Potion'].reduce((n,k)=>n+(s.consumables?.[k]||0),0);}
function eligible(i,now){return farmWindowEligible(i,now)&&i.v2?.sourceCoherence?.matches!==false&&!i.v2?.trial?.active()&&!!i.goal?.monsterId&&i.goal.mapId===i.livePos.room;}
// Only contiguous saves for the exact target/build/loadout count. Net inventory
// changes are not gross drops, shop spending, server receipts or causal proof.
class FarmEvidence{
 constructor(root,name,{now=Date.now}={}){this.now=now;this.file=path.join(root,'logs/farm-evidence',hash(String(name))+'.json');this.previous=null;this.writtenAt=0;try{const saved=JSON.parse(fs.readFileSync(this.file));this.rows=saved.rows||{};this.writtenAt=saved.persistedAt||0;}catch{this.rows={};}}
 interrupt(){this.previous=null;}
 observe(i,build){
  const now=this.now(),s=i.lastSave,g=i.goal,p=i.livePos;
  if(!build||!eligible(i,now)||!fresh(i.lastSaveAt,30000,now)||!fresh(p?.at,10000,now)||!Number.isFinite(s.exp)||!Number.isFinite(s.coins)){this.interrupt();return;}
  if(this.previous?.saveAt===i.lastSaveAt)return;
  const signature=context(build,s),key=hash(JSON.stringify([signature,g.mapId,g.monsterId]));
  const sample={at:now,saveAt:i.lastSaveAt,key,lv:s.lv,exp:s.exp,kills:s.bestiary?.[g.monsterId]||0,coins:s.coins,pots:pots(s),materials:{...s.materials},cards:{...s.cards},dead:!!p.dead};
  const prev=this.previous;this.previous=sample;
  if(!prev||prev.key!==key||now<=prev.at||now-prev.at>30000)return;
  const exp=delta(prev,sample,i.catalog().world?.expToNext),kills=sample.kills-prev.kills;
  // A death's negative EXP is a real cost, not a reason to erase the death.
  if(exp===null||kills<0||sample.pots>prev.pots){this.interrupt();return;}
  const row=this.rows[key]||={build,signature,map:g.mapId,monster:g.monsterId,samples:0,ms:0,exp:0,kills:0,netCoins:0,potionsUsed:0,deaths:0,netMaterials:{},quietMs:0};
  row.samples++;row.ms+=now-prev.at;row.exp+=exp;row.kills+=kills;row.netCoins+=sample.coins-prev.coins;row.potionsUsed+=prev.pots-sample.pots;row.deaths+=Number(sample.dead&&!prev.dead);row.at=now;
  for(const name of new Set([...Object.keys(prev.materials),...Object.keys(sample.materials)])){const n=(sample.materials[name]||0)-(prev.materials[name]||0);if(n)row.netMaterials[name]=(row.netMaterials[name]||0)+n;}
  row.netCards||={};for(const id of new Set([...Object.keys(prev.cards||{}),...Object.keys(sample.cards)])){const n=(sample.cards[id]||0)-(prev.cards?.[id]||0);if(n)row.netCards[id]=(row.netCards[id]||0)+n;}
  row.quietMs=kills>0||exp>0?0:row.quietMs+now-prev.at;
  if(sample.dead||row.quietMs>=180000){row.cooldownUntil=now+600000;row.reason=sample.dead?'เป้าหมายนี้มีหลักฐานเสียชีวิต':'ไม่มี EXP หรือจำนวนฆ่าเพิ่มต่อเนื่อง 3 นาที';}
  this.rows=Object.fromEntries(Object.entries(this.rows).filter(([,r])=>now-r.at>=0&&now-r.at<86400000).sort((a,b)=>b[1].at-a[1].at).slice(0,300));
  if(sample.dead||row.quietMs>=180000||now-this.writtenAt>=60000)this.persist(now);
 }
 persist(now=this.now()){fs.mkdirSync(path.dirname(this.file),{recursive:true});const result=require('../runtime/telemetry-file').writeTelemetry(this.file,{version:1,persistedAt:now,rows:this.rows});if(result.ok)this.writtenAt=now;}
 matching(s,build,g){const now=this.now(),signature=context(build,s);return Object.values(this.rows).find(r=>r.build===build&&r.signature===signature&&r.map===g.mapId&&r.monster===g.monsterId&&fresh(r.at,86400000,now));}
 rank(candidates,s,build){
  const now=this.now();
  const rows=candidates.map(g=>{
   const r=this.matching(s,build,g),enough=r?.samples>=10&&r.ms>=300000;
   const yieldRate=enough?(g.kind==='income'?r.netCoins:g.material?r.netMaterials[g.material]||0:r.exp)*3600000/r.ms:null;
   const multiplier=enough?Math.max(.5,Math.min(1.2,1+(yieldRate>0?.1:-.2)-Math.min(.4,r.deaths*.2)-Math.min(.15,r.potionsUsed/Math.max(1,r.kills)*.1))):1;
   return {...g,planningScore:g.score||0,score:(g.score||0)*multiplier,farmEvidence:r?{at:r.at,samples:r.samples,minutes:Math.round(r.ms/60000),expPerHour:enough?Math.round(r.exp*3600000/r.ms):null,netCoinsPerHour:enough?Math.round(r.netCoins*3600000/r.ms):null,potionsPerHour:enough?Math.round(r.potionsUsed*3600000/r.ms):null,deaths:r.deaths,cooldownUntil:r.cooldownUntil||null,multiplier,confidence:enough?'observational':'collecting',reason:r.reason||null}:null};
  }).filter(g=>!(g.farmEvidence?.cooldownUntil>now));
  // Compare actual yield only within the same purpose and resource. An EXP
  // rate must never outrank a reserved class material or a higher-priority job.
  const groups=new Map();for(const g of rows){const key=JSON.stringify([g.kind,g.material||null,g.priority??0]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(g);}
  for(const group of groups.values()){
   const measured=group.filter(g=>g.farmEvidence?.confidence==='observational');if(measured.length<2)continue;
   const rate=g=>g.kind==='income'?g.farmEvidence.netCoinsPerHour:g.material?(this.matching(s,build,g)?.netMaterials?.[g.material]||0)*3600000/(this.matching(s,build,g)?.ms||1):g.farmEvidence.expPerHour;
   const bestRate=Math.max(...measured.map(rate));if(!(bestRate>0))continue;
   const scale=Math.max(1,...group.map(g=>g.score||0));
   for(const g of measured){g.score=scale*Math.max(0,rate(g))/bestRate*Math.max(.5,1-Math.min(.4,g.farmEvidence.deaths*.2));g.farmEvidence.ranking='comparable_measured_net_yield';}
  }
  return rows.sort((a,b)=>(a.priority??0)-(b.priority??0)||b.score-a.score);
 }
 view({save,build}={}){const now=this.now(),recent=Object.values(this.rows).filter(r=>fresh(r.at,86400000,now)),compatible=save&&build?recent.filter(r=>r.build===build&&r.signature===context(build,save)):[];return {at:now,memory:{retainedTargets:recent.length,compatibleTargets:compatible.length,readyTargets:compatible.filter(r=>r.samples>=10&&r.ms>=300000&&!(r.cooldownUntil>now)).length,persistedAt:this.writtenAt||null,storage:'local_disk',reuse:'exact_build_loadout_target_only'},method:'exact_build_loadout_target_contiguous_save_windows',serverVerified:false,causalVerified:false,rows:Object.values(this.rows).filter(r=>fresh(r.at,86400000,now)).sort((a,b)=>b.at-a.at).slice(0,6).map(r=>({build:r.build,map:r.map,monster:r.monster,at:r.at,samples:r.samples,minutes:Math.round(r.ms/60000),expPerHour:r.ms>=300000?Math.round(r.exp*3600000/r.ms):null,netCoinsPerHour:r.ms>=300000?Math.round(r.netCoins*3600000/r.ms):null,potionsUsed:r.potionsUsed,deaths:r.deaths,netMaterials:r.netMaterials,netCards:r.netCards||{},cooldownUntil:r.cooldownUntil||null,reason:r.reason||null})),limits:'Field yield only; travel/town time remains in levelProgress. Material deltas are net inventory, not gross drops.'};}
}
module.exports={FarmEvidence,eligible,pots};
