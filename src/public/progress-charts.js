'use strict';
window.ProgressCharts=(()=>{
 const cache=new Map(),settings=new Map();
 const metrics={exp:['EXP ที่ได้','EXP'],coins:['เงินสุทธิ','Copper'],reportedDamage:['ดาเมจที่ไคลเอนต์ส่ง (ยังไม่ใช่ผลรับรองจากเซิร์ฟเวอร์)','ดาเมจ'],reportedDps:['ดาเมจที่ส่งต่อเวลาสังเกต','ดาเมจ / วินาที'],damage:['ดาเมจในเฟรมเซิร์ฟเวอร์ที่รับได้ (อาจไม่ครบ)' ,'ดาเมจ'],dps:['DPS เฉลี่ยต่อเวลาที่เชื่อมต่อ','ดาเมจ / วินาที'],hpLossObserved:['HP ลดสุทธิจาก save (ยังแยกสาเหตุไม่ได้)','HP'],hpRecoveryObserved:['HP เพิ่มสุทธิจาก save (รวมยาและฟื้นตัว)','HP'],damageTakenServer:['ดาเมจที่ได้รับใน PvP จากเซิร์ฟเวอร์','ดาเมจ'],healReceivedServer:['ฮีลที่ได้รับใน PvP จากเซิร์ฟเวอร์','HP'],healOfferedReceived:['ฮีลปาร์ตี้ที่ส่งมา (ก่อนจำกัด HP สูงสุด)','HP'],supportRecipients:['จำนวนผู้รับสกิลที่เซิร์ฟเวอร์ตอบ','คน'],lowMpMs:['เวลาที่ MP ต่ำกว่า 10%','มิลลิวินาที'],kills:['จำนวนฆ่าที่เกมบันทึก','ตัว'],deaths:['การตาย','ครั้ง'],lv:['เลเวล','Lv']};
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>Number.isFinite(v)?v.toLocaleString('th-TH',{maximumFractionDigits:1}):'—';
 const short=v=>new Intl.NumberFormat('th-TH',{notation:'compact',maximumFractionDigits:1}).format(v);
 const time=at=>new Date(at).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'});
 function series(points,metric){
  // Keep one point per minute. Bounded 24h history; gaps are never filled with zero.
  return points.map(p=>({at:p.at,value:Number.isFinite(p[metric])?p[metric]:null,build:p.build}));
 }
 function plot(points,metric,hours,now,color,name){
  const data=series(points,metric),valid=data.filter(p=>p.value!==null);
  if(!valid.length)return '<div class="chart-empty">ยังไม่มีข้อมูล '+escape(metrics[metric][0])+' ในช่วงนี้</div>';
  let lo=Math.min(0,...valid.map(p=>p.value)),hi=Math.max(0,...valid.map(p=>p.value));
  if(metric==='lv')lo=Math.min(...valid.map(p=>p.value))-1;
  if(hi===lo)hi=lo+1;
  const from=Math.min(now-60000,Math.max(now-hours*3600000,valid[0].at)),x=at=>60+(at-from)/(now-from)*490,y=v=>175-(v-lo)/(hi-lo)*135;
  let path='',previous=null;
  for(const p of data){if(p.value===null){previous=null;continue;}const linked=previous&&p.at-previous.at<=90000&&p.build===previous.build;path+=(linked?' L ':' M ')+x(p.at).toFixed(1)+' '+y(p.value).toFixed(1);previous=p;}
  const dots=valid.map(p=>'<circle cx="'+x(p.at).toFixed(1)+'" cy="'+y(p.value).toFixed(1)+'" r="2.3"><title>'+escape(time(p.at)+' · '+num(p.value)+' '+metrics[metric][1])+'</title></circle>').join('');
  return '<svg class="progress-svg" viewBox="0 0 600 220" role="img" aria-label="'+escape(name+' '+metrics[metric][0])+'"><title>'+escape(name+' '+metrics[metric][0])+'</title>'+[lo,(lo+hi)/2,hi].map(v=>'<line x1="60" x2="550" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="53" y="'+(y(v)+4)+'" text-anchor="end">'+escape(short(v))+'</text>').join('')+'<text x="60" y="205">'+time(from)+'</text><text x="550" y="205" text-anchor="end">'+time(now)+'</text><path d="'+path+'" fill="none" stroke="'+color+'" stroke-width="2.5"/><g fill="'+color+'">'+dots+'</g></svg>';
 }
 const sum=(points,k)=>{const known=points.filter(p=>Number.isFinite(p[k]));return known.length?known.reduce((n,p)=>n+p[k],0):null;};
 function render(report,machine){
  cache.set(machine,report);const prefs=settings.get(machine)||{metric:'exp',hours:1},now=Date.now(),from=now-prefs.hours*3600000;
  const rows=report.series?.length?report.series:(report.rows||[]).map(r=>({...r,points:[]}));
  const options=Object.entries(metrics).map(([key,[label]])=>'<option value="'+key+'" '+(prefs.metric===key?'selected':'')+'>'+label+'</option>').join('');
  const cards=rows.map((r,index)=>{
   const points=(r.points||[]).filter(p=>p.at>=from&&p.at<=now),damage=sum(points,'damage'),exp=sum(points,'exp'),coins=sum(points,'coins'),kills=sum(points,'kills'),deaths=sum(points,'deaths');
   const seconds=points.reduce((n,p)=>n+(p.damageObservedMs||0),0)/1000,dps=seconds>=1&&damage!==null?damage/seconds:null;
   const latest=[...points].reverse().find(p=>Number.isFinite(p.lv));
   const unknown=points.some(p=>p.unknownExp>0),color=['#73dfb7','#8bbaff','#ffd184'][index%3];
   return '<article class="progress-card"><div class="progress-heading"><h3>'+escape(r.name||'จอ '+r.slot)+'</h3><span class="badge">Lv '+num(latest?.lv)+'</span></div><div class="progress-totals">'+[['EXP ที่ทราบ',exp],['เงินสุทธิ',coins],['ฆ่าที่บันทึก',kills],['ตาย',deaths],['ดาเมจรวม',damage],['DPS เฉลี่ย',dps]].map(([label,value])=>'<div><small>'+label+'</small><b>'+num(value)+'</b></div>').join('')+'</div><h4>'+escape(metrics[prefs.metric][0])+(prefs.metric==='lv'||prefs.metric==='dps'?'':' · ต่อช่วงบันทึกหนึ่งนาที')+'</h4>'+plot(points,prefs.metric,prefs.hours,now,color,r.name)+'<p class="subtle">'+(points.length?'มีข้อมูล '+time(points[0].at)+'–'+time(points.at(-1).at)+' · '+points.length+' ช่วงบันทึก':'รอเริ่มเก็บข้อมูล')+(unknown?' · บางช่วงไม่ทราบ EXP ข้ามเลเวล':'')+'</p><p class="subtle">'+(r.combatTrackingSince?'ดาเมจเริ่มวัด '+time(r.combatTrackingSince)+' · เฉพาะผู้โจมตีตรงกับตัวละครนี้ · เซิร์ฟเวอร์อาจไม่ส่งการโจมตีของตัวเองกลับ ห้ามรวมกับดาเมจที่ส่ง':'ดาเมจยังไม่เริ่มวัด · ไม่สร้างข้อมูลย้อนหลัง')+'</p></article>';
  }).join('');
  return '<div class="progress-section" data-progress-machine="'+escape(machine)+'"><div class="progress-toolbar"><div><h3>กราฟความคืบหน้ารายตัว</h3><small>ช่องว่าง = ไม่มีข้อมูล · เงินสุทธิหักค่าใช้จ่าย · วางเมาส์บนจุดเพื่อดูค่า</small></div><label>สถิติ <select data-progress-metric>'+options+'</select></label><label>ช่วงเวลา <select data-progress-hours>'+[1,6,24].map(h=>'<option value="'+h+'" '+(prefs.hours===h?'selected':'')+'>'+h+' ชั่วโมง</option>').join('')+'</select></label></div><div class="progress-grid">'+(cards||'<p>รอข้อมูลตัวละครจากเครื่องนี้</p>')+'</div></div>';
 }
 document.addEventListener('change',event=>{const el=event.target,section=el.closest('[data-progress-machine]');if(!section||!el.matches('[data-progress-metric],[data-progress-hours]'))return;const machine=section.dataset.progressMachine,prefs={metric:section.querySelector('[data-progress-metric]').value,hours:Number(section.querySelector('[data-progress-hours]').value)};settings.set(machine,prefs);section.outerHTML=render(cache.get(machine),machine);});
 return {render,series};
})();
