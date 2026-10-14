'use strict';
// This function is also sent over SSH. Only the explicit reveal response contains a password.
function snapshot(root, request = {mode:'list'}) {
 const fs=require('fs'),path=require('path');
 let doc;
 if(request.externalCharacter==='YouLater'){
  const session=JSON.parse(fs.readFileSync(path.join(root,'private/youlater-session.json'),'utf8'));
  if(session.expectedName!=='YouLater'||!Number.isSafeInteger(session.expectedId))throw Error('invalid_external_identity');
  // Existing Google game-session account has no password-based team.json entry.
  doc={members:[{slot:0,charName:'YouLater',job:'ranger'}]};
 }else doc=JSON.parse(fs.readFileSync(path.join(root,'team.json'),'utf8'));
 if(!Array.isArray(doc.members))throw Error('invalid_team');
 let status={};try{status=JSON.parse(fs.readFileSync(path.join(root,'logs/status.json'),'utf8'));}catch{}
 const members=doc.members;
 if(request.mode==='reveal'){
  const matches=members.filter(m=>m.slot===request.slot&&m.charName===request.charName);
  if(matches.length!==1)throw Error('account_changed');
  const m=matches[0];
  return {username:typeof m.username==='string'?m.username:'',password:typeof m.password==='string'&&m.password?m.password:null,kind:m.password?'password':'google-or-session'};
 }
 if(request.mode!=='list')throw Error('invalid_mode');
 const mask=value=>value?value.slice(0,2)+'••••'+value.slice(-2):'ไม่ได้บันทึกชื่อเข้าสู่ระบบ';
 return {at:new Date().toISOString(),snapshotAt:status.at||null,rows:members.filter(m=>Number.isInteger(m.slot)&&typeof m.charName==='string').map(m=>{
  const i=(status.instances||[]).find(x=>x.slot===m.slot&&x.char===m.charName),age=i?.lastSaveAt?Date.now()-i.lastSaveAt:null;
  return {slot:m.slot,charName:m.charName,job:i?.job||m.job||null,level:i?.lv||null,kind:m.password?'password':'google-or-session',loginMasked:mask(typeof m.username==='string'?m.username:''),hasPassword:!!m.password,online:i?.status==='playing'&&age!==null&&age>=0&&age<30000,status:i?.status||'not_running',saveAgeMs:age};
 })};
}
module.exports={snapshot};
