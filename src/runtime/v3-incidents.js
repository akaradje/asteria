'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fresh}=require('./freshness');
function diagnose(i,now=Date.now()){
 const issues=[],add=(id,reason,owner,deadlineMs,remedy)=>issues.push({id,reason,owner,deadlineMs,remedy});
 if(!fresh(i.lastSaveAt,30000,now))add('save_stale','ข้อมูลเซฟไม่สด ห้ามใช้ตัดสินใจจ่ายหรือเปลี่ยนเป้าหมาย','session',60000,'ตรวจ native saver และหลักฐานการเชื่อมต่อก่อนกู้คืน');
 if(!fresh(i.livePos?.at,10000,now))add('position_stale','ข้อมูลตำแหน่งไม่สด ไม่ถือว่าเป็นการหลุด','telemetry',30000,'เก็บตำแหน่งใหม่จาก observer เดิม');
 if(i.v2?.sourceCoherence?.matches===false)add('source_changed','build/source ที่โหลดไม่ตรง หลักฐานเก่าใช้อนุมัติไม่ได้','version',60000,'ใช้ client-refresh เดิมและทวน capability รายหมวด');
 const native=i.v2?.observation?.nativeBotConsole===true&&fresh(i.v2.observation.at,15000,now);
 if(!native&&fresh(i.lastFpsAt,15000,now)&&i.lastFps<20)add('low_fps','FPS ต่ำจากตัวอย่างสด ลดงานเสริมก่อนทดลองใหม่','resource',60000,'พักการวิเคราะห์หนักและเพิ่มช่วงเก็บ CDP');
 if(fresh(i.resourceHealth?.at,15000,now)&&i.resourceHealth.mode==='reduced')add('resource_pressure','ลดภาระอัตโนมัติระหว่างรอหลักฐานฟื้นตัว','resource',60000,'เว้นงานเสริม รักษางานหลักและ observer รอผลสดก่อนคืนความถี่');
 for(const key of ['registry','observation']){const p=i.healthProbes?.[key];if(p?.state==='running'&&now-p.startedAt>=20000)add('probe_'+key,'ตัวตรวจ '+key+' ตอบช้า งานตรวจอีกช่องทางยังเดินต่อ','telemetry',30000,'รอคำขอเดิมปิด ไม่เริ่มคำขอซ้อนหรือรีสตาร์ทจาก timeout อย่างเดียว');}
 if(i.v2?.journal?.pending()||i.developmentLedger?.blocking?.('craft'))add('transaction_uncertain','มีรายการใช้ทรัพยากรที่ยังไม่ทราบผล ห้ามส่งซ้ำ','transaction',30000,'reconcile save/receipt เดิม รักษารายการจอง');
 const svc=i.townServiceStatus;
 if(svc?.state==='deferred'&&fresh(svc.at,90000,now))add('npc_'+String(svc.key||'service').replace(/[^\w-]/g,'_'),'การเข้าถึง NPC ไม่สำเร็จภายในเวลาที่จำกัด','supply',60000,'ตรวจตำแหน่งและ panel ก่อนลองใหม่ตาม backoff');
 if(i.survivalRecovery)add('hp_recovery','กำลังพักฟื้น HP งานหลักต้องรอความพร้อมจริง','survival',120000,'ฟื้น HP/เสบียง ใช้เส้นทางปลอดภัยที่มีประวัติฆ่า');
 if(fresh(i.lastSaveAt,30000,now)&&i.lastSave?.lv&&require('./survival').hpPots(i.lastSave)<10)add('hp_supply','ยา HP ต่ำกว่าเสบียงขั้นต่ำ','supply',120000,'เติมยาโดย journal เดิมหรือหาเงินจากพื้นที่ที่ผ่านหลักฐาน');
 if(i.livePos?.room==='town'&&i.trainingRouteStatus?.routeEvidence?.townMs>=300000)add('town_duty','เวลาทั้งรอบสูญเสียในเมืองอย่างน้อย5นาที','supply',120000,'ตรวจยา/NPC/รายการค้าง แก้คอขวดก่อนทดลองมอน');
 return issues;
}
function cleared(id,i,now){
 if(id==='low_fps')return i.v2?.observation?.nativeBotConsole===true&&fresh(i.v2.observation.at,15000,now)||fresh(i.lastFpsAt,15000,now)&&Number.isFinite(i.lastFps)&&i.lastFps>=20;
 if(id==='resource_pressure')return fresh(i.resourceHealth?.at,15000,now)&&['normal','native-console'].includes(i.resourceHealth.mode);
 if(id.startsWith('probe_')){const p=i.healthProbes?.[id.slice(6)];return p?.state==='completed'&&fresh(p.at,15000,now);}
 if(id==='source_changed')return i.v2?.sourceCoherence?.matches===true;
 return true;
}
class IncidentBook{
 constructor(root,name,{now=Date.now}={}){this.now=now;this.file=path.join(root,'logs','v3-incidents',crypto.createHash('sha256').update(String(name)).digest('hex').slice(0,24)+'.json');const state=require('./preserved-history').read(this.file,x=>x.rows);this.rows=state.rows;this.corrupt=state.corrupt;this.originalSha256=state.originalSha256;this.writtenAt=0;}
 observe(i,now=this.now()){
  if(this.corrupt)return this.view();
  const issues=diagnose(i,now),ids=new Set(issues.map(d=>d.id));let changed=false;
  for(const r of this.rows)if(r.status==='open'&&!ids.has(r.id)&&cleared(r.id,i,now)){r.status='resolved';r.resolvedAt=now;r.evidence='fresh_observer_condition_cleared_not_game_milestone';changed=true;}
  for(const d of issues){let r=this.rows.find(r=>r.id===d.id&&r.status==='open');if(!r){r={...d,at:now,deadline:now+d.deadlineMs,status:'open',samples:0};this.rows.unshift(r);changed=true;}r.samples++;r.lastSeenAt=now;r.overdue=now>=r.deadline;r.nextCheckAt=now+Math.min(30000,d.deadlineMs);}
  this.rows=[...this.rows.filter(r=>r.status==='open'),...this.rows.filter(r=>r.status!=='open').slice(0,80)];
  if(changed||now-this.writtenAt>=60000){fs.mkdirSync(path.dirname(this.file),{recursive:true});require('./telemetry-file').writeTelemetry(this.file,{version:3,rows:this.rows});this.writtenAt=now;}
  return this.view();
 }
 view(){return {open:this.corrupt?[{id:'incident_history_corrupt',reason:'ประวัติ incident เสียรูปแบบ เก็บต้นฉบับแล้ว',owner:'persistence',remedy:'ตรวจต้นฉบับก่อนกู้ประวัติ ห้ามอ้างว่า incident เก่าหายแล้ว',originalSha256:this.originalSha256}]:this.rows.filter(r=>r.status==='open'),recent:this.rows.filter(r=>r.status!=='open').slice(0,6),automaticRestart:false,historyQuarantined:!!this.corrupt};}
}
module.exports={diagnose,IncidentBook};
