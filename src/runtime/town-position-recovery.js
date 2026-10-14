'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),map=require('./town-map-walk'),fresh=require('./freshness');
const item='Butterfly Wing';
function protectedOwner(i,s){
 const head=require('./equipment-headroom');
 return s.death||s.panelOpen||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.recycling||i.choresBusy||i.survivalRecovery||i.assistanceReservation||i.classBossProbeActive||i.v2?.trial?.active?.()||head.developmentBlocks(i)||head.journalBlocks(i)||i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase);
}
async function tick(i,s,now=Date.now()){
 if(protectedOwner(i,s)||i.status!=='playing'||i.v2?.sourceCoherence?.matches!==true||!fresh.decisionGate(i,now).allowed)return null;
 const name=i.character?.name;if(!name)return null;
 const file=path.join(i.root,'logs/town-position-recovery',crypto.createHash('sha256').update(name).digest('hex').slice(0,24)+'.json');
 let row;try{row=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')return 'town position recovery: unreadable journal; no replay';}
 const write=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});return require('./telemetry-file').writeTelemetry(file,row).ok;};
 const report=reason=>{i.townPositionRecovery={at:now,status:row?.status||'observing',reason};return 'town position recovery: '+reason;};
 if(row&&['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(row.status)){
  // A click/timeout is not a receipt. Require the exact later owned count and
  // fresh native position in the actual town rectangle before releasing work.
  if(i.catalog().build===row.build&&i.lastSaveAt>row.at&&i.livePos.at>row.at&&map.validTown(i,now)&&i.lastSave.consumables?.[item]===row.count-1){row.status='CONFIRMED';row.confirmedAt=now;if(!write())return report('confirmation journal busy');return report('native town position and owned wing count confirmed');}
  return report('awaiting original position/count receipt; no repeated use');
 }
 if(!map.inconsistentTown(i,now)||i.lastSave?.inTown!==true){i.townPositionMismatch=null;return null;}
 const observed=i.townPositionMismatch;
 if(!observed){i.townPositionMismatch={positionAt:i.livePos.at,saveAt:i.lastSaveAt,at:now};return report('field coordinates reported as town; awaiting second native observation');}
 if(i.livePos.at<=observed.positionAt||i.lastSaveAt<=observed.saveAt||now-observed.at<2000)return report('awaiting second native observation');
 const source=fs.readFileSync(path.join(i.cache.dir,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
 if(!require('./exp-boost').reviewedText(source)||!source.includes("'Butterfly Wing': { price: 50, reqLv: 1, town: true }"))return report('loaded native wing handler requires review');
 const count=i.lastSave.consumables?.[item];if(!Number.isInteger(count)||count<1)return report('no owned return wing; cannot repair by walking across non-walkable gap');
 if(!i.canDo('townPositionRecovery',60000))return report('bounded recovery cooldown');
 await i.expeditionAuto(false);
 row={at:Date.now(),build:i.catalog().build,status:'STARTED',count,position:{...i.livePos},evidence:'two_original_town_room_field_positions_and_saves'};
 if(!write())return report('journal busy; no use sent');
 try{
  const open=await i.openGamePanel('bag');
  const sent=open?.ok&&await i.eval(`(() => {const f=document.querySelector('#pBody [data-f="use"]');if(f)f.click();const tile=Array.from(document.querySelectorAll('#pBody .tile[data-k]')).find(b=>b.dataset.k==='c:Butterfly Wing');if(!tile)return false;tile.click();const use=document.querySelector('#itemPopBody [data-act="use"]');if(!use||use.disabled)return false;use.click();return true;})()`);
  row.status=sent?'WAITING_CONFIRMATION':'NOT_SENT';write();if(sent)i.pendingTravel=null;
 }catch(e){row.status='UNCERTAIN';write();}
 finally{await i.closeGamePanel();}
 return report(row.status);
}
module.exports={tick};
