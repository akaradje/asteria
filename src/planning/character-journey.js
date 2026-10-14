'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),economy=require('../economy');
const fresh=(at,ms,now)=>Number.isFinite(at)&&now-at>=0&&now-at<ms;
function rankingGaps(rankings,now=Date.now()){
 return Object.entries(rankings?.categories||{}).map(([category,r])=>{
  const valid=r?.fresh&&fresh(r.receivedAt,360000,now),tenth=r?.leaders?.find(p=>p.pos===10),me=r?.me;
  return {category,at:r?.receivedAt||null,fresh:!!valid,position:valid?me?.pos??null:null,targetPosition:10,targetValue:valid?tenth?.v??null:null,gap:valid&&Number.isFinite(tenth?.v)&&Number.isFinite(me?.v)?Math.max(0,tenth.v-me.v):null,inTop10:!!(valid&&me?.pos>0&&me.pos<=10),reason:!valid?'รออันดับสดจากเซิร์ฟเวอร์':!tenth?'ไม่มีข้อมูลอันดับ 10':me?.pos<=10?'อยู่ Top 10 ตามรอบที่รายงาน':'เปรียบเทียบเฉพาะคะแนนหมวดเดียวกัน ไม่ใช้เป็น DPS'};
 });
}
function plan(i,now=Date.now()){
 const s=i.lastSave||{},valid=fresh(i.lastSaveAt,30000,now);
 if(!valid||!Number.isFinite(s.lv)||typeof i.catalog!=='function')return {version:1,at:now,saveAt:i.lastSaveAt||null,build:null,fresh:false,state:'waiting',reason:'รอเซฟตัวละครและแค็ตตาล็อกสด',steps:[],slotQueue:[],rankings:[],verified:[],complete:false};
 const cat=i.catalog(),p=i.developmentProgress,profile=i.personalBrain,goal=require('../equipment-goal').assess(s,cat),growth=require('./endgame').assess(s,cat,economy.loadWiki(i.root));
 const milestones=require('./progression-priority').assess(s,cat);
 const ledger=(i.developmentLedger?.view()||[]).filter(r=>['pending','unresolved'].includes(r.status));
 const slotQueue=(goal?.rows||[]).filter(r=>!r.complete).map(r=>({...r,priority:!r.id?0:!r.rarityMet?1:2,blockedReason:!milestones.equipmentAllowed?milestones.reason:!r.id?'ต้องหาไอเทมที่ใช้ได้และมีแหล่งจริง':!r.rarityMet?'เปลี่ยนเป็น Legendary ก่อน แล้วตรวจการสวมจริง':!r.ruleVerified?'รอตรวจเพดานตีบวกของรุ่นเกม':r.refineSupported?'ตีบวกหนึ่งครั้งแล้วตรวจผล':'รอตรวจ capability ตีบวก'})).sort((a,b)=>a.priority-b.priority);
 const steps=[
  {id:'survival',label:'อยู่รอดและเสบียง',state:i.survivalRecovery||i.survivalStatus?.until>now?'recovering':require('../runtime/survival').hpPots(s)<(growth.capped?20:10)?'supplies':'ready',detail:i.goal?.kind==='survival'?i.goal.reason:'ตรวจ HP ยา และผลตายก่อนเลือกแหล่ง'},
  {id:'class',label:'คลาส',state:growth.nextClass?growth.promotionMissing.length?'requirements':'ready':'complete',target:growth.nextClass,missing:growth.promotionMissing},
  {id:'gear',label:'Legendary +10',state:!milestones.equipmentAllowed?'blocked':goal?.complete?'complete':'developing',detail:milestones.reason,emptySlots:slotQueue.filter(r=>!r.id).map(r=>r.slot),legendary:goal?goal.legendaryEquipped+'/'+goal.legendaryTarget:null,refine10:goal?goal.refine10Equipped+'/'+goal.refine10Target:null},
  {id:'wing',label:'ปีก Legendary',state:i.endgameCampaign?.phase==='wing'?'gathering':goal?.rows.find(r=>r.slot==='wing')?.rarityMet?'equipped':'requirements',target:i.endgameCampaign?.phase==='wing'?i.endgameCampaign.target:milestones.wingId||null,current:milestones.wingId||null,detail:'ปีกแรกคือความพร้อมขั้นต่ำ เป้าหมายคือ Legendary ที่สวมจริง; ตีบวกตาม native capability'},
  {id:'quest',label:'เควสหลัก',state:i.mainQuest?.status||'waiting',target:i.mainQuest?.title||null,detail:i.mainQuest?.reason||'รอเซฟเวอร์ชันเควสและแผนปลอดภัย'},
  {id:'pet',label:'สัตว์เลี้ยง',state:milestones.pet?'active':'waiting',target:milestones.pet?s.petActive:i.activePetPlan?.selected?.name||null,detail:'สถานะใช้งานยืนยันจากเซฟจริง; เลือกตามบทบาทจากตัวที่มีจริงและตรวจความพร้อมก่อนหาตัวหายาก'},
  {id:'team',label:'แบ่งของสองปาร์ตี้',state:i.teamTradeStatus?.phase||'planning',detail:i.teamWorkboard?.reason||'รอข้อมูลสด; งานส่วนตัวเดินต่อเมื่อเครื่องอื่นปิด'},
  {id:'guild',label:'กิจกรรมกิลด์ / หอคอย',state:i.activityAutomationPaused!==false?'paused':'enabled',detail:'เคารพปุ่มพัก/ระดมพลเดิม ไม่เปิดรอบอัตโนมัติโดยแผนส่วนตัว'}
 ];
 steps.sort((a,b)=>{const order=['survival','pet','class','wing','gear','quest','team','guild'];return order.indexOf(a.id)-order.indexOf(b.id);});
 return {milestones,version:1,at:now,saveAt:i.lastSaveAt||null,build:cat.build,fresh:valid,state:!valid?'waiting':ledger.length?'verify':p?.stage||'planning',current:i.goal?.label||p?.current||'รอเป้าหมาย',reason:!valid?'ข้อมูลเก่า ห้ามจ่ายเงินหรือเปลี่ยนแผน':ledger.length?'รายการเดิมยังไม่ทราบผล ห้ามส่งซ้ำ':p?.reason||profile?.progression?.reason||growth.reason,target:p?.target?{id:p.target.id,name:p.target.name,ready:p.target.ready,missing:p.target.missing}:null,slotQueue,steps,rankings:rankingGaps(i.serverRankings?.view(now),now),learning:i.v2?.farmEvidence?.view()||null,pending:ledger.map(r=>({kind:r.kind,status:r.status,target:r.target,at:r.at})).slice(0,6),verified:i.journeyMemory?.events?.filter(r=>r.build===cat.build).slice(-8)||[],evidence:'outgoing_native_save_changes_not_server_reward_receipts',complete:false};
}
function fingerprint(s,cat){return {lv:s.lv,job:s.job,jobLv:s.jobLv,equip:{...s.equip},refine:{...s.refine},stage:{...s.stage},qv:s.qv,qIndex:s.qIndex,pet:s.petActive||null,score:require('../gear-value').totals(s,cat).score};}
class JourneyMemory{
 constructor(root,name){this.file=path.join(root,'logs/character-journey',crypto.createHash('sha256').update(String(name)).digest('hex').slice(0,24)+'.json');this.previous=null;this.events=[];try{this.events=JSON.parse(fs.readFileSync(this.file)).events||[];}catch{}}
 observe(i,now=Date.now()){
  if(!fresh(i.lastSaveAt,30000,now))return;const build=i.catalog().build,s=i.lastSave,current={build,saveAt:i.lastSaveAt,...fingerprint(s,i.catalog())},prev=this.previous;if(prev?.saveAt===current.saveAt)return;this.previous=current;
  if(!prev||prev.build!==build)return;
  const changes=[];for(const key of ['lv','job','jobLv','pet'])if(prev[key]!==current[key])changes.push({kind:key,before:prev[key]??null,after:current[key]??null});
  if(prev.qv===current.qv&&Number.isInteger(current.qIndex)&&current.qIndex>prev.qIndex)changes.push({kind:'quest_transition',before:prev.qIndex,after:current.qIndex});
  for(const slot of require('../equipment-goal').slots||['weapon','offhand','head','armor','boots','wing','acc1','acc2']){const id=current.equip[slot];if(prev.equip[slot]!==id)changes.push({kind:'equip',slot,before:prev.equip[slot]||null,after:id||null});else if(id)for(const kind of ['refine','stage'])if((current[kind][id]||0)!==(prev[kind][id]||0))changes.push({kind,id,before:prev[kind][id]||0,after:current[kind][id]||0});}
  if(!changes.length)return;this.events.push({at:current.saveAt,build,changes,estimatedScoreBefore:prev.score,estimatedScoreAfter:current.score,evidence:'outgoing_native_save_change_not_measured_dps'});this.events=this.events.slice(-80);fs.mkdirSync(path.dirname(this.file),{recursive:true});require('../runtime/telemetry-file').writeTelemetry(this.file,{version:1,events:this.events});
 }
}
module.exports={plan,rankingGaps,JourneyMemory};
