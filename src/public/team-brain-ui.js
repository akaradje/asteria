'use strict';
function renderRuntimeV2(d,panel){
 if(!d.runtimeV2?.enabled)return;
 const section=document.createElement('section'),esc=reportEscape,k=d.gameKnowledge;
 section.innerHTML=(d.fleet?.expected?'<h2>ทีมข้ามเครื่อง 3+3</h2><p>ออนไลน์ '+esc(d.fleet.online)+'/6 · หัวหน้าทีม '+esc(d.fleet.leader)+' · '+esc(d.fleet.complete?'ยืนยันปาร์ตี้ครบ 6 คน':'กำลังรวมทีม/ข้อมูลยังไม่ครบ')+'</p>'+d.fleet.members.map(m=>'<p>'+esc(m.machine)+' · '+esc(m.charName)+' · '+esc(m.baseJob)+' · Lv '+esc(m.lv||'?')+' · '+esc(m.status)+'</p>').join(''):'')+'<h2>การเล่นและแผนพัฒนาตัวละคร</h2><p>เกม '+esc(k?.liveBuild||'รอข้อมูล')+' · '+(k?.updatePending?'มีอัปเดตรอโหลด':'ตรวจเวอร์ชันล่าสุดแล้ว')+'</p>'+d.members.map(m=>{
  const v=m.runtimeV2;if(!v)return '<p>'+esc(m.name)+' · รอข้อมูลตัวควบคุม</p>';
  return '<details class="event-item" data-slot="v2-'+m.slot+'"><summary>'+esc(m.name)+' · '+esc(v.phase)+' · '+esc(v.scheduler?.active?.kind||'ไม่มีงานค้าง')+'</summary><p>เงื่อนไขลงทุน: '+esc(v.capabilityStatus?.reason||'ยังไม่ได้ตรวจคำสั่งลงทุน')+'</p><h3>อุปกรณ์เป้าหมายตามบทบาท</h3>'+((v.objective?.targets||[]).map(t=>'<p>'+esc(t.slot)+' · '+esc(t.name)+' · Lv '+esc(t.reqLv)+'</p>').join('')||'<p>รอข้อมูลอุปกรณ์</p>')+'<p>เป้าหมายจากคะแนนตาราง ยังไม่ใช่ผลทดสอบชุดที่ดีที่สุด</p><h3>ผลซื้อยา</h3>'+((v.purchases||[]).map(r=>'<p>'+esc(r.target?.item)+' · '+esc(r.status)+' · '+esc(r.evidence)+'</p>').join('')||'<p>ไม่มีคำสั่งซื้อที่ต้องตรวจ</p>')+'<h3>บทเรียนตามบริบท</h3>'+((v.contexts||[]).map(r=>'<p>'+esc(r.map)+' · '+esc(r.build)+' · '+esc(r.confidence)+' · EXP/h '+Math.round(r.expPerHour||0).toLocaleString('th-TH')+'</p>').join('')||'<p>กำลังสะสมข้อมูล</p>')+'</details>';
 }).join('');panel.append(section);
}
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

