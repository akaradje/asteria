'use strict';
function renderTumExtra(extra){
 const host=document.getElementById('tumExtra');if(!host)return;host.hidden=!extra;if(!extra)return;
 const d=extra.details||{};
 updateFleetDOM(host,'<div class="toolbar"><h2>tum · ตัวเสริม '+esc(extra.online)+' / '+esc(extra.expected)+'</h2><span class="muted">ฟาร์มแยกจากปาร์ตี้หลัก</span></div>'+
   '<article class="card '+(extra.online?'':'offline')+'" data-live-key="tum-extra-youlater"><div class="card-head"><h2>YouLater</h2><span class="badge">'+esc(extra.online?'ออนไลน์':extra.state==='paused'?'พักตัวเสริม':'รอข้อมูลสด')+'</span></div><small>'+esc(d.job||'รออาชีพ')+' · บัญชีเดิม</small><p class="goal">'+esc(extra.message)+'</p><div class="metrics"><div><small>เลเวล</small><b>'+fmt(d.lv)+'</b></div><div><small>FPS ล่าสุด</small><b>'+fmt(d.fps)+'</b></div><div><small>EXP ในเลเวลนี้</small><b>'+fmt(d.exp)+'</b></div></div><footer><small>เซฟ '+esc(age(extra.saveAgeMs))+' · แผนที่ '+esc(d.map||'–')+'</small></footer></article>');
}
