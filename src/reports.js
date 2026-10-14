'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const HOUR=3600000,RETENTION=24*HOUR;
const killCount=s=>Object.values(s.bestiary||{}).reduce((n,v)=>n+(Number.isFinite(v)?v:0),0);
const MAP_NAMES={town:'เมือง Asteria',...Object.fromEntries(require('../data/wiki.json').maps.maps.map(m=>[m.id,m.name]))};
function loadExpTable(root,build){try{const s={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(root,'cache',build,'asteria-online.io','asteria-world-system.js'),'utf8'),s,{timeout:1000});const a=s.module.exports,t=[0,0];for(let lv=1;lv<=a.MAX_LV;lv++)t[lv+1]=t[lv]+a.expToNext(lv);return t;}catch{return null;}}
class Reports{
  constructor(root,build,totals=loadExpTable(root,build),{machine}={}){
    this.file=path.join(root,'logs','reports.json');this.totals=totals;this.data={version:1,slots:{},events:[]};this.prev={};this.motion={};this.lastWrite=0;
    try{const d=JSON.parse(fs.readFileSync(this.file,'utf8'));if(d.version===1)this.data=d;}catch{}
    this.data.build=build;this.root=root;this.personalHistory=new(require('./personal-history').PersonalHistory)(root,{machine});
  }
  reset(slot){delete this.prev[slot];delete this.motion[slot];}
  row(slot,name){let r=this.data.slots[slot];if(!r||(name&&r.name&&name!==r.name)){if(r)this.personalHistory.flush([r],this.data.build,Date.now());r=this.data.slots[slot]={slot,name:name||null,buckets:[],dead:false};this.reset(slot);}if(name)r.name=name;return r;}
  bucket(slot,now){const r=this.row(slot),at=Math.floor(now/60000)*60000;r.buckets=r.buckets.filter(b=>b.at>now-RETENTION);let b=r.buckets.find(b=>b.at===at&&(!b.build||b.build===this.data.build));if(!b){b={at,build:this.data.build,exp:0,coins:0,observedMs:0,activeMs:0,movingMs:0,deaths:0,unknownExp:0,kills:0,damage:0,hits:0,maxHit:0,damageObservedMs:0};r.buckets.push(b);}return b;}
  setBuild(build){if(build===this.data.build&&this.totals)return;this.data.build=build;this.totals=loadExpTable(this.root,build);this.prev={};}
  startCombat(slot,name,now=Date.now()){const r=this.row(slot,name);r.combatTrackingSince||=now;r.combatSource='server_dmgs_attacker_id';}
  damage(slot,name,value,now=Date.now()){if(!Number.isFinite(value)||value<=0)return;this.startCombat(slot,name,now);const b=this.bucket(slot,now);b.damage=(b.damage||0)+value;b.hits=(b.hits||0)+1;b.maxHit=Math.max(b.maxHit||0,value);b.damageAt=now;this.flush(now);}
  clientHit(slot,name,value,now=Date.now()){if(!Number.isFinite(value)||value<=0)return;const r=this.row(slot,name);r.clientTrackingSince||=now;const b=this.bucket(slot,now);b.reportedDamage=(b.reportedDamage||0)+value;b.reportedHits=(b.reportedHits||0)+1;b.reportedMaxHit=Math.max(b.reportedMaxHit||0,value);b.reportedDamageAt=now;this.flush(now);}
  combatMetric(slot,name,key,value,now=Date.now()){if(!['damageTakenServer','healReceivedServer','healOfferedReceived','supportRecipients'].includes(key)||!Number.isFinite(value)||value<0)return;this.row(slot,name);const b=this.bucket(slot,now);b[key]=(b[key]||0)+value;b[key+'At']=now;this.flush(now);}
  event(slot,kind,text,now=Date.now()){const last=this.data.events.find(e=>e.slot===slot);if(last&&last.text===text&&now-last.at<30000)return;const event={slot,kind,text,at:now};this.data.events.unshift(event);this.personalHistory.event(this.data.slots[slot]?.name,event,this.data.build);this.data.events=this.data.events.filter(e=>e.at>now-HOUR).slice(0,300);}
  save(slot,name,s,now=Date.now()){
    this.row(slot,name);if(!Number.isFinite(s.exp)||!Number.isInteger(s.lv)||!Number.isFinite(s.coins))return;this.personalHistory.save(name,s,this.data.build,now);
    const latest=this.bucket(slot,now);latest.lv=s.lv;latest.jobLv=s.jobLv??null;latest.balance=s.coins;latest.savedAt=now;
    const p=this.prev[slot];this.prev[slot]={lv:s.lv,exp:s.exp,coins:s.coins,kills:killCount(s),at:now};if(!p){this.flush(now);return;}
    const dt=now-p.at;if(dt<=0||dt>30000)return;
    const b=this.bucket(slot,now);b.observedMs+=dt;b.coins+=s.coins-p.coins;b.kills=(b.kills||0)+Math.max(0,killCount(s)-p.kills);
    if(s.lv===p.lv)b.exp+=s.exp-p.exp;
    else if(s.lv>p.lv&&this.totals&&Number.isFinite(this.totals[s.lv])&&Number.isFinite(this.totals[p.lv])){b.exp+=this.totals[s.lv]-this.totals[p.lv]+s.exp-p.exp;this.event(slot,'level','เลเวลเพิ่มจาก '+p.lv+' เป็น '+s.lv,now);}
    else b.unknownExp++;
    this.flush(now);
  }
  position(slot,name,p,status,now=Date.now()){
    const r=this.row(slot,name),prev=this.motion[slot];this.motion[slot]={at:now,room:p.room,dead:!!p.dead,moving:!!p.mv,status};const b=this.bucket(slot,now);
    b.room=p.room||null;b.status=status;b.positionAt=now;
    if(p.dead&&!r.dead){b.deaths++;this.event(slot,'death','เสียชีวิต · รอฟื้นคืนชีพ',now);}r.dead=!!p.dead;
    if(prev){const dt=now-prev.at;if(dt>0&&dt<=5000&&prev.status==='playing'&&status==='playing'){if(r.clientTrackingSince&&prev.at>=r.clientTrackingSince)b.reportedObservedMs=(b.reportedObservedMs||0)+dt;if(r.combatTrackingSince&&prev.at>=r.combatTrackingSince)b.damageObservedMs=(b.damageObservedMs||0)+dt;if(!prev.dead&&!p.dead){b.activeMs+=dt;if(prev.moving)b.movingMs+=dt;}}if(p.room&&prev.room&&p.room!==prev.room)this.event(slot,'travel','เปลี่ยนโซน '+(MAP_NAMES[prev.room]||prev.room)+' → '+(MAP_NAMES[p.room]||p.room),now);}
    this.flush(now);
  }
  log(slot,m,now=Date.now()){
    let text=null,kind='action';
    if(m.startsWith('director: ')&&!m.includes('did not take effect')){text='เป้าหมายใหม่: '+m.slice(10);kind='goal';}
    else if(m.startsWith('recycling this window'))text='พักจอเพื่อคืนหน่วยความจำ แล้วเชื่อมต่อใหม่';
    else if(m.startsWith('recycled and back'))text='กลับเข้าเกมหลังคืนหน่วยความจำแล้ว';
    else if(m.startsWith('died -> respawned'))text='สั่งฟื้นคืนชีพที่เมืองแล้ว';
    else if(m.startsWith('potion restock:'))text='ดำเนินการเติมยาที่ร้านค้าแล้ว';
    else if(m.startsWith('status points: raised'))text='ใช้แต้มสถานะ '+(m.match(/raised (\d+)/)?.[1]||'')+' แต้ม';
    else if(m.startsWith('skill points: learned'))text='เรียนสกิลเพิ่ม '+(m.match(/learned (\d+)/)?.[1]||'')+' ระดับ';
    else if(m.startsWith('opened '))text='เปิดบริการ '+m.slice(7).split(' (')[0];
    else if(m.startsWith('walking out of town'))text='กำลังเดินออกจากเมืองไปพื้นที่ล่า';
    else if(m.startsWith('walking back to town'))text='กำลังเดินกลับเมือง';
    else if(m.startsWith('auto-quest gave up')){text='เควสหาเส้นทางไม่ได้ · เปลี่ยนเป็นล่าอัตโนมัติชั่วคราว';kind='warning';}
    else if(m.startsWith('no EXP for ')){text='ไม่พบความคืบหน้า · '+(m.includes('reloading')?'กำลังโหลดเกมใหม่':m.includes('closing panel')?'ปิดหน้าต่างที่ค้างอยู่':'กำลังแก้การเดินหรือตรวจโหมดล่า');kind='warning';}
    else if(m.startsWith('controller error:')){text='ตัวควบคุมพบข้อผิดพลาด · รอระบบกู้คืน';kind='warning';}
    if(text)this.event(slot,kind,text,now);
  }
  flush(now=Date.now(),force=false){if(!force&&now-this.lastWrite<15000)return;this.lastWrite=now;this.personalHistory.flush(Object.values(this.data.slots),this.data.build,now);for(const r of Object.values(this.data.slots))r.buckets=r.buckets.filter(b=>b.at>now-RETENTION);this.data.events=this.data.events.filter(e=>e.at>now-HOUR).slice(0,300);this.data.at=now;fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data));fs.renameSync(tmp,this.file);}
}
function summary(data,now=Date.now()){
  const rows=Object.values(data.slots||{}).map(r=>{const s={exp:0,coins:0,observedMs:0,activeMs:0,movingMs:0,deaths:0,unknownExp:0};for(const b of r.buckets||[])if(b.at>now-HOUR)for(const k of Object.keys(s))s[k]+=b[k]||0;return {slot:r.slot,name:r.name,...s,expPerHour:s.observedMs>=60000&&!s.unknownExp?Math.round(s.exp*HOUR/s.observedMs):null,coinsPerHour:s.observedMs>=60000?Math.round(s.coins*HOUR/s.observedMs):null};});
  const series=Object.values(data.slots||{}).map(r=>({slot:r.slot,name:r.name,combatTrackingSince:r.combatTrackingSince||null,combatSource:r.combatSource||null,clientTrackingSince:r.clientTrackingSince||null,clientSource:'outgoing_hit_not_server_receipt',limits:'server damage frames may omit own attacks; do not add outgoing and incoming totals',points:(r.buckets||[]).filter(b=>b.at>now-RETENTION&&b.at<=now).sort((a,b)=>a.at-b.at).map(b=>({...b,reportedDamage:b.reportedObservedMs>0?b.reportedDamage||0:null,reportedDps:b.reportedObservedMs>=1000?(b.reportedDamage||0)*1000/b.reportedObservedMs:null,damage:b.damageObservedMs>0?b.damage||0:null,dps:b.damageObservedMs>=1000?(b.damage||0)*1000/b.damageObservedMs:null,exp:b.unknownExp?null:b.exp}))}));
  return {at:data.at||null,build:data.build,retentionHours:24,series,rows,events:(data.events||[]).filter(e=>e.at>now-HOUR).slice(0,300)};
}
module.exports={Reports,summary,loadExpTable};
