'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const stable=require('./context-learning').context;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fresh=(at,age,now)=>Number.isFinite(at)&&now>=at&&now-at<=age;
function role(job,world={}){const chain=require('../economy').jobChain(job,world);return chain.includes('priest')?'support':chain.includes('knight')?'tank':'dps';}
function loadout(save){const p=save.premiumRulesInput?.state;return digest([stable('combat-v1',save),save.lv,save.petOpts,save.astral?{s:save.astral.s,p:save.astral.p}:null,save.guildRunesInput,p?{worn:p.worn,book:p.book,boost:p.boost?{on:p.boost.on,pct:p.boost.pct}:null}:null,Object.entries(save.itemBuffs||{}).filter(([,b])=>b?.t>0).map(([k,b])=>[k,b.amt,b.fx,b.el]).sort((a,b)=>a[0].localeCompare(b[0]))]);}
function scope(i,now=Date.now()){
 // Native saves omit cached guild/premium projections. Normalize a copy from
 // the same generation's fresh PowerState so every save does not split a build.
 const s=i.lastSave&&typeof i.socialInbox?.power?.enrich==='function'?i.socialInbox.power.enrich(i,{...i.lastSave},now):i.lastSave,p=i.livePos,build=i.catalog?.()?.build;
 if(!s||!build||!i.actorIdentity?.actorId||!i.actorOwner?.session||!i.socialInbox?.generation||!i.v2?.loadedSourceIdentity?.signature||i.status!=='playing'||i.v2?.sourceCoherence?.matches!==true||i.socialInbox?.criticalGap||i.v2?.observation?.paused||i.v2?.observation?.fixed||i.v2?.observation?.kicked||!fresh(i.lastSaveAt,30000,now)||!fresh(p?.at,10000,now)||!fresh(i.vitals?.at,15000,now)||p.room==='town'||require('../runtime/room-policy').roomPolicy(p.room).lab||/^(pv|p\d)/.test(p.room)||i.recycling||i.healthRecovery||i.pendingTravel||i.choresBusy||i.socialInbox?.buildLab?.session?.active)return null;
 const party=i.socialInbox?.last?.('party'),partyAt=party?._sessionBound?require('../runtime/party-evidence').observedAt(party,now):null;
 if(party?.id&&partyAt===null)return null;
 const roster=party?.id?(party.members||[]).map(m=>[m.id,m.job,m.lv]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))):[];
 const target=i.goal?.monsterId||null;if(!target)return null;
 return {telemetryVersion:2,combatDomain:require('../observability/combat-domain').classify(p.room),actorId:i.actorIdentity.actorId,build,sourceSignature:i.v2.loadedSourceIdentity?.signature||null,session:i.actorOwner.session,generation:i.socialInbox.generation,job:s.job,level:s.lv,role:role(s.job,i.catalog().world),map:p.room,target,party:digest([party?.id||null,roster]),hasParty:!!party?.id,loadoutSignature:loadout(s),equip:{...s.equip},petActive:s.petActive||null};
}
function metrics(r){
 const sec=r.observedMs/1000,enough=require('./combat-windows').microReady(r),scaled=require('../observability/combat-domain').classify(r.map)==='scaled_instance';
 const ratio=r.referenceDamage>0?r.referenceTaken/r.referenceDamage:null,reference=!scaled&&r.referenceHits>=10&&ratio>0&&ratio<=1;
 const party=require('./party-combat-evidence').view(r);
 return {...r,deaths:Math.max(r.deaths||0,r.serverDeaths||0),selfBuffUptime:r.buffObservedMs>0?Object.fromEntries(Object.entries(r.buffMs||{}).map(([k,ms])=>[k,ms/r.buffObservedMs])):null,
 ready:enough,comparisonReady:r.samples>=10&&r.observedMs>=300000,microWindowThresholdMs:120000,combatDomain:scaled?'scaled_instance':'field',
 dps:enough&&r.damageFrames>0?r.damage/sec:null,damageTakenPerSecond:enough&&r.takenFrames>0?r.damageTaken/sec:null,killsPerHour:enough&&r.saveIntervals>0?r.kills*3600000/r.observedMs:null,
 ttkMs:r.ttk.length>=10?r.ttk.reduce((n,x)=>n+x,0)/r.ttk.length:null,potionsPerMinute:enough&&r.saveIntervals>0?r.potions*60000/r.observedMs:null,
 supportRecipientsPerMinute:enough&&r.supportFrames>0?r.recipients*60000/r.observedMs:null,ehp:null,ehpReference:reference&&r.maxHp>0?r.maxHp/ratio:null,mitigationReference:reference?1-ratio:null,mitigationSamples:scaled?0:r.referenceHits||0,
 referenceUnavailableReason:scaled?'unverified_instance_scaling':ratio>1?'reference_not_pre_mitigation_roll':null,
 observedDamagePerHit:require('../observability/combat-domain').distribution(r.damageTakenSamples),hpLossPerSecond:enough&&r.phpIntervals>0?(r.hpLoss||0)/sec:null,
 survivalTimeMs:r.observedMs,deathFreeExposureMs:Math.max(r.deaths||0,r.serverDeaths||0)===0?r.observedMs:null,serverPotionsPerMinute:enough&&r.serverPotions>0?r.serverPotions*60/sec:null,
 soloSustainTelemetry:require('./solo-sustain-evidence').view(r),partySupportTelemetry:party,partySupport:party,healUptime:null,buffUptime:null,
 limits:['TTK is first observed own hit to native death; party kills are not solo DPS','Scaled instances use damage distribution and HP drain; base ATK is never a scaling formula','Micro readiness is observation only; policy comparison still needs five active minutes and nonoverlapping matched cycles'],causalVerified:false,authority:'server_combat_frames_and_native_save_intervals'};
}
class CombatEvidence{
 constructor(root,actorId){this.actorId=actorId;this.file=root&&path.join(root,'logs/combat-evidence',digest(actorId).slice(0,24)+'.json');this.data={version:1,actorId,windows:[]};this.previous=null;this.monsters=new Map();if(this.file)try{if(fs.statSync(this.file).size>8000000)throw Error('bounded history');const d=JSON.parse(fs.readFileSync(this.file));if(d.version!==1||d.actorId!==actorId||!Array.isArray(d.windows)||d.windows.length>512||d.windows.some(r=>!r||r.actorId!==actorId||!Array.isArray(r.ttk)||r.ttk.length>128||!Number.isFinite(r.at)||!Number.isFinite(r.observedMs)))throw Error('identity');this.data=d;}catch(e){if(e.code!=='ENOENT')this.storageBlocked=true;}}
 row(i,now){const c=scope(i,now);if(!c||c.actorId!==this.actorId||this.storageBlocked)return null;const signature=digest(c);let r=this.data.windows.at(-1);if(!r||r.signature!==signature||now-r.startedAt>=360000||now-r.at>15000){r={...c,id:crypto.randomUUID(),signature,startedAt:now,at:now,observedMs:0,samples:0,damage:0,damageFrames:0,damageTaken:0,takenFrames:0,healReceived:0,recipients:0,supportFrames:0,potions:0,kills:0,deaths:0,saveIntervals:0,ttk:[]};this.data.windows.push(r);this.data.windows=this.data.windows.filter(x=>fresh(x.at,86400000,now)).slice(-512);this.monsters.clear();}return r;}
 observe(i,now=Date.now()){const r=this.row(i,now);if(!r){this.previous=null;this.monsters.clear();return;}const s=i.lastSave,p=this.previous,kills=s.bestiary?.[r.target],pots=require('../runtime/survival').hpPots(s),sample={id:r.id,at:now,saveAt:i.lastSaveAt,kills,pots,dead:!!i.livePos.dead,buffs:Array.isArray(i.v2?.observation?.buffKeys)&&fresh(i.v2.observation.at,15000,now)?i.v2.observation.buffKeys:null};this.previous=sample;if(p&&p.id===r.id&&now>p.at&&now-p.at<=15000){r.observedMs+=now-p.at;r.samples++;require('./party-combat-evidence').observe(i,r,p.at,now);require('./solo-sustain-evidence').observe(i,r,p.at,now);if(fresh(i.vitals?.at,15000,now)&&i.vitals.maxHp>0)r.maxHp=i.vitals.maxHp;if(p.buffs&&sample.buffs){r.buffObservedMs=(r.buffObservedMs||0)+now-p.at;r.buffMs||={};for(const key of p.buffs)if(sample.buffs.includes(key))r.buffMs[key]=(r.buffMs[key]||0)+now-p.at;if(JSON.stringify(p.buffs)!==JSON.stringify(sample.buffs))r.confounded=true;}if(sample.dead&&!p.dead)r.deaths++;if(sample.saveAt>p.saveAt&&Number.isFinite(kills)&&Number.isFinite(p.kills)&&kills>=p.kills){r.kills+=kills-p.kills;r.potions+=Math.max(0,p.pots-pots);r.saveIntervals++;}}r.at=now;if(now-(this.writtenAt||0)>=60000||sample.dead)this.persist(now);}
 frame(i,m,owner,now=Date.now()){
  const r=this.row(i,now);if(!r)return;
  const hit=(n,d)=>{if(!Number.isFinite(n)||!Number.isFinite(d)||d<=0)return;r.damage+=d;r.damageFrames++;const t=this.monsters.get(n);if(t&&t.id===r.target&&t.row===r.id)t.firstHit??=now;};
  if(m.t==='mons'&&m.room===r.map&&Array.isArray(m.list)){this.monsters.clear();for(const s of m.list.slice(0,2000))if(Number.isFinite(s.n))this.monsters.set(s.n,{id:s.id,row:r.id,atk:s.ak});}
  if(m.t==='mspawn'&&m.r===r.map&&Number.isFinite(m.m?.n))this.monsters.set(m.m.n,{id:m.m.id,row:r.id,atk:m.m.ak});
  // hres is private to the receiving connection. Never add dmgs/outgoing hits to it.
  if(m.t==='hres'&&Array.isArray(m.l))for(const x of m.l.slice(0,80))if(Array.isArray(x))hit(x[0],x[1]);
  if(m.t==='phit'&&Number.isFinite(m.d)&&m.d>0){r.damageTaken+=m.d;r.takenFrames++;const t=this.monsters.get(m.n),mon=(i.catalog().world.MONSTERS||[]).find(x=>x.id===t?.id),atk=require('../observability/combat-domain').reference(r.map,mon,t);r.damageTakenSamples||=[];r.damageTakenSamples.push(m.d);r.damageTakenSamples=r.damageTakenSamples.slice(-512);if(!m.k&&t?.row===r.id&&Number.isFinite(atk)&&atk>0){r.referenceDamage=(r.referenceDamage||0)+atk;r.referenceTaken=(r.referenceTaken||0)+m.d;r.referenceHits=(r.referenceHits||0)+1;}}
  if(m.t==='php'&&Number.isFinite(m.hp)&&m.hp>=0){if(this.previousHp?.row===r.id&&now-this.previousHp.at<=15000){r.hpLoss=(r.hpLoss||0)+Math.max(0,this.previousHp.hp-m.hp);r.phpIntervals=(r.phpIntervals||0)+1;}this.previousHp={row:r.id,at:now,hp:m.hp};}
  if(m.t==='puse'&&(m.ok===true||m.ok===1)&&Number.isSafeInteger(m.ps)&&m.ps>(this.potionSequence||0)){this.potionSequence=m.ps;if(['Red Potion','Orange Potion','Yellow Potion','White Potion'].includes(m.n))r.serverPotions=(r.serverPotions||0)+1;}
  if(m.t==='pdie'&&!this.deathSeen){r.serverDeaths=(r.serverDeaths||0)+1;this.deathSeen=true;}
  if(m.t==='php'&&m.dead===false&&m.hp>0)this.deathSeen=false;
  if(m.t==='pheal'&&Number.isFinite(m.n)&&m.n>0)r.healReceived+=m.n;
  if(m.t==='psupok'&&Number.isSafeInteger(m.n)&&m.n>0&&m.n<=6){r.recipients+=m.n;r.supportFrames++;}
  if(['mdie','mgone','kill'].includes(m.t)){const t=this.monsters.get(m.n);if(m.t!=='mgone'&&t?.row===r.id&&t.firstHit!==undefined&&now>t.firstHit&&now-t.firstHit<=300000)r.ttk.push(now-t.firstHit);this.monsters.delete(m.n);r.ttk=r.ttk.slice(-128);}
 }
 view(i,now=Date.now()){
  const c=scope(i,now);if(!c)return {at:now,ready:false,current:null,windows:[],aggregates:[],reason:'fresh_exact_combat_context_required'};
  const signature=digest(c),raw=this.data.windows.filter(r=>fresh(r.at,86400000,now)&&r.actorId===c.actorId&&r.build===c.build&&r.sourceSignature===c.sourceSignature),windows=raw.map(metrics),aggregates=require('./combat-windows').aggregate(raw,{now}).map(metrics),current=windows.filter(r=>r.signature===signature).at(-1)||null;
  return {at:now,scope:c,ready:!!current?.ready||aggregates.some(r=>r.ready&&require('./combat-windows').key(r)===require('./combat-windows').key(c)),current,windows,aggregates,readyWindows:windows.filter(r=>r.ready).length,comparisonWindows:aggregates.filter(r=>r.comparisonReady).length,storageBlocked:!!this.storageBlocked};
 }
 persist(now){if(!this.file||this.storageBlocked)return;try{fs.mkdirSync(path.dirname(this.file),{recursive:true});const result=require('../runtime/telemetry-file').writeTelemetry(this.file,this.data);if(result.ok)this.writtenAt=now;}catch{this.storageBlocked=true;}}
}
function ensure(i){if(!i.actorIdentity?.actorId)return null;if(i.combatEvidence?.actorId!==i.actorIdentity.actorId)i.combatEvidence=new CombatEvidence(i.actorStateRoot||i.root,i.actorIdentity.actorId);return i.combatEvidence;}
module.exports={CombatEvidence,ensure,scope,loadout,role,metrics,digest};
