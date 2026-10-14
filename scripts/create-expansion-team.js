'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),api=require('../src/api');
function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,file);fs.chmodSync(file,0o600);}
async function provision(root,{service=api,wait=ms=>new Promise(r=>setTimeout(r,ms)),note=()=>{},onlyNew=false}={}){
 const roster=JSON.parse(fs.readFileSync(path.join(root,'machines/expansion.json'),'utf8')).members;
 if(!Array.isArray(roster)||roster.length<1||roster.length>6||roster.some((r,i)=>r.machine!=='vps'||r.slot!==i||!/^[A-Za-z]{2,16}$/.test(r.charName))||new Set(roster.map(r=>r.charName)).size!==roster.length)throw Error('Invalid new squad roster');
 const file=path.join(root,'team.json'),journalFile=path.join(root,'private/vps-registration.json');
 const read=(p,fallback)=>{try{return JSON.parse(fs.readFileSync(p));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 const team=read(file,{meta:{squad:'later-second'},members:[]}),journal=read(journalFile,{version:1,rows:[]});
 if(team.members.some(m=>!roster.some(r=>r.slot===m.slot&&r.charName===m.charName)))throw Error('Refusing to change an unrelated account roster');
 for(const row of roster){
  let member=team.members.find(m=>m.slot===row.slot);
  let pending=journal.rows.find(m=>m.slot===row.slot);
  // Append mode never logs into an already verified account: that would evict its live session.
  if(onlyNew&&member?.verifiedAt&&member.characterId){note({slot:row.slot,charName:row.charName,phase:'existing-retained'});continue;}
  if(!member){
   if(!pending){pending={slot:row.slot,charName:row.charName,username:'later_'+crypto.randomBytes(6).toString('hex'),password:crypto.randomBytes(24).toString('base64url'),phase:'prepared'};journal.rows.push(pending);write(journalFile,journal);}
   let registered;
   if(pending.phase==='dispatching'||pending.phase==='uncertain'||pending.phase==='registered'){
    registered=await service.login(pending.username,pending.password);
    if(!registered.ok)throw Error('Prior registration outcome needs reconciliation; no replacement account created');
   }else{
    for(let attempt=0;attempt<4;attempt++){
     pending.phase='dispatching';write(journalFile,journal);
     try{registered=await service.register(pending.username,pending.password);}catch{pending.phase='uncertain';write(journalFile,journal);throw Error('Registration outcome unknown; credentials retained privately');}
     if(registered.ok)break;
     pending.phase=registered.status===429?'rate-limited':'failed';pending.httpStatus=registered.status;write(journalFile,journal);
     note({slot:row.slot,charName:row.charName,phase:pending.phase,httpStatus:registered.status});
     if(registered.status!==429)throw Error('Registration rejected HTTP '+registered.status);
     await wait(30000*(attempt+1));
    }
    if(!registered?.ok)throw Error('Registration remains rate-limited; no alternate-IP or replacement retry');
   }
   pending.phase='registered';write(journalFile,journal);
   member={slot:row.slot,storageSlot:row.slot,username:pending.username,password:pending.password,kind:'password',token:registered.token,charName:row.charName,job:row.baseJob,createdAt:new Date().toISOString()};
   team.members.push(member);write(file,team);
  }
  if(!member.token||!await service.whoami(member.token)){
   const signed=await service.login(member.username,member.password);if(!signed.ok)throw Error('New account authentication failed');member.token=signed.token;write(file,team);
  }
  const chars=await service.listChars(member.token);
  let character=(chars.chars||[]).find(c=>c.name===row.charName);
  if(!character){
   if((chars.chars||[]).length)throw Error('Unexpected character on new account; refusing duplicate');
   // A timeout leaves the fixed desired name in the private journal. Next run lists first.
   character=await service.createChar(member.token,row.charName);
  }
  if(character.name!==row.charName)throw Error('Character creation name differs');
  if(chars.active!==character.id)await service.selectChar(member.token,character.id);
  const verified=await service.listChars(member.token);
  if(!verified.chars?.some(c=>c.id===character.id&&c.name===row.charName)||verified.active!==character.id)throw Error('Active character not confirmed');
  member.characterId=character.id;member.verifiedAt=new Date().toISOString();write(file,team);
  if(pending){pending.phase='character-verified';write(journalFile,journal);}
  note({slot:row.slot,charName:row.charName,job:row.baseJob,phase:'character-verified',lv:character.lv});
  await wait(15000);
 }
 return {ok:true,members:team.members.map(m=>({slot:m.slot,charName:m.charName,job:m.job,characterVerified:!!m.verifiedAt}))};
}
if(require.main===module){
 if(process.platform!=='linux'||!process.argv.includes('--machine=vps'))throw Error('New-account provisioning requires the isolated VPS');
 provision(path.resolve(__dirname,'..'),{onlyNew:process.argv.includes('--append'),note:r=>console.log(JSON.stringify(r))}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={provision};
