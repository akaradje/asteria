'use strict';
function renderExpansion(expansion){
 const host=document.getElementById('expansion');
 if(!host)return;
 host.hidden=!expansion;
 if(!expansion)return;
 const memberMarkup=(expansion.members||[]).map(m=>{
  const d=m.details||{},f=Number.isFinite(d.fps)&&Number.isFinite(d.fpsAt)&&Date.now()-d.fpsAt>=0&&Date.now()-d.fpsAt<15000?d.fps:null;
  return '<article class="card '+(m.online?'':'offline')+'" data-live-key="expansion-'+esc(m.key)+'"><div class="card-head"><h2>'+esc(m.charName)+'</h2><span class="badge">'+esc(m.paused?'พักเพื่อลดภาระ CPU':m.online?'ออนไลน์':'รอข้อมูลสด')+'</span></div><small>VPS · '+esc(m.job||m.baseJob)+' · จอ '+esc(m.slot+1)+'</small><p class="goal">'+esc(m.paused?'เก็บบัญชีไว้ · ยังไม่เปิดจอ':d.goal?.label||'เตรียมการฟาร์ม')+'</p><div class="metrics"><div><small>เลเวล</small><b>'+fmt(m.lv)+'</b></div><div><small>FPS ล่าสุด</small><b>'+fmt(f)+'</b></div><div><small>เหรียญ</small><b>'+fmt(m.detailsFresh?d.coins:null)+'</b></div></div>'+(typeof expBarLayout==='function'?expBarLayout(m.expProgress,m.online):'')+runtimeHealthLayout(d.runtimeHealth,d.runtimeCost)+actualProgressLayout(d.actualProgress)+(typeof characterJourneyLayout==='function'?characterJourneyLayout(d.characterJourney,true):'')+'<footer><small>ข้อมูล '+esc(age(m.detailsAgeMs))+'</small><button data-expansion-member="'+esc(m.key)+'">รายละเอียด</button></footer></article>';
 }).join('');
 const markup='<div class="toolbar"><h2>VPS · ปาร์ตี้แยก '+esc(expansion.online)+' / '+esc(expansion.expected)+'</h2><div><button data-command="start" data-machine="vps" '+(expansion.running?'disabled':'')+'>เริ่ม '+esc(expansion.expected)+' ตัว</button> <button data-command="stop" data-machine="vps" '+(!expansion.running?'disabled':'')+'>หยุด VPS</button></div></div><p class="'+(expansion.complete?'good':'warn')+'">'+esc(expansion.complete?'ปาร์ตี้ VPS ครบ · หัวหน้า '+expansion.party.leader:'รอยืนยันปาร์ตี้ VPS')+' · กิลด์ '+esc(expansion.guildReady?'ExampleGuild · ครบ '+expansion.expected+' ตัว':'รอยืนยันสมาชิกใหม่')+' · RAM ว่าง '+fmt(expansion.host?.freeMb)+' MB</p>'+(expansion.paused?'<p class="subtle">เปิดใช้งาน '+esc(expansion.expected)+' จาก '+esc(expansion.registered)+' ตัว · พัก '+esc(expansion.paused)+' ตัว · '+esc(expansion.capacityReason)+'</p>':'')+(expansion.error?'<p class="warn">'+esc(expansion.error)+'</p>':'')+'<div class="cards">'+memberMarkup+'</div>';
 updateFleetDOM(host,markup);
}

// Always visible on the overview, independently of the diagnostic disclosure.
function renderHostPresence(s,receivedAt){
 const host=document.getElementById('hostPresence');if(!host)return;
 const rows=[{name:'tum',members:(s.members||[]).filter(m=>m.machine==='tum'),snapshot:s.machines?.tum?.snapshotAt},{name:'VPS',members:(s.expansion?.members||[]).filter(m=>!m.paused),snapshot:s.expansion?.snapshotAt}];
 const fresh=Number.isFinite(receivedAt)&&Date.now()-receivedAt>=0&&Date.now()-receivedAt<20000;
 updateFleetDOM(host,'<h3>ทีม 6 ตัว · เครื่องละ 3 ตัว</h3>'+rows.map(r=>'<p><b>'+esc(r.name)+'</b> · '+(fresh?r.members.filter(m=>m.online&&m.detailsFresh).length:'รอข้อมูลสด')+' / '+r.members.length+' ตัว · '+esc(r.members.map(m=>m.charName).join(', ')||'รอรายชื่อตัวละคร')+'<br><small>ข้อมูลเครื่อง '+esc(r.snapshot?new Date(r.snapshot).toLocaleTimeString('th-TH'):'ยังไม่ยืนยัน')+'</small></p>').join(''));
}
