'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
// Reviewed on a007be6, 3652b57 and 60936ca. Unrelated UI changes may proceed;
// changed item rules or native use/bag handlers require a fresh review.
// 2d1ccbf2: use adds VIP-card/Guardian-Stone branches (not these two items);
// bag adds only a refine-star display. EXP use/count/save and click are unchanged.
// 1a22dcb1: native PvE HP/MP/revive/status/food/tonic/ASPD/coat now use
// the server 'puse' protocol. Its predicate excludes both EXP items, whose
// count/buff/save path and exact rules remain unchanged; renderBag is identical.
// c21b2458: use/count/save is byte-identical to8cecf4ec. Bag adds card-pack
// shortcut, share button and RMAX display; use-tab/tile/use handlers unchanged.
const HANDLERS={useConsumable:['f8f66065a1922a33a0ad193339ae185d5588b36120efc5d4dd8428b80b40ade1','dffafdeb88bc87e215e9a10e977efacca7c4e9c940534a433cf021e1e4e08737','98f2ad49a8f9b9b6d53a1279740c9a7285bf456765916b21949ad835e9734f38'],renderBag:['80b044b5cc7982a4bb8deaa412984e92bbc95e7a5071842b3f9a8a7edce966cf','c25be5c812f0c13f07b3d7d3520fe566680f0dc8e74712b82828114798db847c']},cache=new Map();
HANDLERS.renderBag.push('e003bef54a72aff3d6e3a54ba2a032ffdeb420cceafe906f16af2287335edfc9');
const RULES={'Battle Manual':'price:0,reqLv:1,expBoost:0.5,dur:1800,dropOnly:true','Wisdom Elixir':'price:0,reqLv:1,expBoost:0.5,elixir:true,dur:3600,dropOnly:true,prem:true'};
function reviewedText(source){
 for(const [name,hashes] of Object.entries(HANDLERS)){
  const marker='  function '+name+'(',at=source.indexOf(marker),end=source.indexOf('\n  function ',at+marker.length);
  if(at<0||end<0||source.indexOf(marker,at+marker.length)!==-1||!hashes.includes(crypto.createHash('sha256').update(source.slice(at,end)).digest('hex')))return false;
 }
 const marker='const CONSUMABLES = {',at=source.indexOf(marker),end=source.indexOf('\n};',at);
 if(at<0||end<0||source.indexOf(marker,at+marker.length)!==-1)return false;
 const table=source.slice(at,end);
 for(const [name,rule] of Object.entries(RULES)){
  const rows=Array.from(table.matchAll(new RegExp("'"+name+"'\\s*:\\s*\\{([^{}]*)\\}",'g')));
  if(rows.length!==1||rows[0][1].replace(/\s/g,'')!==rule)return false;
 }
 return true;
}
function reviewed(i){try{const file=path.join(i.root,'cache',i.catalog().build,'asteria-online.io/asteria-online-visual-polish.html'),s=fs.statSync(file),stamp=s.size+':'+s.mtimeMs;if(cache.get(file)?.stamp!==stamp)cache.set(file,{stamp,ok:reviewedText(fs.readFileSync(file,'utf8'))});return cache.get(file).ok;}catch{return false;}}
function opportunity(s){return [['Battle Manual','manualT'],['Wisdom Elixir','elixirT']].find(([name,key])=>Number.isFinite(s[key])&&s[key]===0&&Number.isInteger(s.consumables?.[name])&&s.consumables[name]>0);}
function allowed(i,screen){return require('../planning/night-training').view(i).active&&i.goal?.monsterKind==='normal'&&i.goal.mapId===i.livePos?.room&&screen.autoOn==='true'&&!screen.death&&!screen.panelOpen&&!i.pendingTravel&&!i.teamControl&&!i.choresBusy&&!i.recycling&&!i.survivalRecovery&&!i.dailyTeamPending&&!require('./room-policy').roomPolicy(i.livePos?.room).dungeon&&i.v2?.sourceCoherence?.matches!==false&&require('./freshness').decisionGate(i).allowed;}
async function tick(i,screen){
 if(!allowed(i,screen))return null;
 const name=i.character?.name||'slot-'+i.slot,file=path.join(i.root,'logs/exp-boost',crypto.createHash('sha256').update(name).digest('hex').slice(0,24)+'.json');
 let row;try{row=JSON.parse(fs.readFileSync(file));}catch{}
 const write=r=>{fs.mkdirSync(path.dirname(file),{recursive:true});return require('./telemetry-file').writeTelemetry(file,r);};
 if(row&&['STARTED','WAITING_CONFIRMATION'].includes(row.status)){
  const confirmed=i.lastSaveAt>row.at&&i.lastSave[row.key]>0&&i.lastSave.consumables?.[row.name]===row.count-1;
  if(confirmed){row.status='CONFIRMED';row.confirmedAt=i.lastSaveAt;write(row);i.expBoostStatus={at:Date.now(),status:'CONFIRMED',name:row.name,evidence:'native_buff_and_owned_count_change'};}else{i.expBoostStatus={at:Date.now(),status:'waiting_confirmation_no_replay',name:row.name};return null;}
 }
 if(!reviewed(i)||!i.canDo('expBoost',60000))return null;
 const pick=opportunity(i.lastSave);if(!pick)return null;
 const [item,key]=pick;row={at:Date.now(),build:i.catalog().build,name:item,key,count:i.lastSave.consumables[item],status:'STARTED'};
 if(!write(row)?.ok)return null;
 await i.expeditionAuto(false);
 try{
  const open=await i.openGamePanel('bag');
  const sent=open?.ok&&await i.eval(`(() => {const f=document.querySelector('#pBody [data-f="use"]');if(f)f.click();const tile=Array.from(document.querySelectorAll('#pBody .tile[data-k]')).find(b=>b.dataset.k===${JSON.stringify('c:'+item)});if(!tile)return false;tile.click();const use=document.querySelector('#itemPopBody [data-act="use"]');if(!use||use.disabled)return false;use.click();return true;})()`);
  row.status=sent?'WAITING_CONFIRMATION':'NOT_SENT';write(row);i.expBoostStatus={at:Date.now(),name:item,status:row.status,evidence:'owned_consumable_native_UI_then_save_confirmation_no_purchase'};
  return 'EXP boost: '+row.status;
 }finally{await i.closeGamePanel();if(require('./freshness').decisionGate(i).allowed&&!i.livePos?.dead&&i.livePos?.room===i.goal?.mapId)await i.expeditionAuto(true);}
}
module.exports={tick,opportunity,allowed,reviewed,reviewedText};
