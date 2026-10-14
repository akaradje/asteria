'use strict';
class ResourcePressure{
 constructor(){this.low=0;this.good=0;this.lastAt=0;this.lastHostAt=null;this.mode='normal';}
 observe(i,now=Date.now(),hostPressure=0){
  const o=i.v2?.observation,native=o?.nativeBotConsole===true&&Number.isFinite(o.at)&&o.at<=now&&now-o.at<15000;
  const fpsFresh=Number.isFinite(i.lastFpsAt)&&i.lastFpsAt<=now&&now-i.lastFpsAt<15000&&Number.isFinite(i.lastFps)&&i.lastFps>=0;
  const fpsNew=!native&&fpsFresh&&i.lastFpsAt>this.lastAt;
  const hostNew=this.lastHostAt===null||now-this.lastHostAt>=5000;
  if(!fpsNew&&!hostNew)return null;
  if(fpsNew)this.lastAt=i.lastFpsAt;
  if(hostNew)this.lastHostAt=now;
  const before=this.mode;
  // Host pressure already has hysteresis. Missing FPS must not prevent load
  // shedding, or falsely prove recovery from a previously reduced state.
  if(hostPressure>=2){this.mode='reduced';this.good=0;}
  else if(fpsNew||native&&hostNew){
   const low=!native&&i.lastFps<20;
   this.low=low?Math.min(6,this.low+1):0;this.good=low?0:this.good+1;
   if(this.low>=3)this.mode='reduced';
   else if(this.good>=6||this.mode!=='reduced')this.mode=native?'native-console':'normal';
  }
  const protectedRoom=/^(tw|dx|gd|pv)/.test(i.livePos?.room||'');
  const profile={mode:this.mode,at:now,fps:native||!fpsFresh?null:i.lastFps,fpsAt:fpsFresh?i.lastFpsAt:null,fpsApplicable:!native,hostPressure,targetFps:this.mode==='reduced'?Math.min(i.targetFps||30,20):i.targetFps||30,sceneSyncMs:this.mode==='reduced'?1000:Math.max(250,Math.min(1000,i.sceneSyncMs||250)),tickMs:protectedRoom?5000:this.mode==='reduced'?8000:5000,
   reason:hostPressure>=2?'ภาระเครื่องสูง · ลดงานเสริมและคงการตรวจสุขภาพ':this.mode==='reduced'?'ลดงานเสริมต่อจนมีหลักฐานฟื้นตัวครบ':native?'โหมดข้อความ · ใช้เวลาตอบสนองและผลจริง':fpsFresh?'ข้อมูล FPS สด · คงความถี่ปกติ':'FPS ไม่สด · คงระดับงานเดิมและตรวจข้อมูลต่อ'};
  i.resourceHealth=profile;i.adaptiveTickMs=profile.tickMs;
  return !native&&(before!==this.mode||!i.resourceProfileApplied)?profile:null;
 }
}
module.exports={ResourcePressure};
