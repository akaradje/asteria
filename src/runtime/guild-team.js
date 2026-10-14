'use strict';
const fs=require('fs'),path=require('path');
const read=p=>{try{return JSON.parse(fs.readFileSync(p));}catch{return null;}};
function project(g,leader){
 if(!g?.id||!Array.isArray(g.members))return null;
 const owner=g.members.find(m=>m.name===leader&&m.rank==='leader');
 if(!owner)return null;
 return {id:g.id,name:g.name,lv:g.lv,cap:g.cap,checkedAt:g._receivedAt||null,leader,
  leaderFrom:[owner.aid,owner.id].filter(x=>x!=null),
  roster:g.members.map(m=>({name:m.name,aid:m.aid,rank:m.rank})),members:g.members.map(m=>m.name)};
}
function trustedInvite(m,g,leader){
 return !!g&&g.leader===leader&&m?.name===leader&&m.guild===g.name&&m.from!=null&&
  g.leaderFrom?.some(x=>String(x)===String(m.from));
}
function nativeReady(farm){
 try{const s=fs.readFileSync(path.join(farm.cache.dir,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
  return ["NET.social('ginv', { name })","NET.social('grank', { aid, rank: b.dataset.rank })","kind === 'guild' ? 'gans'","data-rank=\"officer\""].every(x=>s.includes(x));
 }catch{return false;}
}
async function rankRequest(federation,leader,g){
 const file=path.join(federation.root,'logs/guild-rank-request.json'),r=read(file),now=federation.now();
 if(!r||!['pending','sent-awaiting-confirmation'].includes(r.status))return;
 if(r.guildId!==g.id||r.guildName!==g.name||r.rank!=='officer'||typeof r.name!=='string'||r.name===g.leader||now-r.at<0||now-r.at>600000)return;
 const target=g.roster.find(m=>m.name===r.name);
 if(target?.rank==='officer'){r.status='confirmed';r.confirmedAt=now;r.serverReceivedAt=g.checkedAt;}
 else if(r.status==='pending'&&Number.isInteger(target?.aid)&&target.aid>0){
  // Persist before dispatch. An ambiguous result must never repeat a rank change.
  r.status='sent-awaiting-confirmation';r.sentAt=now;federation.save(file,r);
  const sent=await leader.socialSend('grank',{aid:target.aid,rank:'officer'});
  if(sent?.ok===false){r.status='not-sent';r.reason=sent.reason||'dispatch failed';}
 }
 federation.save(file,r);
}
async function round(federation,farm,live,leader){
 if(!farm.guildOn||!nativeReady(farm))return;
 let g;
 if(leader){
  g=project(await leader.guildState(),federation.config.leader);federation.guild=g;
 }else{const remote=federation.remote();g=remote?.guild?.leader===federation.config.leader?remote.guild:null;}
 if(!g)return;
 const now=federation.now();
 for(const i of live){
  if(i===leader||i.recycling||/^(tw|dx|gd|pv)/.test(i.livePos?.room||''))continue;
  const current=await i.guildState();
  if(current?.id){if(current.id!==g.id)i.guildMembership={phase:'blocked',reason:'already in another guild'};continue;}
  const invite=(await i.socialFrames('ginvite',now-55000)).filter(m=>trustedInvite(m,g,federation.config.leader)).at(-1);
  if(!invite||i.guildAccepted?.from===invite.from&&now-i.guildAccepted.at<60000)continue;
  i.guildAccepted={from:invite.from,at:now};
  const sent=await i.socialSend('gans',{from:invite.from,ok:true});
  i.guildMembership={phase:sent?.ok===false?'not-sent':'awaiting-server-membership',at:now};
 }
 if(leader){
  leader.guildTeamInvites ||= {};
  if(!/^(tw|dx|gd|pv)/.test(leader.livePos?.room||'')){
   const missing=federation.view().members.filter(m=>m.online&&m.charName!==g.leader&&!g.members.includes(m.charName));
   let seats=Math.max(0,g.cap-g.members.length);
   for(const m of missing){if(!seats--)break;if(now-(leader.guildTeamInvites[m.charName]||0)<30000)continue;
    leader.guildTeamInvites[m.charName]=now;await leader.guildInvite(m.charName);
   }
   // Preserve the existing explicit external-player invitation queue.
   const file=path.join(federation.root,'logs/guild-invite-request.json'),r=read(file);
   if(r?.status==='pending'&&r.guildId===g.id&&now-r.at>=0&&now-r.at<600000&&/^[\p{L}\p{N}_-]{2,24}$/u.test(r.name)){
    r.status=g.members.includes(r.name)?'already-member':'sent-awaiting-acceptance';r.processedAt=now;federation.save(file,r);
    if(r.status!=='already-member'){const sent=await leader.guildInvite(r.name);if(sent?.ok===false){r.status='not-sent';federation.save(file,r);}}
   }
   await rankRequest(federation,leader,g);
  }
  g=project(await leader.guildState(),federation.config.leader);federation.guild=g;
 }
 farm.guildInfo=g?{checkedAt:g.checkedAt,id:g.id,name:g.name,lv:g.lv,cap:g.cap,members:g.members,roles:g.roster.map(m=>({name:m.name,rank:m.rank}))}:null;
}
module.exports={project,trustedInvite,nativeReady,rankRequest,round};
