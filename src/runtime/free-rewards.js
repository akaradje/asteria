'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const sourceCache=new Map();
function sourceReviewed(text){return require('../knowledge/native-contract').validate(text,'rewards').allowed;}
async function gate(i){
 const build=i.cache?.dir?path.basename(i.cache.dir):i.buildHash,identity=i.loadedSourceIdentity?.();
 if(!require('./freshness').decisionGate(i).allowed)return false;
 const captured=require('../knowledge/loaded-source').capture(i.root,build);
 if(!identity||identity.signature!==captured.signature||captured.missing.length)return false;
 const file=path.join(i.root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),st=fs.statSync(file),stamp=[st.size,st.mtimeMs,st.ctimeMs].join(':');
 if(sourceCache.get(file)?.stamp!==stamp){sourceCache.set(file,{stamp,reviewed:sourceReviewed(fs.readFileSync(file,'utf8'))});while(sourceCache.size>12)sourceCache.delete(sourceCache.keys().next().value);}
 if(!sourceCache.get(file).reviewed)return false;
 const health=await require('../api').health();return health?.ok&&health.build===build;
}
async function query(i,command,type,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const at=now(),sent=await i.socialSend(command);if(!sent?.ok)return null;
 for(let n=0;n<20;n++){await sleep(250);const s=await i.socialLast(type);if(s?._receivedAt>=at)return s;}
 return null;
}
async function dispatch(i,kind,payload){
 if(!['mailget','achclaim','gpull','prwear'].includes(kind)||kind==='gpull'&&(!['ticket','free'].includes(payload.how)||![1,10].includes(payload.n)||payload.how==='free'&&payload.n!==1))return {ok:false,reason:'unapproved reward command'};
 // Same native save/flush path as the reviewed UI; never fabricate inventory.
 return i.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.online||!n.isConnected?.()||n.pause||n.fixed||n.kicked||n.block||typeof n.handlers?.resave!=='function'||typeof n.flush!=='function')return {ok:false};n.handlers.resave();await n.flush();if(!n.isConnected()||n.pause||n.fixed||n.kicked||n.block)return {ok:false};n.social(${JSON.stringify(kind)},${JSON.stringify(payload)});return {ok:true};})()`);
}
function confirmed(row,states){
 if(row.kind==='mailget')return states.mail?.list?.some(m=>m.id===row.payload.id&&m.got);
 if(row.kind==='achclaim')return !!states.ach?.got?.[row.payload.id];
 if(row.kind==='prwear')return states.prem?.worn?.[row.payload.slot]===row.payload.id;
 if(row.kind==='gpull'){
  const s=states.gst,b=row.before;if(!s||s.pulls!==b.pulls+row.payload.n)return false;
  return row.payload.how==='ticket'?s.tickets===b.tickets-row.payload.n:s.free===0&&b.free>0;
 }
 return false;
}
function pullReceipt(row,frames){
 const frame=(frames||[]).find(m=>Array.isArray(m.res)&&m.res.length===row.payload.n&&confirmed(row,{gst:m}));
 return (frame?.res||[]).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)&&(typeof x.id==='string'||typeof x.name==='string')).map(x=>({id:x.id||null,name:x.name||null,n:x.n??null,rarity:x.r,duplicate:x.dup??null,dust:x.dust??null}));
}
async function run(i,{now=Date.now,check=gate,read=query,send=dispatch,maxPulls=40,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(i.freeRewardsBusy)return null;i.freeRewardsBusy=true;
 const name=i.character?.name||i.credentials?.charName,build=i.cache?.dir?path.basename(i.cache.dir):i.buildHash;
 const actorId=i.actorIdentity?.actorId,base=i.actorStateRoot||i.root,file=path.join(base,'logs/free-rewards',hash(actorId||name||'slot-'+i.slot).slice(0,24)+'.json'),canonical=require('./canonical-document');
 let journal;try{journal=canonical.existing(base,file)||JSON.parse(fs.readFileSync(file));if(!Array.isArray(journal.rows))throw Error('Invalid reward journal');}catch(e){if(e.code!=='ENOENT'){i.freeRewardsBusy=false;throw Error('Reward journal unreadable; preserve receipts and pause reward mutations');}journal={version:2,actorId:actorId||null,name,rows:[]};}
 const document=canonical.open(base,file,journal);if(document)journal=document.data;
 if(actorId&&!journal.legacyPreview){const legacy=path.join(i.root,'logs/free-rewards',hash(name||'slot-'+i.slot).slice(0,24)+'.json');if(legacy!==file){try{const bytes=fs.readFileSync(legacy),old=JSON.parse(bytes);if(!Array.isArray(old.rows))throw Error('Legacy reward journal schema unknown');journal.legacyPreview={sha256:hash(bytes),scope:'unknown_native_owner_original_preserved',pending:old.rows.filter(r=>['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status)).map(r=>({id:r.id,kind:r.kind,target:r.payload?.id??null,at:r.at})),imported:false};}catch(e){if(e.code!=='ENOENT'){i.freeRewardsBusy=false;throw Error('Legacy reward journal unreadable; no new reward dispatch');}}}}
 const persist=()=>{canonical.save(document,journal);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(journal,null,2));fs.renameSync(file+'.tmp',file);};
 const states={},report={at:now(),build,policy:'tickets: ten first, then remaining singles; free pulls allowed; no diamonds/top-up/dust spending',claimedMail:[],claimedAchievements:[],pulled:0,results:[],equipped:[],status:'checking'};
 const refresh=async type=>{const [cmd,t]={mail:['mailq','mail'],ach:['achq','ach'],gst:['gq','gst'],prem:['prq','prem']}[type];const state=states[type]=await read(i,cmd,t);if(type==='gst'&&state)report.gacha={tickets:state.tickets,pulls:state.pulls,pity:state.pity,dust:state.dust,free:state.free,observedAt:state._receivedAt};return state;};
 const action=async(kind,payload,before)=>{
  if(journal.legacyPreview?.pending?.some(r=>r.kind===kind&&(kind==='gpull'||r.target===payload.id))){report.status='legacy_reward_outcome_needs_identity_reconciliation';return false;}
  if(!await check(i)){report.status='waiting_current_build';return false;}
  const row={id:crypto.randomUUID(),kind,payload,before,at:now(),build,actorId:actorId||null,generation:i.socialInbox?.generation??null,status:'STARTED'};journal.rows.push(row);persist();
  try{const result=await send(i,kind,payload);if(!result?.ok){row.status='NOT_SENT';persist();return false;}
   row.status='WAITING_CONFIRMATION';persist();
   const type={mailget:'mail',achclaim:'ach',gpull:'gst',prwear:'prem'}[kind];await refresh(type);
   if((row.generation===null||row.generation===i.socialInbox?.generation)&&states[type]?._receivedAt>=row.at&&confirmed(row,states)){row.status='CONFIRMED';row.confirmedAt=now();row.evidence='fresh_server_state_after_native_dispatch';
    if(kind==='gpull'){
     let frames=[];try{frames=await i.socialFrames?.('gst',row.at-1)||[];}catch{}
     row.results=pullReceipt(row,[...frames,states.gst]);row.resultEvidence=row.results.length===payload.n?'native_pull_response':'counters_only_no_item_receipt';
    }
    persist();return row;}
  }catch{row.reason='native_dispatch_or_confirmation_outcome_unknown';}
  row.status='UNCERTAIN';persist();report.status='uncertain_no_replay';return false;
 };
 try{
  if(!await check(i)){report.status='waiting_current_build';return report;}
  for(const type of ['mail','ach','gst','prem'])if(!await refresh(type)){report.status='waiting_server_state';return report;}
  let gachaHeld=journal.legacyPreview?.pending?.some(r=>r.kind==='gpull')===true;
  for(const row of journal.rows.filter(r=>['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status))){
   if(confirmed(row,states)){row.status='CONFIRMED';row.confirmedAt=now();row.evidence='fresh_server_state_reconciled_no_replay';persist();}
   else if(row.kind==='gpull'){gachaHeld=true;report.pendingGacha={id:row.id,at:row.at,reason:'ผลสุ่มยังไม่ชัด · ไม่ส่งซ้ำ · สวมของที่มีและฟาร์มต่อ'};}
   else{report.status='uncertain_no_replay';return report;}
  }
  // Only the server's claimable flags authorize receipt; a read letter is not a new gift.
  for(const m of states.mail.list||[]){if(m.got||m.low||!Number.isInteger(m.id)||!Object.values(m.items||{}).some(v=>typeof v==='number'?v>0:Array.isArray(v)&&v.length>0))continue;
   const row=await action('mailget',{id:m.id});if(!row)return report;report.claimedMail.push(m.id);
  }
  for(const id of Object.keys(states.ach.done||{})){if(!states.ach.done[id]||states.ach.got?.[id])continue;
   const row=await action('achclaim',{id});if(!row)return report;report.claimedAchievements.push(id);
  }
  if(!await refresh('gst')){report.status='waiting_gacha_state';return report;}
  while(!gachaHeld&&states.gst&&report.pulled<maxPulls){const s=states.gst,how=s.tickets>0?'ticket':s.free>0?'free':null;if(!how)break;
   const n=how==='ticket'&&s.tickets>=10&&maxPulls-report.pulled>=10?10:1;
   if(!Number.isInteger(s.pulls)||!Number.isInteger(s.tickets)||s.tickets<0){report.status='unknown_gacha_schema';return report;}
   const row=await action('gpull',{n,how},{pulls:s.pulls,tickets:s.tickets,free:s.free});if(!row){gachaHeld=true;break;}report.pulled+=n;report.results.push(...(row.results||[]));
   // Let the native spin/drop/reveal settle before another pull; do not flood
   // commands faster than the game's own controls allow them to complete.
   await sleep(2500);
   await i.eval?.(`(() => {const e=document.getElementById('gaRev');if(e&&!e.hidden){e.click();e.click();}return true;})()`).catch(()=>{});
  }
  if(!await refresh('prem')){report.status='waiting_owned_items';return report;}
  const cat=i.catalog(),role=i.lastSave?.job==='novice'?i.credentials?.job:i.lastSave?.job;
  const plan=require('../power-plan').ownedPremiumPlan(cat.world?.PREMIUM||[],states.prem,role,cat.world);
  for(const item of plan.items){const row=await action('prwear',{slot:item.slot,id:item.id});if(!row)return report;report.equipped.push({id:item.id,name:item.name,slot:item.slot});}
  report.gacha={tickets:states.gst.tickets,pulls:states.gst.pulls,pity:states.gst.pity,dust:states.gst.dust,free:states.gst.free};
  report.premium={owned:states.prem.owned||[],worn:states.prem.worn||{},coins:states.prem.coins};
  report.achievements={points:states.ach.pts,claimed:Object.keys(states.ach.got||{}).filter(k=>states.ach.got[k]).length};report.status=gachaHeld?'uncertain_no_replay':'checked';return report;
 }finally{
  i.freeRewards=report;journal.report=report;journal.rows=[...journal.rows.filter(r=>['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status)),...journal.rows.filter(r=>!['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(r.status)).slice(-160)];persist();i.freeRewardsBusy=false;
  // Native capsule reveal uses two taps to close; leave the gameplay controls free.
  await i.eval?.(`(() => {const close=()=>{const e=document.getElementById('gaRev');if(e&&!e.hidden){e.click();e.click();}};close();setTimeout(close,3000);return true;})()`).catch(()=>{});
 }
}
module.exports={run,query,dispatch,confirmed,pullReceipt,gate,sourceReviewed};
