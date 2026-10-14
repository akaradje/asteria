'use strict';
const terminal=new Set(['IDLE','COMPLETE','FINISHED','WITHDRAWN']);
function dailyWorkPolicy(view,intent,build,now=Date.now()){
 const interim=reason=>({mode:'interim',ownsNavigation:false,reserve:false,reason,at:now});
 if(!intent||terminal.has(intent.phase))return interim(view?.reason||'รอข้อมูลกิจกรรม ระหว่างนี้ทำงานพัฒนาต่อ');
 if(intent.phase==='UNCERTAIN')return {mode:'reconcile',ownsNavigation:false,reserve:false,reason:'ตรวจผลรอบเดิมก่อนเปิดรอบใหม่ ไม่ส่งคำสั่งเปิดซ้ำ',at:now};
 if(!['GATHERING','PREPARING','OPENING','JOINING','RUNNING','RECONCILING','WITHDRAWING'].includes(intent.phase))return interim('ยังไม่รู้สถานะงานทีม รอคำสั่งที่ตรวจสอบได้');
 if(intent.build!==build)return interim('กิจกรรมเป็นเกมคนละรุ่น รอแผนที่ตรงกับเครื่องนี้');
 if(!Number.isFinite(intent.at)||now-intent.at< -5000||now-intent.at>=15000||!Number.isFinite(intent.deadline)||intent.deadline<=now)return interim('คำสั่งทีมหมดอายุ รอข้อมูลใหม่ระหว่างทำงานส่วนตัว');
 return {mode:'activity',ownsNavigation:true,reserve:['GATHERING','PREPARING'].includes(intent.phase),workflowId:intent.id,phase:intent.phase,until:intent.deadline,reason:'ทำกิจกรรมที่ทีมรับแล้ว · '+intent.phase,at:now};
}
module.exports={dailyWorkPolicy};
