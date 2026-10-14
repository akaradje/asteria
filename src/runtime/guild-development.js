'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function journal(i){if(i.guildJournal)return i.guildJournal;const key=crypto.createHash('sha256').update(i.credentials?.charName||'slot-'+i.slot).digest('hex').slice(0,24);i.guildJournalFile=path.join(i.root,'logs/guild-development',key+'.json');try{i.guildJournal=JSON.parse(fs.readFileSync(i.guildJournalFile));}catch{i.guildJournal={rows:[]};}return i.guildJournal;}
function persist(i){fs.mkdirSync(path.dirname(i.guildJournalFile),{recursive:true});fs.writeFileSync(i.guildJournalFile+'.tmp',JSON.stringify(i.guildJournal));fs.renameSync(i.guildJournalFile+'.tmp',i.guildJournalFile);}
function reconcile(i,g,now=Date.now()){
 const j=journal(i),r=j.rows.find(r=>r.status==='DISPATCHING'||r.status==='UNCERTAIN');if(!r)return null;
 const me=g?.members?.find(m=>m.name===i.credentials?.charName),fresh=require('../planning/team-workboard').fresh;
 if(g?.id===r.guildId&&fresh(g._receivedAt,30000,now)&&g._receivedAt>r.at&&i.catalog().build===r.build){
  const observed=r.kind==='rune'?g.runes?.[r.key]===r.to&&g.funds<=r.funds-r.cost:fresh(i.lastSaveAt,30000,now)&&i.lastSaveAt>r.at&&(i.lastSave.materials?.[r.name]||0)<=r.stock-r.quantity&&me?.contrib>=r.contrib+r.gp;
  if(observed){r.status='OBSERVED';r.evidence=r.kind==='rune'?'server_rune_level_and_funds_delta':'server_contribution_and_outgoing_material_delta';r.finishedAt=now;persist(i);return null;}
 }
 if(now-r.at>30000&&r.status!=='UNCERTAIN'){r.status='UNCERTAIN';r.reason='ผลไม่ชัดเจน ห้ามส่งซ้ำ';persist(i);}return r;
}
async function tick(i,{dryRun=false}={}){
 if(i.teamControl||i.recycling||i.pendingTravel||i.survivalRecovery||i.livePos?.room!=='town'||require('./team-trade').protocolActive(i))return {donated:0,reason:'กิจกรรมสำคัญถือคิวอยู่'};
 const source=require('../knowledge/adapter-source').inspect(i.root,i.catalog().build,'guild');if(!source.allowed)return {donated:0,reason:'ต้องตรวจ UI กิลด์ของ build นี้'};
 let opened=false;
 try{
  opened=!!(await i.openGamePanel('social'))?.ok;if(!opened)return {donated:0,reason:'social-not-open'};
  await i.eval(`(() => {document.querySelector('#pBody [data-soc-tab="guild"]')?.click();return true;})()`);
  let g=await i.guildState(),pending=reconcile(i,g),p=require('../planning/guild-development').plan(i,g);i.guildDevelopment={...p,pending,history:journal(i).rows.slice(-6)};
  if(pending||dryRun)return {donated:0,dryRun,reason:pending?.reason||p.reason,plan:p};
  const action=p.rune?{kind:'rune',...p.rune}:p.donations[0]?{kind:'donation',...p.donations[0]}:null;if(!action)return {donated:0,reason:p.reason};
  const previous=journal(i).rows.at(-1);if(previous&&Date.now()-previous.at<60000)return {donated:0,reason:'พักหนึ่งนาทีก่อนใช้ทรัพยากรครั้งถัดไป'};
  // Prepare UI before journaling; uncertain dispatch is durable even if evaluate fails.
  await i.eval(`(() => {document.querySelector('#pBody [data-g-tab="${action.kind==='rune'?'runes':'donate'}"]')?.click();return true;})()`);
  g=await i.guildState();p=require('../planning/guild-development').plan(i,g);if(action.kind==='rune'?p.rune?.key!==action.key||p.rune.from!==action.from:!p.donations.some(d=>d.name===action.name&&d.quantity===action.quantity))return {donated:0,reason:'ข้อมูลเปลี่ยนก่อนส่ง ต้องวางแผนใหม่'};
  const me=g.members.find(m=>m.name===i.credentials.charName),r={...action,build:p.build,guildId:g.id,at:Date.now(),status:'DISPATCHING',funds:g.funds,stock:i.lastSave.materials?.[action.name]||0,contrib:me.contrib};journal(i).rows.push(r);journal(i).rows=journal(i).rows.slice(-100);persist(i);
  const sent=await i.eval(action.kind==='rune'?`(() => {const b=Array.from(document.querySelectorAll('#pBody [data-g="rune"]')).find(b=>b.dataset.k===${JSON.stringify(action.key)});if(!b||b.disabled)return false;b.click();return true;})()`:`(() => {const row=Array.from(document.querySelectorAll('#pBody [data-don-row]')).find(r=>r.dataset.donRow===${JSON.stringify(action.name)}),inp=row?.querySelector('input'),b=row?.querySelector('[data-g="don"]');if(!inp||!b||b.disabled)return false;inp.value=${action.quantity};inp.dispatchEvent(new Event('input',{bubbles:true}));if(Number(b.dataset.n)!==${action.quantity})return false;b.click();return true;})()`);
  if(!sent){r.status='NOT_SENT';r.reason='ปุ่มหรือจำนวนไม่ตรง';persist(i);}else reconcile(i,await i.guildState());
  i.guildDevelopment={...p,pending:['DISPATCHING','UNCERTAIN'].includes(r.status)?r:null,history:journal(i).rows.slice(-6)};
  return {donated:r.kind==='donation'&&r.status==='OBSERVED'?1:0,sent:!!sent,status:r.status,reason:sent?'ส่งแล้ว รอหลักฐานจริง':r.reason};
 }finally{if(opened)await i.closeGamePanel();}
}
module.exports={tick,reconcile};
