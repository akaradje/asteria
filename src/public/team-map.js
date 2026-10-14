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

let teamMapData = null, teamMapBusy = false, selectedRoom = 'town', followSlot = null;
const teamColors = ['#8ce2b6','#c6b1f1','#8fcfff','#ffd18c','#f6a6bb','#bce68a'];
const mapEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mapEl = id => document.getElementById(id);
const memberColor = slot => teamColors[slot % teamColors.length] || '#fff';
function mapRooms(data) {
  const known = new Map(data.maps.map(m => [m.id, m]));
  for (const m of data.members) if (m.room && !known.has(m.room)) known.set(m.room, {id:m.room,name:m.room,region:'ห้องพิเศษ / อินสแตนซ์',bounds:null,gates:[]});
  return [...known.values()];
}
function positionStale(m) { return m.stale || !m.at || Date.now()-m.at > 10000 || !teamMapData?.running; }
function memberState(m) { return !m.room ? 'รอพิกัด' : positionStale(m) ? 'ตำแหน่งเก่า' : m.dead ? 'เสียชีวิต' : m.moving ? 'กำลังเดิน' : 'อยู่กับที่ / ต่อสู้'; }
async function refreshTeamMap() {
  if (activeView !== 'map' || document.hidden || teamMapBusy) return;
  teamMapBusy = true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch('/api/map', {signal:controller.signal,cache:'no-store'});
    if (!response.ok) throw Error('unavailable');
    const data = await response.json();
    if (data.unavailable) throw Error('unavailable');
    teamMapData = data;
    renderTeamMap();
  } catch {
    if (teamMapData) { teamMapData.members.forEach(m => { m.stale = true; }); renderTeamMap(); }
    mapEl('mapUpdated').textContent = 'รับตำแหน่งไม่ได้ · แสดงข้อมูลครั้งล่าสุด';
    mapEl('mapUpdated').className = 'map-alert';
  } finally { clearTimeout(timer); teamMapBusy = false; }
}
function renderTeamMap() {
  const data = teamMapData, rooms = mapRooms(data), selected = data.members.find(m => m.slot === followSlot);
  if (selected?.room) selectedRoom = selected.room;
  if (!rooms.some(m => m.id === selectedRoom)) selectedRoom = 'town';
  const room = rooms.find(m => m.id === selectedRoom), here = data.members.filter(m => m.room === selectedRoom);
  const options = rooms.map(m=>'<option value="'+mapEscape(m.id)+'">'+mapEscape(m.name)+' ('+data.members.filter(p=>p.room===m.id).length+')</option>').join('');
  if (mapEl('mapRoom').innerHTML !== options) mapEl('mapRoom').innerHTML = options;
  mapEl('mapRoom').value = selectedRoom;
  mapEl('mapUpdated').textContent = data.running ? 'รับข้อมูล '+new Date(data.at).toLocaleTimeString('th-TH')+' · ทุก 2 วินาที' : 'ฟาร์มหยุดอยู่ · ไม่มีตำแหน่งสด';
  mapEl('mapUpdated').className = 'muted';
  mapEl('mapFollowing').textContent = selected ? 'ติดตาม '+selected.name+' · '+memberState(selected) : 'เลือกสมาชิกเพื่อติดตามเมื่อเปลี่ยนโซน';
  mapEl('mapUnfollow').disabled = followSlot === null;
  mapEl('mapTeam').innerHTML = data.members.map(m=>'<button class="map-member '+(m.slot===followSlot?'selected':'')+'" data-follow="'+m.slot+'"><b><span class="member-color" style="background:'+memberColor(m.slot)+'"></span>'+mapEscape(m.name)+' · จอ '+m.slot+'</b><small>'+mapEscape(rooms.find(r=>r.id===m.room)?.name || 'ยังไม่ทราบโซน')+' · '+memberState(m)+'</small><small>'+(m.at ? 'พิกัด '+m.x.toFixed(1)+', '+m.z.toFixed(1)+' · '+Math.max(0,Math.floor((Date.now()-m.at)/1000))+' วิที่แล้ว' : 'รอข้อความตำแหน่งจากเกม')+'</small></button>').join('') || '<p class="muted">รอสมาชิกเข้าเกม</p>';
  const groups = [...new Set(rooms.map(m=>m.region))];
  mapEl('mapWorld').innerHTML = groups.map(region=>'<div><h3 class="region-title">'+mapEscape(region)+'</h3><div class="region-route">'+rooms.filter(m=>m.region===region).map(m=>'<button class="world-zone '+(m.id===selectedRoom?'active':'')+'" data-room="'+mapEscape(m.id)+'"><b>'+mapEscape(m.name)+'</b><small>'+mapEscape(m.id)+(m.levelMin?' · Lv '+m.levelMin+'–'+m.levelMax:'')+(m.next?' → '+mapEscape(m.next):'')+'</small><span class="occupants">'+data.members.filter(p=>p.room===m.id).map(p=>'<i class="'+(positionStale(p)?'map-stale':'')+'" style="background:'+memberColor(p.slot)+'" title="'+mapEscape(p.name)+'">'+p.slot+'</i>').join('')+'</span></button>').join('')+'</div></div>').join('');
  // Unknown rooms use an explicitly labelled coordinate plot, never a guessed dungeon layout.
  let bounds = room.bounds;
  if (!bounds) {
    const xs=here.map(m=>m.x), zs=here.map(m=>m.z);
    bounds={x0:Math.min(-10,...xs)-10,x1:Math.max(10,...xs)+10,z0:Math.min(-10,...zs)-10,z1:Math.max(10,...zs)+10};
  }
  const scale = Math.min(520/(bounds.x1-bounds.x0),380/(bounds.z1-bounds.z0));
  const width=(bounds.x1-bounds.x0)*scale,height=(bounds.z1-bounds.z0)*scale;
  const left=(600-width)/2,top=(460-height)/2;
  const xy=(x,z)=>[left+(x-bounds.x0)*scale,top+(z-bounds.z0)*scale];
  let svg='<svg viewBox="0 0 600 460" role="img" aria-label="ตำแหน่งทีมใน '+mapEscape(room.name)+'"><defs><pattern id="mapGrid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" stroke="#203542" stroke-width=".6"/></pattern></defs><rect width="600" height="460" fill="url(#mapGrid)"/><rect x="'+left+'" y="'+top+'" width="'+width+'" height="'+height+'" fill="#18362c" fill-opacity=".45" stroke="#527665" stroke-dasharray="5 5"/><text x="20" y="22">'+mapEscape(room.name)+'</text><text x="20" y="442">X → · Z ↓ · ผังพิกัด ไม่ใช่ภาพภูมิประเทศ</text>';
  for(const gate of room.gates || []) {const [x,y]=xy(gate.x,gate.z);svg+='<rect x="'+(x-4)+'" y="'+(y-4)+'" width="8" height="8" fill="#d5bd85"/><text x="'+(x+8)+'" y="'+(y+4)+'">'+mapEscape(gate.label)+'</text>';}
  const outside=[];
  for(const m of [...here].sort((a,b)=>(a.slot===followSlot?1:0)-(b.slot===followSlot?1:0))) {
    if(m.x<bounds.x0||m.x>bounds.x1||m.z<bounds.z0||m.z>bounds.z1){outside.push(m.name);continue;}
    const [x,y]=xy(m.x,m.z),old=positionStale(m);
    svg+='<g class="marker" data-follow="'+m.slot+'" role="button" tabindex="0" aria-label="ติดตาม '+mapEscape(m.name)+'" opacity="'+(old?'.35':'1')+'"><title>'+mapEscape(m.name)+' · '+memberState(m)+' · '+m.x+', '+m.z+'</title><circle cx="'+x+'" cy="'+y+'" r="'+(m.slot===followSlot?14:11)+'" fill="'+memberColor(m.slot)+'" stroke="'+(m.dead?'#ff7777':m.slot===followSlot?'#ffffff':'#0d1c22')+'" stroke-width="3"/><text x="'+x+'" y="'+(y+4)+'" text-anchor="middle">'+m.slot+'</text></g>';
  }
  mapEl('mapCanvas').innerHTML=svg+'</svg>';
  mapEl('mapBoundsNote').textContent = (room.bounds ? 'ผังขอบเขตโซน · หมุดจาง = ข้อมูลเกิน 10 วินาทีหรือจอไม่พร้อม' : 'ยังไม่มีขอบเขตห้องนี้ · แสดงกราฟพิกัดตามตำแหน่งที่ได้รับ')+(outside.length?' · พิกัดอยู่นอกขอบเขต: '+outside.join(', '):'');
  mapEl('mapDetail').textContent = selected ? selected.name+' — '+(selected.goal || 'ยังไม่มีเป้าหมาย') : here.length+' คนในโซนนี้ · หมายเลขและสีตรงกับรายชื่อทีม';
}
mapEl('mapRoom').addEventListener('change',event=>{selectedRoom=event.target.value;followSlot=null;if(teamMapData)renderTeamMap();});
mapEl('mapUnfollow').addEventListener('click',()=>{followSlot=null;if(teamMapData)renderTeamMap();});
mapEl('view-map').addEventListener('click',event=>{
  const follow=event.target.closest('[data-follow]'),room=event.target.closest('[data-room]');
  if(follow)followSlot=+follow.dataset.follow;
  else if(room){selectedRoom=room.dataset.room;followSlot=null;}
  else return;
  if(teamMapData)renderTeamMap();
});
mapEl('mapCanvas').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-follow]')){event.preventDefault();followSlot=+event.target.dataset.follow;if(teamMapData)renderTeamMap();}});
setInterval(refreshTeamMap,2000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshTeamMap();});
