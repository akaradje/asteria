(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AdaptiveModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 // Shadow only. No game/controller imports, callbacks, or mutation authority.
 function assess(rows,context,now){
  const ranked=(Array.isArray(rows)?rows:[]).map(r=>{
   const reasons=[];
   if(!context||r.context!==context)reasons.push('บริบทไม่ตรงหรือยังไม่ทราบ');
   if(!finite(r.at)||r.at>now||now-r.at>60000)reasons.push('หลักฐานเก่าหรือเวลาไม่ถูกต้อง');
   if(r.coherent!==true)reasons.push('ยังไม่ยืนยันรุ่นที่โหลด');
   if(r.pending!==false)reasons.push('ธุรกรรมยังไม่ชัดเจน');
   if(r.safe!==true)reasons.push('ยังไม่ผ่านการตรวจความปลอดภัย');
   if(!finite(r.ms)||r.ms<300000||!finite(r.samples)||r.samples<10)reasons.push('เวลาหรือตัวอย่างไม่พอ');
   if(!finite(r.knownMs)||r.knownMs<0||r.knownMs>r.ms||r.knownMs/r.ms<.9)reasons.push('ข้อมูลครอบคลุมไม่พอ');
   if(r.deaths!==0||r.expLossEvents!==0)reasons.push('มีการตาย/เสีย EXP หรือยังไม่ทราบ');
   if(!finite(r.netExp)||r.netExp<=0)reasons.push('EXP สุทธิไม่เป็นบวก');
   return {id:r.id,eligible:reasons.length===0,reasons,rate:reasons.length?null:r.netExp*3600000/r.ms};
  }).sort((a,b)=>(b.rate??-Infinity)-(a.rate??-Infinity));
  const eligible=ranked.filter(r=>r.eligible);
  return {mode:'shadow',authorizesActions:false,ranked,suggestion:eligible.length>1?eligible[0].id:null,reason:eligible.length>1?'คะแนนรวมเวลาในตัวเลือกที่ผ่าน; ยังต้องทดลองยืนยัน':'หลักฐานตัวเลือกที่เปรียบเทียบได้ยังไม่พอ'};
 }
 return {assess};
});
