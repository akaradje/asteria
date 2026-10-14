'use strict';
const {fresh}=require('./planning/team-workboard');
const roles={knight:'แทงก์',priest:'ฮีลและสนับสนุน',ranger:'ดาเมจระยะไกล',mage:'ดาเมจพื้นที่',assassin:'ดาเมจเป้าหมายเดี่ยว',monk:'ดาเมจและสนับสนุน'};
function direct(config,sources,now=Date.now()){
 const members=config.members.map(r=>{const source=sources.find(s=>s?.machine===r.machine),m=source?.members?.find(m=>m.charName===r.charName&&m.slot===r.slot),valid=!!(source&&fresh(source.at,15000,now)&&m&&fresh(m.lastSaveAt,30000,now)&&fresh(m.livePos?.at,10000,now)&&fresh(m.vitals?.at,15000,now));return {...r,role:roles[r.baseJob],fresh:valid,room:valid?m.livePos.room:null,hp:valid?m.vitals.hp:null,mp:valid?m.vitals.mp:null,ready:!!(valid&&m.status==='playing'&&!m.recycling&&!m.livePos.dead&&m.readiness?.ready&&fresh(m.readiness.at,30000,now)),readinessReasons:m?.readiness?.reasons||['รอการตรวจความพร้อมก่อนลงดัน']};});
 const tank=members.find(m=>m.baseJob==='knight'),healer=members.find(m=>m.baseJob==='priest');
 const dangerous=members.filter(m=>m.fresh&&Number.isFinite(m.hp)&&m.hp<.25);
 const dungeonRooms=members.filter(m=>/^(tw|dx|gd|pv)/.test(m.room||''));
 const withdraw=dungeonRooms.length>0&&(dangerous.length>0||!tank?.fresh||!healer?.fresh||!Number.isFinite(healer?.mp)||healer.mp<.15);
 const ready=members.every(m=>m.ready&&m.hp>=.85&&m.mp>=.5),sameRoom=new Set(members.map(m=>m.room)).size===1;
 return {at:now,members,ready,sameRoom,canEnter:ready&&sameRoom,withdraw,reason:withdraw?'หยุดเปิดการต่อสู้ใหม่และรวมตัว: ทีมเสี่ยงหรือแทงก์/ฮีลไม่พร้อม':!ready?'รอทีม '+config.members.length+' ตัว ข้อมูลสด HP/MP ยาและอุปกรณ์ครบ':!sameRoom?'รอทีมรวมในห้องเดียวกัน':'พร้อมตรวจ workflow เข้าดัน',workflowVerified:false,automaticEntryAllowed:false};
}
module.exports={direct};
