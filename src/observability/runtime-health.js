'use strict';
const {fresh}=require('../runtime/freshness');
function diagnose(i,now=Date.now()){
 const age=at=>Number.isFinite(at)&&at>0&&at<=now?now-at:null;
 const saveAgeMs=age(i.lastSaveAt),positionAgeMs=age(i.livePos?.at),fpsAgeMs=age(i.lastFpsAt),o=i.v2?.observation;
 const probes=Object.fromEntries(Object.entries(i.healthProbes||{}).map(([k,p])=>[k,{...p,ageMs:p.state==='running'?age(p.startedAt):null,overdue:p.state==='running'&&now-p.startedAt>=20000}]));
 const resource=i.resourceHealth;
 const base={at:now,saveAgeMs,positionAgeMs,fpsAgeMs,probes,resource:resource?{at:resource.at,mode:resource.mode,tickMs:resource.tickMs,reason:resource.reason}:null,recoveryEligible:false,evidence:'native_save_position_and_read_only_session_observation'};
 const result=(state,reason)=>({...base,state,reason});
 if(i.recycling||i.healthRecovery)return result('recovering','กำลังกู้เฉพาะตัวนี้');
 if(i.status!=='playing')return result('connecting','ยังไม่เข้าโลกเกม');
 if(i.choresBusy||i.teamControl||o?.paused&&fresh(o.at,15000,now))return result('owned_activity','งานอุปกรณ์ เทรด หรือกิจกรรมกำลังควบคุมตัวละคร');
 if(fresh(o?.at,15000,now)&&(o.kicked||o.connected===false))return result('disconnected','ข้อมูลสดยืนยันการเชื่อมต่อขาด · รอตัวกู้คืนเดิมตรวจเซฟและงานค้าง');
 if(!fresh(i.lastSaveAt,30000,now))return result(fresh(i.livePos?.at,10000,now)?'save_delayed':'checking',fresh(i.livePos?.at,10000,now)?'ตำแหน่งยังสด แต่เซฟล่าช้า · ยังไม่ยืนยันว่าหลุด':'เซฟหรือตำแหน่งไม่สด · รอหลักฐานก่อนกู้คืน');
 if(o?.nativeBotConsole===true&&fresh(o.at,15000,now))return result('working','โหมดข้อความ native · วัดเซฟ/ตำแหน่ง/ผลฟาร์มแทน render FPS');
 if(!fresh(i.lastFpsAt,15000,now))return result('telemetry_late','เซฟยังสด แต่ยังไม่มี FPS สด · ไม่รีสตาร์ทจากค่าเก่า');
 if(Number.isFinite(i.lastFps)&&i.lastFps<15)return result('low_fps','FPS สดต่ำกว่า 15 · ตรวจต้นทุนรายจอ');
 return result('working',i.pendingTravel?'เดินทางอยู่ · เซฟและ FPS ยังสด':'เซฟและ FPS สด');
}
class HealthRound{
 constructor(farm,{now=Date.now,registryPulse=i=>require('../registry/worker').pulse(i)}={}){this.farm=farm;this.cursor=0;this.now=now;this.registryPulse=registryPulse;this.flights=new WeakMap();}
 launch(i,kind,fn){let flights=this.flights.get(i);if(!flights){flights=new Map();this.flights.set(i,flights);}if(flights.has(kind))return;
  const startedAt=this.now();i.healthProbes||={};i.healthProbes[kind]={state:'running',startedAt};
  const job=Promise.resolve().then(()=>{if(this.farm.stopping||i.status!=='playing'||i.recycling||i.healthRecovery)return;return fn();});flights.set(kind,job);
  job.then(()=>{i.healthProbes[kind]={state:'completed',startedAt,at:this.now()};},()=>{i.healthProbes[kind]={state:'failed',startedAt,at:this.now(),reason:'probe_failed_retry_next_round'};if(!i.healthProbeErrorAt||this.now()-i.healthProbeErrorAt>=30000){i.healthProbeErrorAt=this.now();this.farm.log('health probe '+kind+' failed; retrying bounded round','warn');}}).finally(()=>flights.delete(kind));
 }
 pulse(){if(this.farm.stopping)return;const rows=this.farm.instances.filter(Boolean);if(!rows.length)return;const i=rows[this.cursor++%rows.length];if(i.status!=='playing'||i.recycling||i.healthRecovery)return;
  // Slow registry transport cannot delay native observation. Both lanes retain
  // their in-flight owner until settlement; an overdue promise is never replayed.
  this.launch(i,'registry',()=>this.registryPulse(i));this.launch(i,'observation',()=>i.observeContinuity?.());
 }
}
module.exports={diagnose,HealthRound};
