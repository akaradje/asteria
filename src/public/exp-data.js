'use strict';
// Dashboard-only reader: one compact disk projection per remote host / 30s.
// No game evaluation, account lookup, farm changes or per-character requests.
const path=require('path'),fs=require('fs');
const root=path.resolve(__dirname,'../..'),cached=new Map(),pending=new Map();
function progress(row,build,{now=Date.now(),snapshotAt,world}={}){
 const unknown=reason=>({status:'unknown',reason});
 if(!row||!Number.isInteger(row.lv)||row.lv<1||!Number.isFinite(row.exp)||row.exp<0)return unknown('รอค่า EXP จากเซฟ');
 if(typeof build!=='string'||! /^[a-zA-Z0-9_-]+$/.test(build))return unknown('รอรุ่นเกมของเซฟ');
 if(!world){try{world=require('../economy').loadCatalog(root,build).world;}catch{}}
 if(!Number.isInteger(world?.MAX_LV)||world.MAX_LV<1||row.lv>world.MAX_LV)return unknown('รอสูตร EXP ของเกมรุ่นนี้');
 const at=row.lastSaveAt,envelope=typeof snapshotAt==='string'?Date.parse(snapshotAt):snapshotAt;
 if(!Number.isFinite(at)||at>now||!Number.isFinite(envelope)||envelope>now||at>envelope)return unknown('รอเวลาของเซฟที่ยืนยันได้');
 const capped=row.lv===world.MAX_LV;let need=null;
 try{if(!capped)need=world.expToNext?.(row.lv);}catch{return unknown('รอสูตร EXP ของเกมรุ่นนี้');}
 if(!capped&&(!Number.isFinite(need)||need<=0))return unknown('รอสูตร EXP ของเกมรุ่นนี้');
 const status=now-at<30000&&now-envelope<60000?'fresh':'stale',p=row.levelProgress;
 const measured=!!(p&&p.build===build&&p.lv===row.lv&&p.saveAt===at&&Number.isFinite(p.at)&&p.at<=now&&now-p.at<60000&&p.status==='measured'&&p.measuredMs>=300000&&p.samples>=5&&Number.isFinite(p.expPerHour));
 const rate=status==='fresh'&&measured?p.expPerHour:null,remaining=capped?0:Math.max(0,need-row.exp);
 return {status,build,lv:row.lv,maxLv:world.MAX_LV,current:row.exp,needed:need,remaining,pct:capped?100:Math.min(100,row.exp*100/need),capped,saveAt:at,snapshotAt:envelope,expPerHour:rate,estimatedMinutes:!capped&&rate>0?Math.ceil(remaining*60/rate):null,measuredMs:measured?p.measuredMs:null,samples:measured?p.samples:null};
}
function remote(machine,now=Date.now()){
 if(cached.has(machine)&&now-cached.get(machine).at<30000)return Promise.resolve(cached.get(machine).value);
 if(pending.has(machine))return pending.get(machine);
 let args;
 if(machine==='tum'){
  const c=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet.json')));
  args=['-n','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5',c.ssh.host,'python3',path.posix.join(path.posix.dirname(c.ssh.exchange),'../src/public/exp-snapshot.py'),'tum'];
 }else if(machine==='vps'){
  const c=require('../expansion-dashboard').registry();
  args=['-n','-i',c.ssh.identityFile,'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5',c.ssh.host,'python3',path.posix.join(path.posix.dirname(c.ssh.bridge),'../src/public/exp-snapshot.py'),'vps'];
 }else return Promise.resolve(null);
 const flight=new Promise(resolve=>require('../runtime/fleet-transport').sshCapture(args,{timeout:8000,maxBuffer:16384},(error,out)=>{
  let value=null;try{if(!error)value=JSON.parse(out);}catch{}
  // Failed reads retain their original save timestamps, never fabricate freshness.
  value=value||cached.get(machine)?.value||null;cached.set(machine,{at:Date.now(),value});resolve(value);
 })).finally(()=>pending.delete(machine));pending.set(machine,flight);return flight;
}
function attach(members,snapshot,now=Date.now()){
 for(const m of members||[]){
  const row=snapshot?.rows?.find(r=>r.slot===m.slot&&r.char===m.charName);
  m.expProgress=progress(row,snapshot?.build,{now,snapshotAt:snapshot?.snapshotAt});
  if(m.expProgress.lv!==undefined&&Number.isInteger(m.lv)&&m.lv!==m.expProgress.lv)m.expProgress={status:'unknown',reason:'เลเวลกำลังเปลี่ยน · รอเซฟตรงกัน'};
 }
}
module.exports={progress,remote,attach};
