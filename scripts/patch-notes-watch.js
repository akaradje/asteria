'use strict';
// Preserve the existing cron entry point and internal dashboard announcements.
// Announcements are reference text; this watcher never authorizes game actions.
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
async function watch({root=ROOT,fetcher=fetch,now=Date.now,parse,announce,logger}={}){
 const dir=path.join(root,'logs'),file=path.join(dir,'patch-notes-seen.json');
 fs.mkdirSync(dir,{recursive:true});
 const log=logger||((message)=>{const line=new Date(now()).toISOString()+' '+message;console.log(line);try{fs.appendFileSync(path.join(dir,'patch-notes.log'),line+'\n');}catch{}});
 let state;try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch{state={seen:[]};}
 state.seen=Array.isArray(state.seen)?state.seen.filter(id=>typeof id==='string'):[];
 const save=()=>{const result=require('../src/runtime/telemetry-file').writeTelemetry(file,state);if(!result.ok)throw Error('patch note state unavailable: '+result.code);};
 state.attemptedAt=new Date(now()).toISOString();
 try{
  const response=await fetcher('https://asteria-online.io/',{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('patch notes HTTP '+response.status);
  const html=await response.text();if(html.length>8000000)throw Error('patch note source too large');
  const result=(parse||require('../src/knowledge/patch-notes').extractPatchNotes)(html,{maxNotes:500,maxCharacters:500000});
  state.parser={status:result.status,coverage:result.coverage||null,declaration:result.declaration||null};
  if(result.status!=='parsed'||result.coverage?.complete!==true)throw Error('patch notes unavailable: '+result.status);
  const fresh=result.notes.filter(note=>!state.seen.includes(note.id));
  if(fresh.length){
   const room=announce?null:new(require('../src/team-room').TeamRoom)(root);
   const post=announce||((text)=>room.post('ระบบเฝ้าข่าว','ทุกคน',text,'announcement'));
   log('NEW GAME UPDATES: '+fresh.length);
   for(const note of fresh){
    const items=(note.items||[]).map(item=>item.t+': '+item.d).join(' | ');
    const line=(note.date+' · '+note.title+' — '+(note.sub||'')+' '+items).slice(0,1400);
    post('อัปเดตเกมใหม่: '+line);log('  '+note.id+': '+note.title);
   }
  }else log('no new patch note IDs ('+result.notes.length+' parsed; mechanics require separate verification)');
  // Retain IDs no longer present in the current announcement window.
  state.seen=[...new Set([...result.notes.map(note=>note.id),...state.seen])].slice(0,2000);
  state.checkedAt=new Date(now()).toISOString();state.lastError=null;save();
  return {status:'checked',newNotes:fresh.length,notes:result.notes.length,checkedAt:state.checkedAt,coverage:result.coverage};
 }catch(error){
  state.lastError=String(error.message).slice(0,300);state.failedAt=new Date(now()).toISOString();
  try{save();}catch{}log('failed: '+state.lastError);return {status:'unavailable',error:state.lastError};
 }
}
if(require.main===module)watch().then(result=>{if(result.status==='unavailable')process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={watch};
