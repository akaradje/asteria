'use strict';
// One durable recovery coordinator per character. Observations are read-only;
// dispatch is permitted only inside the existing instance tick scheduler.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fresh}=require('./freshness');
const intelligence=require('./recovery-intelligence');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex').slice(0,24);
const num=x=>Number.isFinite(x)?x:0;
const total=o=>Object.values(o||{}).reduce((n,x)=>n+num(x),0);
const phases=new Set(['IDLE','CONFIRMED','CANCELLED']);
function protectedOwner(i,now){
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation)return 'team';
 if(i.assistanceReservation?.expiresAt>now||i.milestonePreparationStatus?.expiresAt>now&&fresh(i.milestonePreparationStatus.lastIntentAt||i.milestonePreparationStatus.at,45000,now))return 'class-team';
 if(i.teamTradeStatus?.phase&&!phases.has(i.teamTradeStatus.phase)&&require('./team-trade').blocksNavigation(i,now))return 'trade';
 if(i.choresBusy||i.recycling||i.healthRecovery)return 'maintenance';
 if(i.v2?.trial?.active())return 'measured-experiment';
 if(require('./room-policy').roomPolicy(i.livePos?.room).dungeon)return 'dungeon';
 return null;
}
function primary(i){
 const c=i.endgameCampaign||{},s=i.lastSave||{},build=i.catalog?.().build;
 if(['class','wing','equip'].includes(c.phase))return {objective:c.phase==='equip'?'wing':c.phase,target:c.target||c.phase,requirements:c.requirements||[],ready:c.ready===true};
 if(s.lv<i.catalog?.().world?.MAX_LV)return {objective:'EXP',target:'EXP',requirements:[],ready:false};
 const d=i.developmentProgress,t=d&&typeof build==='string'&&d.build===build&&d.target;
 if(t?.id)return {objective:'equipment',target:t.id,requirements:Object.entries(t.cost||{}).map(([name,want])=>({name,want})).concat(t.missing||[]),ready:t.ready===true};
 return {objective:'equipment',target:require('../equipment-goal').policy(i.catalog?.()).dynamicProgression?'native-best-combat':'Legendary-8-refine-10',requirements:[],ready:false};
}
function measure(i){const s=i.lastSave||{},c=primary(i),names=c.requirements.map(r=>r.name),astral=i.socialInbox?.astral?.view();
 const items=i.catalog?.().items||{},equipped=Object.values(s.equip||{}).filter(Boolean),legendary=equipped.filter(id=>items[id]?.rarity==='legendary').length;
 return {saveAt:i.lastSaveAt,lv:s.lv,exp:num(s.exp),job:s.job,jobLv:s.jobLv,jobExp:num(s.jobExp),kills:total(s.bestiary),coins:num(s.coins),pet:s.petActive||null,
  quest:{version:s.qv,index:s.qIndex,have:s.qHave},equip:JSON.stringify([s.equip,s.refine,s.stage,s.holes,s.sockets,s.weaponOpts]),equipmentProgress:{legendary,refine:equipped.reduce((n,id)=>n+Math.min(i.catalog?.()?.world?.REFINE?.max??Number.MAX_SAFE_INTEGER,num(s.refine?.[id])),0),stage:equipped.reduce((n,id)=>n+num(s.stage?.[id]),0),holes:equipped.reduce((n,id)=>n+num(s.holes?.[id]),0)},wing:s.equip?.wing||null,bag:s.bag?.length??null,bagTier:s.bagTier||0,
  astral:astral?.fresh&&astral.completeness==='full'?{at:astral.receivedAt,generation:astral.generation,star:astral.state?.s,exp:astral.state?.exp,points:JSON.stringify(astral.state?.p),gate:astral.state?.gate}:null,
  resources:Object.fromEntries(names.map(n=>[n,n==='Copper'?num(s.coins):n==='Rune Dust'?num(s.runeDust):n==='Guild Token'?num(s.tokens):num(s.materials?.[n])+num(s.keyItems?.[n])])),room:i.livePos?.room||null};
}
function changes(a,b){if(!a)return [];
 const out=[];
 if(a.astral&&b.astral&&a.astral.generation===b.astral.generation&&b.astral.at>a.astral.at){
  if(b.astral.star>a.astral.star||b.astral.star===a.astral.star&&b.astral.exp>a.astral.exp)out.push('Astral-EXP');
  const sum=value=>Object.values(JSON.parse(value||'{}')).reduce((n,v)=>n+(Number.isFinite(v)&&v>0?v:0),0);if(sum(b.astral.points)>sum(a.astral.points))out.push('Astral-points');
 }
 if(b.saveAt<=a.saveAt)return out;
 if(b.lv>a.lv||b.lv===a.lv&&b.exp>a.exp)out.push('EXP');
 if(b.job!==a.job||b.jobLv>a.jobLv||b.jobLv===a.jobLv&&b.jobExp>a.jobExp)out.push('class');
 if(b.pet&&!a.pet)out.push('pet');
 if(b.wing&&b.wing!==a.wing)out.push('wing-state');
 if(a.quest&&b.quest&&a.quest.version===b.quest.version&&(Number.isSafeInteger(b.quest.index)&&Number.isSafeInteger(a.quest.index)&&b.quest.index>a.quest.index||b.quest.index===a.quest.index&&Number.isSafeInteger(b.quest.have)&&Number.isSafeInteger(a.quest.have)&&b.quest.have>a.quest.have))out.push('quest-state');
 if(b.equipmentProgress&&a.equipmentProgress&&Object.keys(b.equipmentProgress).some(k=>b.equipmentProgress[k]>a.equipmentProgress[k]))out.push('equipment-improvement');
 if(Object.keys(b.resources).some(k=>b.resources[k]>num(a.resources[k])))out.push('target-material');
 return out;
}
function goalChanges(t,a,b){
 const found=changes(a,b),allowed=t.objective==='wing'?['wing-state','target-material']:t.objective==='class'?['class','target-material']:t.objective==='EXP'?['EXP']:t.objective==='equipment'?['equipment-improvement','target-material']:t.objective==='pet'?['pet','target-material']:null;
 const selected=allowed?found.filter(k=>allowed.includes(k)):found;
 // Surplus income or an unrelated card is activity, not closing the upgrade bill.
 return selected.filter(k=>k!=='target-material'||t.requirements?.some(r=>Number.isFinite(r.want)&&r.want>0&&Math.min(num(b.resources?.[r.name]),r.want)>Math.min(num(a?.resources?.[r.name]),r.want)));

}
function task(i,now){const c=i.endgameCampaign||{},g=i.campaignGoal||i.goal||{},s=i.lastSave||{},build=i.catalog?.().build||null;
 const max=i.catalog?.().world?.MAX_LV;
 const p=primary(i),{objective,target}=p;
 const key=sha(JSON.stringify([build,objective,target]));
 const cap=i.catalog?.().world?.bagCap?.(s.bagTier||0),free=Number.isFinite(cap)&&Array.isArray(s.bag)?cap-s.bag.length:null;
 const hpPots=require('./survival').hpPots(s),ready=c.ready===true&&['class','wing'].includes(c.phase);
 const unknown=!!i.v2?.journal?.pending?.()||!!i.developmentLedger?.pending?.()||i.teamTradeStatus?.phase==='UNCERTAIN';
 const waitUntil=i.bossWindow?.departAt||g.retryAt||i.campaignRetry?.nextAt||null;
 const owner=protectedOwner(i,now);
 const nodes=[{id:'evidence',depends:[],state:fresh(i.lastSaveAt,30000,now)&&fresh(i.livePos?.at,10000,now)&&i.v2?.sourceCoherence?.matches===true?'verified':'blocked'},
  {id:'health',depends:['evidence'],state:i.livePos?.dead||num(i.vitals?.hp)<.35?'blocked':'verified'},
  {id:'supplies',depends:['health'],state:hpPots<10?'blocked':'verified'},
  {id:'space',depends:['health'],state:free===null?'unknown':free<(c.phase==='class'?2:1)?'blocked':'verified'},
  {id:'resources',depends:['supplies','space'],state:ready?'verified':'waiting'},
  {id:'execute',depends:['resources'],state:unknown?'reconcile':ready?'ready':'waiting'},
  {id:'native-result',depends:['execute'],state:'waiting'}];
 return {key,build,objective,target,requirements:p.requirements,owner,ready,free,hpPots,unknown,waitUntil,nodes,goal:g};
}
function proof(action,before,after,at){if(!before||after.saveAt<=at)return false;
 if(action==='inventory')return after.bag!==null&&before.bag!==null&&after.bag<before.bag||after.bagTier>before.bagTier;
 if(action==='supplies')return false; // Stock proof is checked separately, never coins alone.
 if(action==='travel')return after.room!==before.room;
 if(action==='reobserve')return after.saveAt>before.saveAt;
 if(action==='farm')return after.kills>before.kills||changes(before,after).length>0;
 return changes(before,after).length>0;
}
class ProgressionController{
 constructor(root,identity,{now=Date.now,adapters}={}){
  this.now=now;this.adapters=adapters;this.file=path.join(root,'logs','progression-controller',sha(identity)+'.json');
  this.data={version:1,attempts:[],events:[],outcomes:[]};this.corrupt=false;
  try{if(fs.existsSync(this.file)){const d=JSON.parse(fs.readFileSync(this.file));if(d.version!==1||!Array.isArray(d.attempts)||!Array.isArray(d.events)||!Array.isArray(d.outcomes)||d.recoveryMemory!==undefined&&(!Array.isArray(d.recoveryMemory)||d.recoveryMemory.some(r=>!r||typeof r!=='object')))throw Error('invalid state');this.data=d;}}catch{this.corrupt=true;}
 }
 persist(){if(this.corrupt)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 event(kind,extra,now){this.data.events.push({at:now,kind,...extra});this.data.events=this.data.events.slice(-40);}
 observe(i,now=this.now()){
  const t=task(i,now),m=measure(i),freshSave=fresh(i.lastSaveAt,30000,now),previous=this.data.sample;
  if(!this.data.task||this.data.task.key!==t.key){this.data.task={key:t.key,build:t.build,objective:t.objective,target:t.target,startedAt:now,lastResultAt:null,lastActivityAt:now};this.event('task-selected',{objective:t.objective,target:t.target,build:t.build},now);}
  const active=this.data.task;
  const positive=freshSave&&previous?.build===t.build&&previous.taskKey===t.key?goalChanges(t,previous,m):[];
  if(positive.length){active.lastResultAt=now;this.event('native-state-changed',{fields:positive,evidence:'observed_native_save_not_server_receipt'},now);}
  if(freshSave&&previous?.build===t.build&&m.saveAt>previous.saveAt&&m.kills>previous.kills)active.lastActivityAt=now;
  const pending=this.data.pending;
  if(pending&&freshSave&&pending.build===t.build){
   const confirmed=pending.action==='supplies'?m.saveAt>pending.at&&t.hpPots>pending.stock:pending.action==='campaign'?m.saveAt>pending.at&&(pending.objective==='class'?m.job===pending.target&&pending.before.job!==m.job:m.wing===pending.target&&pending.before.wing!==m.wing):pending.action==='travel'?m.saveAt>pending.at&&m.room===pending.mapId:proof(pending.action,pending.before,m,pending.at);
   if(confirmed){intelligence.record(this.data,pending,'observed',now);this.data.outcomes.push({at:now,build:t.build,task:pending.task,action:pending.action,elapsedMs:now-pending.at,result:'native-state-observed',causalVerified:false});this.data.outcomes=this.data.outcomes.slice(-40);this.event('recovery-observed',{action:pending.action,evidence:'native-state-observed; causality-not-proven'},now);this.data.pending=null;this.persist();}
   else if(now-pending.at>=45000){intelligence.record(this.data,pending,'unconfirmed',now);this.event('recovery-not-confirmed',{action:pending.action},now);this.data.pending=null;this.persist();}
  }else if(pending&&pending.build!==t.build){this.event('build-changed',{action:pending.action,evidence:'old-result-not-carried-forward'},now);this.data.pending=null;}
  if(freshSave&&(!previous||m.saveAt>previous.saveAt||m.astral?.at>previous.astral?.at||!previous.astral&&m.astral||previous.build!==t.build))this.data.sample={...m,build:t.build,taskKey:t.key};
  const recent=this.data.attempts.filter(r=>now>=r.at&&now-r.at<900000),last=this.data.attempts.at(-1);
  const quiet=now-(active.lastResultAt||active.startedAt),activityAge=now-active.lastActivityAt;
  let state='working',reason='ติดตามผลจากเซฟจริง',next=null;
  if(this.corrupt){state='attention';reason='ประวัติการกู้คืนอ่านไม่ได้ · ไม่สร้างประวัติใหม่ทับ';}
  else if(i.status!=='playing'||i.v2?.scheduler?.closed){state='paused';reason='เคารพการหยุดตัวละคร · ไม่เปิดเอง';}
  else if(t.nodes[0].state==='blocked'){state='waiting-evidence';reason='ข้อมูลหรือรุ่นเกมยังไม่ตรง · ใช้ระบบตรวจข้อมูลและอัปเดตเดิม';}
  else if(t.owner){state='owned';reason='งานมีผู้ควบคุม '+t.owner+' · ไม่แย่งสิทธิ์';}
  else if(this.data.pending){state='awaiting-result';reason='ส่งขั้นกู้คืนแล้ว · รอเซฟจริง ไม่ถือว่าคลิกคือสำเร็จ';}
  else if(i.livePos.dead||!fresh(i.vitals?.at,15000,now)||i.vitals.hp<.35){state='survival';reason='ความอยู่รอดและยาเป็นงานเร่ง · ใช้ตัวควบคุมความอยู่รอดเดิม';}
  else if(i.pendingTravel){state='travel';reason='ตรวจตำแหน่งและกำหนดเวลาเดินทาง';if(i.pendingTravel.until<=now||now-(i.pendingTravel.movementAt||i.pendingTravel.observedAt||now)>=45000)next='travel';}
  else if(t.hpPots<10&&i.livePos.room==='town'&&quiet>=30000){next='supplies';reason='เสบียงไม่พอ · เตรียมยาโดยยืนยันผลเดิมก่อน';}
  else if(t.free!==null&&t.free<1&&quiet>=90000){next='inventory';reason='พื้นที่รับของไม่พอ · จัดกระเป๋าด้วยกฎรักษาของทีม';}
  else if(t.ready&&i.livePos.room==='town'&&quiet>=90000&&(!t.waitUntil||now>=t.waitUntil)){next='campaign';reason='เงื่อนไขคลาส/ปีกพร้อม · เดินคิวเดิมจนตรวจผล';}
  else if(t.waitUntil>now){state='scheduled';reason='รอเวลาที่มีหลักฐาน · งานคั่นใช้แผนและเวลาเดินทางเดิม';}
  else if(i.livePos.room==='town'&&quiet>=180000){next=last?.task===t.key&&last.action==='reobserve'?'replan':'reobserve';reason='เมืองไม่มีความคืบหน้า · ตรวจใหม่แล้วจัดแผนที่ผ่านเงื่อนไข';}
  else if(i.livePos.room!=='town'&&quiet>=120000&&(activityAge>=120000||t.objective==='EXP')&&['repair_auto','reroute'].includes(i.v2?.farmWatchdog?.view()?.nextAction)){next='farm';reason='สนามไม่มีผลจริง · ใช้ watchdog เดิมเพียงชุดเดียว';}
  else if(quiet>=900000){state='watching';reason='ยังไม่มีผลเป้าหมาย · มีการต่อสู้จริง ไม่ถือว่าของสุ่มต้องดรอปตามเวลา';}
  const independentCapacity=next==='inventory'&&i.endgameCampaign?.phase==='wing'&&t.ready&&require('./storage-payment-scope').historyIndependent(i,{action:'capacity'});
  if(t.unknown&&next&&!['travel','reobserve','farm','replan'].includes(next)&&!independentCapacity){next=null;state='reconcile';reason='ผลจ่าย/เทรดไม่ชัด · รักษาการจองทรัพยากร งานอิสระยังผ่านกฎเดิมได้';}
  const cooldown=last&&now-last.at<120000,limited=recent.length>=3;
  if(next&&(cooldown||limited)){next=null;state=limited?'attention':'cooldown';reason=limited?'ครบ 3 ขั้นใน 15 นาที · ไม่วนส่งซ้ำ ใช้งานอิสระที่ผ่านการตรวจ':'รอผลและช่วงพักระหว่างขั้นกู้คืน';}
  this.state={version:1,at:now,build:t.build,taskKey:t.key,objective:t.objective,target:t.target,state,reason,owner:t.owner||'character-tick',startedAt:active.startedAt,lastResultAt:active.lastResultAt,lastActivityAt:active.lastActivityAt,quietMs:quiet,nextAction:next,nextCheckAt:now+5000,waitUntil:t.waitUntil,nodes:t.nodes,recentAttempts:recent.length,uncertainResources:t.unknown,learning:{scope:'character_and_loaded_build',routePolicy:'existing_whole_cycle_route_evidence',observedOutcomes:this.data.outcomes.length},history:this.data.events.slice(-6)};
  this.current=t;
  if(i.root&&quiet>=1800000&&!t.owner)i.progressionCodeDefect=require('../learning/progression-incidents').detect(i,quiet,now);
  if(i.root&&i.progressionCodeDefect)this.state.repairIncident=require('../learning/progression-incidents').observe(i.root,{status:i.status,owner:t.owner,quietMs:quiet,fresh:freshSave&&i.v2?.sourceCoherence?.matches===true,actorId:i.actorIdentity?.actorId,build:t.build,codeDefect:i.progressionCodeDefect},now);
  const fingerprint=intelligence.signature(i,t);
  if(next&&intelligence.failed(this.data,fingerprint,next)){
   this.state.nextAction=null;this.state.state='attention';
   this.state.reason='วิธีเดิมไม่เกิดผลสองครั้งในเงื่อนไขเดิม · ส่งหลักฐานให้ AI วิเคราะห์ รอเงื่อนไขใหม่ก่อนลองซ้ำ';
  }
  this.state.waitGraph=require('./wait-graph').forActor(i,t);
  if(this.state.waitGraph.cycles.length){this.state.incident='dependency_cycle';this.state.reason='ตรวจพบวงจรรอ · ใช้ผู้แก้เพียงชุดเดียวและรักษารายการที่ส่งแล้ว';
   const remedy=this.state.waitGraph.cycles.find(c=>c.remedy.action==='cancel_uncommitted_and_replan'&&c.remedy.node==='trade-result');
   if(remedy&&!this.corrupt&&freshSave&&t.nodes[0].state==='verified'&&(!t.owner||t.owner==='trade')&&!this.data.pending&&!cooldown&&!limited&&i.status==='playing'&&!intelligence.failed(this.data,fingerprint,'resolve-soft-cycle'))this.state.nextAction='resolve-soft-cycle';}
  this.state.recovery=intelligence.view(this.data,t,this.state,fingerprint,now,i);
  if(!this.lastPersistAt||now-this.lastPersistAt>=30000||positive.length){this.persist();this.lastPersistAt=now;}
  return this.state;
 }
 async tick(i,screen){
  const now=this.now(),scheduler=i.v2?.scheduler,owner=scheduler?.context.getStore();
  if(!owner||owner.kind!=='tick'||scheduler.closed)return null;
  scheduler.checkpoint();const view=this.observe(i,now),action=view.nextAction;
  if(!action||screen?.death||screen?.panelOpen||protectedOwner(i,now)&&(action!=='resolve-soft-cycle'||protectedOwner(i,now)!=='trade')||this.corrupt)return null;
  // Reserve before await/dispatch. Restart preserves the attempt and pending proof.
  const t=this.current,before=measure(i),entry={at:now,task:t.key,build:t.build,action,fingerprint:intelligence.signature(i,t)};
  this.data.attempts.push(entry);this.data.attempts=this.data.attempts.slice(-60);
  this.data.pending={...entry,before,stock:t.hpPots,objective:t.objective,target:t.target,mapId:i.pendingTravel?.mapId};this.event('recovery-started',{action},now);this.persist();
  try{
   scheduler.checkpoint();const adapters=this.adapters||require('./progression-actions');
   const result=await adapters.run(action,i,screen,t);
   scheduler.checkpoint();this.observe(i,this.now());
   return result? 'progression controller: '+result:null;
  }catch(e){this.event('recovery-interrupted',{action,evidence:'no-success-claim; native-journals-preserved'},this.now());this.persist();throw e;}
 }
 view(){return this.state||null;}
}
module.exports={ProgressionController,primary,measure,changes,goalChanges,task,protectedOwner,proof};