let teamBrainBusy=false,teamBrainData=null,teamChatFingerprint='';
const teamEl=id=>document.getElementById(id);
const memberLabel={joined:'เข้าร่วมแล้ว',missing:'ยังไม่อยู่ในรายชื่อ',unknown:'รอยืนยันจากเซิร์ฟเวอร์'};
async function refreshTeamBrain(){
 if(teamBrainBusy||document.hidden||location.hash!=='#reports')return;
 teamBrainBusy=true;try{const r=await fetch('/api/team-brain',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();teamBrainData=await r.json();renderTeamBrain();}catch{teamEl('teamBrainFresh').textContent='ติดต่อไม่ได้ · ข้อมูลครั้งก่อน';}finally{teamBrainBusy=false;}
}
function renderTeamBrain(){
 const d=teamBrainData,esc=reportEscape;
 renderDevelopment(d);
 renderAutonomy(d);
 const t=d.tower;
 teamEl('teamTowerStatus').textContent=t ? (t.reason||t.readiness||'รอข้อมูลหอคอยรอบใหม่')+(t.leader?' · หัวหน้า '+t.leader:'')+(t.joined?' · ยืนยันเข้า '+t.joined.length+'/'+d.members.length:'')+(t.missing?.length?' · รอ '+t.missing.join(', '):'')+(t.deadline&&t.phase==='joining'?' · เหลือ '+Math.max(0,Math.ceil((t.deadline-Date.now())/1000))+' วินาที':'')+(t.run?.floor?' · ชั้น '+t.run.floor:'') : 'รอข้อมูลล่าสุดจากทีม';
 teamEl('teamTowerQuota').textContent=(t?.quotas||[]).map(q=>q.name+' '+(q.left??'?')+'/'+(q.runs??'?')+' รอบ').join(' · ');
 teamEl('teamBrainFresh').textContent=(d.running?'กำลังเล่น':'หยุดอยู่')+' · '+(d.at?new Date(d.at).toLocaleTimeString('th-TH'):'รอข้อมูล');
 const count=k=>d.members.filter(m=>m[k]==='joined').length;
 teamEl('teamMembershipSummary').textContent='ปาร์ตี้ '+count('party')+'/'+d.members.length+' · หัวหน้า '+(d.party.leader||'ยังไม่ยืนยัน')+' | กิลด์ '+(d.guild.name||'ยังไม่ยืนยัน')+' '+count('guild')+'/'+d.members.length+(d.guild.complete?' · ยืนยันครบทีม':' · ยังยืนยันไม่ครบ');
 teamEl('teamBrainRows').innerHTML=d.members.map(m=>{const p=m.personalBrain,s=p?.strategy;return '<tr><td><b>'+esc(m.name)+'</b><small>จอ '+m.slot+' · '+esc(p?.role||'รอข้อมูลคลาส')+'</small></td><td>'+esc(m.gameStatus)+'</td><td>'+memberLabel[m.party]+'</td><td>'+memberLabel[m.guild]+'</td><td>'+esc(s&&s.until>Date.now()?(aiActions[s.action]||s.action):'สมองเกมเลือกตามความพร้อม')+'<small>'+esc(m.goal?.label||'รอเป้าหมาย')+'</small><small>'+esc(s?.reason||'')+'</small></td></tr>';}).join('');
 const picker=teamEl('teamChatSlot');if(picker.options.length!==d.members.length+1){const value=picker.value;picker.innerHTML='<option value="all">ทั้งทีม</option>'+d.members.map(m=>'<option value="'+m.slot+'">'+esc(m.name)+'</option>').join('');picker.value=value;}
 const visible=d.messages.filter(m=>picker.value==='all'||(m.from+' '+m.to).includes('จอ '+picker.value));
 const fingerprint=picker.value+JSON.stringify(visible);if(fingerprint===teamChatFingerprint)return;teamChatFingerprint=fingerprint;
 const feed=teamEl('teamChatFeed');feed.replaceChildren();
 if(!visible.length){feed.textContent='ยังไม่มีข้อความในรอบที่เลือก · ระบบจะบันทึกเมื่อมีการเสนอแผนหรือมอบหมายงาน';return;}
 for(const m of visible){const box=document.createElement('div');box.className='event-item';const head=document.createElement('b');head.textContent=new Date(m.at).toLocaleTimeString('th-TH')+' · '+m.from+' → '+m.to;const text=document.createElement('p');text.textContent=m.text;box.append(head,text);feed.append(box);}
}
teamEl('teamChatSlot').addEventListener('change',()=>{if(teamBrainData)renderTeamBrain();});
setInterval(refreshTeamBrain,5000);

function renderDevelopment(d){
 const esc=reportEscape;
 let panel=teamEl('teamDevelopment');if(!panel){panel=document.createElement('section');panel.id='teamDevelopment';const view=teamEl('view-reports');view.insertBefore(panel,view.children[1]);}
 const openDetails=new Set(Array.from(panel.querySelectorAll('details[open]')).map(e=>e.dataset.key).filter(Boolean));
 const statuses={pending:'รอผล · กันคำสั่งซ้ำ',not_sent:'ไม่ได้ส่งคำสั่ง',change_observed:'พบการเปลี่ยนแปลงในเซฟเกม',spent_without_change:'ทรัพยากรลด แต่ยังไม่พบอุปกรณ์ดีขึ้น'};
 panel.innerHTML='<h2>ความพร้อม · พลังอุปกรณ์ · ผลการพัฒนา</h2><p class="report-notice">ความพร้อมเป็นเกณฑ์เตรียมตัวของบอท · คะแนนอุปกรณ์เป็นค่าประเมิน ไม่ใช่ DPS ที่วัดจริง · ผลอุปกรณ์อ้างเซฟที่เกมส่งออก ยังไม่ใช่ใบรับรองจากเซิร์ฟเวอร์</p>'+d.members.map(m=>{
  const r=m.readiness,g=m.gearPower;
  const pct=v=>v==null?'?':Math.round(v*100)+'%';
  return '<details class="event-item" data-key="member-'+m.slot+'"><summary><b>'+esc(m.name)+'</b> · '+esc(!r?'รอข้อมูลสด':r.ready?'พร้อมด้าน HP/MP ยาและอุปกรณ์':r.reasons.join(' · '))+' · คะแนนชุด '+esc(g?.score??'?')+'</summary><p>HP '+pct(r?.hp)+' · MP '+pct(r?.mp)+' · ยา HP '+(r?.hpPots??'?')+' / MP '+(r?.mpPots??'?')+'</p><p>'+esc((r?.warnings||[]).join(' · '))+'</p><p>แผนต่อสู้: '+esc(m.combat?.reason||'รอเข้าดันและข้อมูลทีม')+'</p><p>เซ็ต: '+esc((g?.sets||[]).join(', ')||'ยังไม่มีโบนัสชุด')+' · '+esc((g?.parts||[]).map(p=>p.slot+' +'+p.refine).join(' · '))+'</p>'+m.development.map(a=>'<details data-key="action-'+esc(a.id)+'"><summary>'+esc(a.kind)+' · '+esc(statuses[a.status]||a.status)+' · '+new Date(a.at).toLocaleString('th-TH')+'</summary><p>ต้นทุนสุทธิ: '+esc(Object.entries(a.cost||{}).map(([k,v])=>k+' '+v).join(' · ')||'ยังไม่ยืนยัน')+'</p><pre style="white-space:pre-wrap;max-height:220px;overflow:auto">'+esc(JSON.stringify({ก่อน:a.before,หลัง:a.after||null},null,2))+'</pre></details>').join('')+'</details>';
 }).join('')+'<h3>บทเรียนจากหอคอย</h3>'+((d.dungeons?.runs||[]).slice(0,6).map(r=>'<p>รอบ '+esc(r.id)+' · ชั้นสูงสุดที่เห็น '+esc(r.maxFloor)+' · '+esc(r.status)+' · ช่วงที่สังเกต '+Math.round(((r.finishedAt||r.lastSeen)-r.firstSeen)/60000)+' นาที · '+esc(Object.values(r.members||{}).map(m=>(m.name||m.slot)+' เสียจำนวนฟื้น '+(m.losses||0)).join(' · '))+' · รางวัลที่บันทึก '+(r.rewards||[]).length+' รายการ</p>').join('')||'<p>ยังไม่มีประวัติรอบจริง · ไม่ใช้ผลทดสอบจำลองเป็นประวัติทีม</p>');
 for(const detail of panel.querySelectorAll('details'))if(openDetails.has(detail.dataset.key))detail.open=true;
}

function renderAutonomy(d){
 const esc=reportEscape,num=v=>Number.isFinite(v)?Math.round(v).toLocaleString('th-TH'):'–';
 let panel=teamEl('autonomyHealth');if(!panel){panel=document.createElement('section');panel.id='autonomyHealth';teamEl('teamDevelopment').after(panel);}
 const opened=new Set(Array.from(panel.querySelectorAll('details[open]')).map(x=>x.dataset.slot));
 const p=d.performance,c=p?.current,stale=!d.running||!c||Date.now()-c.at>90000;
 const labels={observed:'พบผลจากข้อมูลใหม่',pending:'รอตรวจผล',unconfirmed:'ยังยืนยันไม่ได้ · พักก่อนลองใหม่',not_sent:'ยังไม่ได้ส่ง',evading:'กำลังขยับหลบ',outside_at_check:'ตำแหน่งออกนอกรัศมีตอนตรวจ',insufficient_distance:'ระยะขยับยังไม่พ้นรัศมี',unknown:'รอข้อมูลยืนยัน'};
 panel.innerHTML='<h2>ตรวจผล · MP · บอส · ประสิทธิภาพเครื่อง</h2><p>ข้อมูลเครื่อง: '+(stale?'รอข้อมูลสด':'CPU '+num(c.cpuPct)+'% · RAM ว่าง '+num(c.freeMb)+' MB · FPS ต่ำสุด '+num(c.minFps)+' · ตรวจทั่วไปทุก '+c.tickMs/1000+' วินาที')+'</p><p>เวลาที่ทั้งทีมพร้อมและมีเซฟสด '+num((p?.allReadyMs||0)/60000)+' / '+num((p?.observedMs||0)/60000)+' นาทีที่วัดได้ · ค่า CPU เป็นทั้งเครื่อง</p>'+d.members.map(m=>{
  const g=m.gearImpact,b=m.bossStatus?.events||[];
  return '<details class="event-item" data-slot="'+m.slot+'"><summary>'+esc(m.name)+' · '+esc(m.manaStatus?.reason||'รอข้อมูล MP')+'</summary><h3>ผลคำสั่งล่าสุด</h3>'+((m.outcomes?.rows||[]).map(r=>'<p>'+esc(r.kind)+' · '+esc(labels[r.status]||r.status)+' · '+esc(r.evidence||'รอข้อมูลหลังคำสั่ง')+'</p>').join('')||'<p>ยังไม่มีคำสั่งที่ต้องกระทบยอด</p>')+'<h3>การรับมือบอส</h3>'+(b.map(e=>'<p>'+esc(e.boss)+' / '+esc(e.skill)+' · '+esc(labels[e.status]||e.status)+(e.distance!=null?' · ขยับ '+e.distance.toFixed(1)+' เมตร':'')+'</p>').join('')||'<p>รอพบสกิลพื้นที่ที่รองรับในดัน · ไม่ใช่การรับรองหลบทุกท่า</p>')+'<h3>ความคุ้มค่าอุปกรณ์</h3><p>'+esc(g?.reason||'กำลังสะสมข้อมูล')+'</p>'+(g?.ready?'<p>'+esc(g.room)+' · ฆ่าต่อชั่วโมง '+num(g.before.kills)+' → '+num(g.after.kills)+' · ตายต่อชั่วโมง '+num(g.before.deaths)+' → '+num(g.after.deaths)+' · Copper สุทธิต่อชั่วโมง '+num(g.before.coins)+' → '+num(g.after.coins)+'</p>':'')+'<p>'+esc(m.investmentPlan?.reason||'รอประเมินการตีบวกครั้งถัดไป')+'</p>'+((m.investmentPlan?.candidates||[]).map(x=>'<p>'+esc(x.kind+' '+x.name)+' · คะแนนคาดหวัง/Copper '+Number(x.value||0).toFixed(4)+'</p>').join(''))+'</details>';
 }).join('')+'<p class="report-notice">HP เพิ่มหลังส่งสกิลยังระบุไม่ได้ว่าเกิดจากฮีลครั้งนั้นเพียงอย่างเดียว · ผลอุปกรณ์เป็นการสังเกต ไม่ใช่การทดลองควบคุม · ประวัติสะสมต่อเนื่องหลังรีสตาร์ต</p>';
 renderRuntimeV2(d,panel);
 for(const el of panel.querySelectorAll('details'))el.open=opened.has(el.dataset.slot);
}
