'use strict';
// 401 = the panel restarted or the password changed. Every fetch from here on would
// return an error body that the page cannot tell apart from data, so it would freeze
// on stale numbers forever - bounce to the login page instead.
(() => {
  const raw = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const r = await raw(...a);
    if (r && r.status === 401) { location.replace('/'); }
    return r;
  };
})();

let reportData=null,reportBusy=false;
const reportEl=id=>document.getElementById(id);
const reportEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reportNum=v=>v==null?'—':Math.round(v).toLocaleString('th-TH');
const reportTime=ms=>(ms/60000).toFixed(1)+' นาที';
async function refreshReports(){
  if(!['reports','activity'].includes(activeView)||document.hidden||reportBusy)return;
  reportBusy=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
  try{const r=await fetch('/api/reports',{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error();reportData=await r.json();renderReports();}
  catch{for(const id of ['reportFresh','eventFresh']){reportEl(id).textContent='เชื่อมต่อไม่ได้ · ข้อมูลครั้งล่าสุด';reportEl(id).className='report-stale';}}
  finally{clearTimeout(timer);reportBusy=false;}
}
function renderReports(){
  const d=reportData,age=d.at?Math.max(0,Math.floor((Date.now()-d.at)/1000)):null;
  const freshness=!d.at?'กำลังเริ่มเก็บข้อมูลใหม่':(!d.running?'หยุดอยู่ · ':'')+'ข้อมูลล่าสุด '+age+' วินาทีที่แล้ว';
  for(const id of ['reportFresh','eventFresh']){reportEl(id).textContent=freshness;reportEl(id).className=age>20?'report-stale':'muted';}
  reportEl('reportRows').innerHTML=d.rows.map(r=>'<tr><td><b>'+reportEscape(r.name||'จอ '+r.slot)+'</b><small>จอ '+r.slot+'</small></td><td>'+reportNum(r.unknownExp?null:r.exp)+'</td><td>'+reportNum(r.expPerHour)+'<small>'+(r.unknownExp?'ข้อมูล EXP ข้ามเลเวลไม่ครบ':r.observedMs<60000?'รอข้อมูลอย่างน้อย 1 นาที':'อัตราประมาณจากเวลาที่มีเซฟ')+'</small></td><td>'+reportNum(r.coins)+'</td><td>'+reportNum(r.coinsPerHour)+'</td><td>'+r.deaths+'</td><td>'+reportTime(r.activeMs)+'</td><td>'+reportTime(r.movingMs)+'</td><td>'+reportTime(r.observedMs)+'</td></tr>').join('')||'<tr><td colspan="9" class="event-empty">ยังไม่มีข้อมูล · เริ่มสะสมตั้งแต่เปิดระบบรุ่นนี้</td></tr>';
  const picker=reportEl('eventSlot'),selected=picker.value;
  const options='<option value="all">สมาชิกทั้งหมด</option>'+d.rows.map(r=>'<option value="'+r.slot+'">'+reportEscape(r.name||'จอ '+r.slot)+'</option>').join('');
  if(picker.innerHTML!==options){picker.innerHTML=options;picker.value=[...picker.options].some(o=>o.value===selected)?selected:'all';}
  const visible=d.events.filter(e=>picker.value==='all'||String(e.slot)===picker.value).slice(0,100);
  reportEl('eventFeed').innerHTML=visible.map(e=>'<li class="event-item '+reportEscape(e.kind)+'"><time datetime="'+new Date(e.at).toISOString()+'">'+new Date(e.at).toLocaleTimeString('th-TH')+'</time><b>'+reportEscape(d.rows.find(r=>r.slot===e.slot)?.name||'จอ '+e.slot)+'</b><span>'+reportEscape(e.text)+'</span></li>').join('')||'<li class="event-empty">ยังไม่มีเหตุการณ์ในช่วงนี้ · ไม่สร้างประวัติย้อนหลังจากการคาดเดา</li>';
}
reportEl('eventSlot').addEventListener('change',()=>{if(reportData)renderReports();});
setInterval(refreshReports,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshReports();});
