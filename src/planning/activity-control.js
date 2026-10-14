'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const terminal=p=>['IDLE','COMPLETE','FINISHED','WITHDRAWN'].includes(p);
const read=f=>{try{return JSON.parse(fs.readFileSync(f));}catch{return null;}};
function state(root,policy={enabled:false},now=Date.now()){
 const dir=path.join(root,'logs/fleet/activity-commands');
 const events=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).map(f=>read(path.join(dir,f))).filter(e=>e?.version===1&&Number.isFinite(e.at)&&e.at<=now+5000&&(!Number.isFinite(policy.authorizationAt)||e.at>=policy.authorizationAt)).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)):[];
 const last=events.at(-1),toggle=events.findLast(e=>e.action==='set-auto');
 const ack=read(path.join(root,'logs/fleet/activity-command-result.json'));
 const request=last?.action==='rally'?{...last,status:ack?.id===last.id?ack.status:'PENDING',reason:ack?.id===last.id?ack.reason:'ตรวจความพร้อมก่อนเรียกทั้งทีม',expiresAt:last.at+600000}:null;
 return {version:1,revision:last?.id||'initial',autoEnabled:toggle?toggle.enabled:policy.enabled===true,request,lastAction:last?.action||null,lastId:last?.id||null,lastAt:last?.at||null,at:now};
}
function command(root,body,{now=Date.now()}={}){
 if(!body||!['set-auto','rally','cancel'].includes(body.action)||typeof body.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.id)||Object.keys(body).some(k=>!['action','kind','enabled','id','revision'].includes(k)))throw Error('Invalid activity command');
 if(body.action==='set-auto'&&typeof body.enabled!=='boolean'||body.action==='rally'&&!['guild','rift','tower'].includes(body.kind))throw Error('Invalid activity choice');
 const dir=path.join(root,'logs/fleet/activity-commands'),file=path.join(dir,body.id+'.json');
 const old=read(file);if(old){if(old.action!==body.action||old.kind!==body.kind||old.enabled!==body.enabled)throw Error('Command ID already has a different action');return {ok:true,duplicate:true,control:state(root,read(path.join(root,'machines/daily-team-activities.json'))||{},now)};}
 const policy=read(path.join(root,'machines/daily-team-activities.json'))||{},current=state(root,policy,now);
 if(body.revision!==current.revision)throw Error('สถานะปุ่มเปลี่ยนแล้ว กรุณาอ่านข้อมูลล่าสุดก่อนส่งใหม่');
 const workflow=read(path.join(root,'logs/fleet/activity-workflow.json'))||{phase:'IDLE'};
 if(body.action==='rally'&&(!terminal(workflow.phase)||current.request&&['PENDING','WAITING'].includes(current.request.status)&&current.request.expiresAt>now))throw Error('มีงานระดมพลหรือรอบเดิมอยู่แล้ว ต้องจบหรือยกเลิกก่อน');
 const build=read(path.join(root,'logs/fleet/local.json'))?.build;
 if(body.action==='rally'&&typeof build!=='string')throw Error('รอ build สดจากฟาร์มก่อนระดมพล');
 const event={version:1,id:body.id,action:body.action,at:now,...(body.action==='rally'?{kind:body.kind,build}:{}),...(body.action==='set-auto'?{enabled:body.enabled}:{})};
 fs.mkdirSync(dir,{recursive:true});const temp=path.join(dir,body.id+'.'+crypto.randomUUID()+'.tmp');fs.writeFileSync(temp,JSON.stringify(event));fs.renameSync(temp,file);
 return {ok:true,control:state(root,policy,now)};
}
function acknowledge(root,id,status,reason,now=Date.now()){
 const file=path.join(root,'logs/fleet/activity-command-result.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({id,status,reason,at:now}));fs.renameSync(file+'.tmp',file);
}
function pauseUnopened(activity,control){
 const r=activity.state,explicit=control.lastAction==='cancel'||control.lastAction==='set-auto'&&!control.autoEnabled;
 if(['GATHERING','PREPARING'].includes(r.phase)&&!r.openAt&&!r.runId&&(explicit||!control.autoEnabled&&!r.requestId)){
  r.phase='WITHDRAWN';r.finishedAt=r.at=activity.now();r.reason='พักกิจกรรมทีมตามคำสั่ง · กลับฟาร์มส่วนตัว · ไม่ใช้โควต้า';r.evidence='operator_pause_before_opening';activity.persist();return true;
 }
 return false;
}
module.exports={state,command,acknowledge,pauseUnopened,terminal};
