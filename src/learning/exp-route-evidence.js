'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {delta}=require('../observability/level-progress');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,24);
const key=g=>g?.mapId&&g?.monsterId?g.mapId+':'+g.monsterId:null;
const fresh=(at,limit,now)=>Number.isFinite(at)&&at<=now&&now-at<=limit;
// The target is a separate route key. Native filter changes and temporary town
// healing settings must not erase a probe's travel/refill costs. All offensive
// settings, gear, skills, pet tiers, level band and EXP buffs remain isolated.
function routeContext(build,s){const c=JSON.parse(require('./context-learning').context(build,s));c[0]='exp-route-v2';c[15]={...c[15]};delete c[15].potPct;delete c[15].ph;c[16]=null;return JSON.stringify(c);}
function owned(i){const intent=i.teamTradeIntent,name=i.character?.name||i.credentials?.charName,trade=intent?.offer&&[intent.offer.donor,intent.offer.receiver].includes(name)&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(intent.phase);return !!(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.pvpMission||trade||i.tradeJournal?.sessionId&&!['CONFIRMED','CANCELLED'].includes(i.tradeJournal.phase)||i.v2?.trial?.active()&&i.v2.trial.active().purpose!=='route');}
function phase(i,g){const p=i.livePos;if(p.dead||i.survivalRecovery||i.healthRecovery)return 'recovery';if(p.room==='town')return 'town';if(i.pendingTravel||p.room!==g.mapId)return 'travel';const targets=i.lastSave.autoTargets;return !i.choresBusy&&!i.recycling&&Array.isArray(targets)&&targets.length===1&&targets[0]===g.monsterId?'field':'unconfirmed';}
function potCount(s){return require('./farm-evidence').pots(s)+['Blue Potion','Sapphire Potion','Starlight Potion'].reduce((n,k)=>n+(s.consumables?.[k]||0),0);}
class ExpRouteEvidence{
 constructor(root,name,{now=Date.now}={}){this.now=now;this.file=path.join(root,'logs/exp-route-evidence',hash(String(name))+'.json');this.previous=null;this.origin=null;this.writtenAt=0;try{const d=JSON.parse(fs.readFileSync(this.file));this.rows=d.version===1?d.rows||{}:{};}catch{this.rows={};}}
 interrupt(){this.previous=null;this.origin=null;}
 observe(i,build){
  const now=this.now(),s=i.lastSave,p=i.livePos;
  if(!build||!s||i.v2?.sourceCoherence?.matches!==true||owned(i)||!fresh(i.lastSaveAt,30000,now)||!fresh(p?.at,10000,now)||require('../runtime/room-policy').roomPolicy(p?.room).dungeon||require('../runtime/room-policy').isGuildHall(p?.room)||!Number.isFinite(s.exp)){this.interrupt();return;}
  let g=i.goal;
  if(['exp','survival'].includes(g?.kind)&&g.monsterKind==='normal'&&key(g))this.origin={mapId:g.mapId,monsterId:g.monsterId};
  // A town/refill/death detour is charged to the EXP route that required it.
  else if(this.origin&&(p.room==='town'||i.survivalRecovery||i.healthRecovery||i.pendingTravel))g={...this.origin};
  else {this.interrupt();return;}
  if(!key(g)){this.interrupt();return;}
  const signature=routeContext(build,s),id=hash(JSON.stringify([signature,key(g)])),at=i.lastSaveAt;
  if(this.previous?.saveAt===at)return;
  const sample={saveAt:at,id,lv:s.lv,exp:s.exp,kills:s.bestiary?.[g.monsterId]||0,pots:potCount(s),dead:!!p.dead,phase:phase(i,g)};
  const before=this.previous;this.previous=sample;
  if(!before||before.id!==id||at<=before.saveAt)return;
  const ms=at-before.saveAt;if(ms>600000){this.interrupt();return;}
  const amount=delta(before,sample,i.catalog().world?.expToNext),known=ms<=30000&&amount!==null&&sample.kills>=before.kills;
  const field=known&&before.phase==='field'&&sample.phase==='field';
  // Positive EXP requires the exclusive native target and a native kill delta;
  // quest/reward/town EXP is never credited to a monster. EXP losses still cost.
  const exp=known&&(amount<0||field&&sample.kills>before.kills)?amount:0;
  const r=this.rows[id]||={signature,build,route:key(g),map:g.mapId,monster:g.monsterId,intervals:[]};
  // One time interval owns one category, including transition intervals. Old
  // category-overlap rows remain archived but cannot support revised decisions.
  const phases=[before.phase,sample.phase],costPhase=field?'field':['recovery','travel','town'].find(x=>phases.includes(x))||'unconfirmed';
  r.at=at;r.intervals.push({at,ms,knownMs:known?ms:0,exp,fieldMs:known&&costPhase==='field'?ms:0,townMs:known&&costPhase==='town'?ms:0,travelMs:known&&costPhase==='travel'?ms:0,recoveryMs:known&&costPhase==='recovery'?ms:0,unconfirmedMs:known&&costPhase==='unconfirmed'?ms:0,potionsUsed:known?Math.max(0,before.pots-sample.pots):0,deaths:known?Number(sample.dead&&!before.dead):0,expLossEvents:known?Number(amount<0):0,refills:known?Number(sample.pots>before.pots):0});
  r.intervals=r.intervals.filter(x=>fresh(x.at,3600000,now)).slice(-720);
  this.rows=Object.fromEntries(Object.entries(this.rows).filter(([,v])=>fresh(v.at,86400000,now)).sort((a,b)=>b[1].at-a[1].at).slice(0,80));
  if(sample.dead||now-this.writtenAt>=60000)this.persist(now);
 }
 matching(s,build,g){const sig=routeContext(build,s);return this.rows[hash(JSON.stringify([sig,key(g)]))];}
 summarize(r,{since=0,now=this.now()}={}){
  const rows=(r?.intervals||[]).filter(x=>x.at>since&&x.at-x.ms>=since&&fresh(x.at,3600000,now));if(!rows.length)return null;
  const sum=k=>rows.reduce((n,x)=>n+(x[k]||0),0),ms=sum('ms'),known=sum('knownMs'),exp=sum('exp'),enough=rows.length>=10&&ms>=300000&&known/ms>=.9;
  return {at:r.at,route:r.route,samples:rows.length,ms,knownMs:known,coveragePct:Math.round(known*100/ms),netExp:exp,expPerHour:enough?Math.round(exp*3600000/ms):null,fieldMs:sum('fieldMs'),fieldPct:Math.round(sum('fieldMs')*100/ms),unknownMs:ms-known,signature:r.signature,townMs:sum('townMs'),travelMs:sum('travelMs'),recoveryMs:sum('recoveryMs'),unconfirmedMs:sum('unconfirmedMs'),potionsUsed:sum('potionsUsed'),deaths:sum('deaths'),expLossEvents:sum('expLossEvents'),refills:sum('refills'),confidence:enough?'observational':'collecting',evidence:'native_save_net_exp_per_observed_route_wall_time',serverVerified:false,causalVerified:false};
 }
 decorate(rows,s,build){return rows.map(g=>({...g,routeEvidence:this.summarize(this.matching(s,build,g))}));}
 window(s,build,g,since){return this.summarize(this.matching(s,build,g),{since});}
 persist(now=this.now()){fs.mkdirSync(path.dirname(this.file),{recursive:true});const r=require('../runtime/telemetry-file').writeTelemetry(this.file,{version:1,rows:this.rows});if(r.ok)this.writtenAt=now;}
}
module.exports={ExpRouteEvidence,routeContext,key,owned};
