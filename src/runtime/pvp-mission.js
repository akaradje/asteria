'use strict';
const fs=require('fs'),path=require('path');
function command(root){try{const c=JSON.parse(fs.readFileSync(path.join(root,'logs/pvp-command.json'),'utf8'));return c.version===1&&c.target&&Array.isArray(c.ownNames)&&c.expiresAt>Date.now()&&c.expiresAt-Date.now()<1800000?c:null;}catch{return null;}}
// Opt-in adapter exposes ordinary client target selection and castSkill. No stats, HP,
// positions, cooldowns, server frames or saves are manufactured or changed by this adapter.
function patch(body,root){if(!command(root))return body;const html=body.toString('utf8'),anchor='  const PK = AsteriaWorld.PK;';
 if(!html.includes(anchor)||!html.includes('function pkGo()')||!html.includes('function pvpAct(a)')||!html.includes('function castSkill(id)'))return body;
 const adapter=`
 window.__afPvPMission={
  state(){return {map:currentMapId,connected:NET.isConnected?.(),kind:pvS?.kind,dead:player.dead,hp:player.hp,stats:pvS?Object.assign({},pvS.st):null,camp:pvS?.field,players:pvS?Array.from(pvS.info.entries()).map(([id,i])=>({id,name:i.name,hp:i.hp,dead:!!i.dead,at:others.has(id)?[others.get(id).pos.x,others.get(id).pos.z]:null})):[],hits:(window.__afTap?.frames||[]).filter(f=>f.t==='pvhit'&&(f.m.a===NET.id||f.m.b===NET.id)).slice(-30).map(f=>({at:f.at,outgoing:f.m.a===NET.id,damage:f.m.d||0,miss:!!f.m.m,target:pvS?.info.get(f.m.b)?.name||null}))};},
  stop(){setAuto(false);player.target=null;player.manualTarget=null;player.queued=null;player.chase=null;player.moveTo=null;player.path=null;},
  engage(name,own){this.stop();if(!inPkField()||player.dead||own.includes(name))return {ok:false,reason:'not eligible'};
   if(!own.every(name=>Array.from(pvS.info.values()).some(i=>i.name===name&&!i.dead)))return {ok:false,reason:'waiting for all six living team members in the field'};
   const ids=Array.from(pvS.info.entries()).filter(([id,i])=>i.name===name&&!i.dead).map(([id])=>id);
   const candidates=monsters.filter(m=>m.pvp&&ids.includes(m.pvp)&&m.alive&&!pkInCamp(m.pos));
   if(candidates.length!==1)return {ok:false,reason:'exact target absent, dead, ambiguous or protected camp'};
   const m=candidates[0];player.target=m;player.manualTarget=m;
   // Single-target skills only: area attacks could damage our own party in this field.
   const ids2=Object.keys(player.skills||{}).filter(id=>skillLv(id)>0&&SK[id]&&['melee','ranged'].includes(SK[id].kind));
   if(ids2.length)castSkill(ids2[0]);return {ok:true,id:m.pvp,name,pvp:true};
  }
 };
`;
 return Buffer.from(html.replace(anchor,anchor+adapter));
}
function record(i,data){const name=i.character?.name;if(!name)return;const dir=path.join(i.root,'logs/pvp');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,require('crypto').createHash('sha256').update(name).digest('hex').slice(0,24)+'.json'),row={character:name,at:Date.now(),...data};fs.writeFileSync(file,JSON.stringify(row,null,2));const key=JSON.stringify([data.mission?.id,data.phase,data.result?.reason,data.stats,data.target?.hp]);if(key!==i.pvpEventKey){fs.appendFileSync(file.replace(/\.json$/,'.jsonl'),JSON.stringify(row)+'\n');i.pvpEventKey=key;}}
async function tick(i){const c=command(i.root);if((!c&&!i.pvpMission)||(c&&i.pvpCompletedId===c.id&&!i.pvpMission))return null;if(i.recycling||i.choresBusy||i.teamControl)return 'PvP mission waiting for owned action';
 const state=await i.eval('window.__afPvPMission?.state()||null');if(!state){if(c)return null;i.pvpMission=null;return null;}
 if(!c||i.pvpMission?.done){await i.eval(`(()=>{window.__afPvPMission?.stop();const b=document.querySelector('[data-pk-leave]');if(b){b.click();b.click();}return true;})()`);i.pvpCompletedId=i.pvpMission?.id;i.pvpMission=null;return null;}
 if(!state.connected)return 'PvP mission waiting for connection';
 if(!i.pvpMission||i.pvpMission.id!==c.id){const file=path.join(i.root,'logs/pvp',require('crypto').createHash('sha256').update(i.character?.name||'').digest('hex').slice(0,24)+'.json');try{const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.mission?.id===c.id&&old.phase==='finished'){i.pvpCompletedId=c.id;return null;}}catch{}i.pvpMission={id:c.id,target:c.target,startedAt:Date.now(),entryAt:null,engaged:false,done:false};}const m=i.pvpMission;
 // Active trade has priority in v2 before this hook. Never interrupt another instance.
 if(state.kind&&state.kind!=='field')return 'PvP mission: another instance owns character';
 if(state.kind!=='field'){
  if(state.dead)return null; // Let the existing ordinary respawn handler finish before field entry.
  if(!i.lastSaveAt||Date.now()-i.lastSaveAt>30000)return 'PvP entry waits for fresh save';
  if(state.map!=='town'){await i.expeditionAuto(false);i.pendingTravel=null;i.campaignGoal=null;const home=await i.returnToTown();record(i,{mission:m,phase:'route-to-entry-town',confirmed:!!home.ok});return 'PvP: verified town entry route';}
  if(!i.canDo('pvpEntry',20000))return 'PvP entry awaiting server';
  await i.expeditionAuto(false);i.pendingTravel=null;i.campaignGoal=null;
  await i.openGamePanel('dungeon');await i.eval(`document.querySelector('[data-dg-tab="pkField"]')?.click()`);
  let board=await i.socialLast('pk');for(let n=0;n<12&&(!board||Date.now()-board._receivedAt>10000);n++){await new Promise(r=>setTimeout(r,250));board=await i.socialLast('pk');}if(!board||Date.now()-board._receivedAt>10000||!board.open){record(i,{mission:m,phase:'waiting-field-open',boardOpen:board?.open});return 'PvP field not confirmed open';}
  const sent=await i.eval(`(()=>{const b=document.querySelector('[data-pk-go]');if(!b||b.disabled)return false;b.click();return true;})()`);record(i,{mission:m,phase:'entry-sent',sent});return 'PvP entry sent; requires server field confirmation';
 }
 m.entryAt||=Date.now();const target=state.players.filter(p=>p.name===c.target&&!c.ownNames.includes(p.name));
 i.goal={kind:'pvp',mapId:state.map,label:'PvP · โฟกัส '+c.target};
 for(const hit of state.hits||[]){if(hit.at<=(i.pvpLastHitAt||0))continue;const dir=path.join(i.root,'logs/pvp');fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(path.join(dir,require('crypto').createHash('sha256').update(i.character?.name||'').digest('hex').slice(0,24)+'.jsonl'),JSON.stringify({character:i.character?.name,mission:c.id,evidence:'server-pvhit',...hit})+'\n');i.pvpLastHitAt=hit.at;}
 if((state.stats?.d||0)>=2||Date.now()-m.entryAt>600000||(m.engaged&&target.length===1&&target[0].dead)){m.done=true;record(i,{mission:m,phase:'finished',target:target[0]||null,stats:state.stats,evidence:'server PvP state; kill credit only if stats.k increased'});return 'PvP mission finished; return via field leave button next tick';}
 if(state.dead){record(i,{mission:m,phase:'server-respawn',stats:state.stats});return 'PvP: waiting for server camp respawn';}
 if(target.length!==1||target[0].dead){await i.eval('window.__afPvPMission.stop()');record(i,{mission:m,phase:'searching-exact-target',players:state.players.map(p=>({name:p.name,dead:p.dead})),stats:state.stats});return 'PvP: exact target not present; no random player attacks';}
 const result=await i.eval(`window.__afPvPMission.engage(${JSON.stringify(c.target)},${JSON.stringify(c.ownNames)})`);if(result.ok)m.engaged=true;record(i,{mission:m,phase:result.ok?'engaging':'waiting',result,target:target[0],stats:state.stats});return 'PvP: '+(result.ok?'engaging '+c.target:result.reason);
}
module.exports={command,patch,tick};
