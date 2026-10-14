'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),fresh=require('./freshness');
// Long native map walks suspend the action tick. Keep HP upkeep inside the
// exact route owner; an unknown potion outcome never authorizes another click.
async function check(i,key,{sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const now=Date.now(),held=()=>require('./assistance-reservation').state(i);
 if(!key||held()?.assignment.key!==key||i.livePos?.dead||i.v2?.sourceCoherence?.matches!==true)return false;
 if(typeof i.screen!=='function'||typeof i.eval!=='function')return false;
 if(i.canDo('assistanceTransitHealth',5000)){
  const s=await i.screen();i.vitals=require('../team-readiness').vitals(s);
  if(s.death||s.panelOpen)return false;
 }
 if(!fresh.decisionGate(i).allowed||!fresh.fresh(i.vitals?.at,10000)||!Number.isFinite(i.vitals.hp)||i.vitals.hp<.35||held()?.assignment.key!==key)return false;
 if(i.vitals.hp>=.75)return true;
 const name=i.character?.name;if(!name)return false;
 const file=path.join(i.root,'logs/assistance-transit',crypto.createHash('sha256').update(name).digest('hex').slice(0,24)+'.json');
 let prior;try{prior=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')return false;}
 if(prior&&['STARTED','WAITING_CONFIRMATION','UNCERTAIN'].includes(prior.status))return false;
 if(require('./survival').hpPots(i.lastSave)<43||!i.canDo('assistanceTransitPotion',5000))return false;
 const room=i.livePos.room,stock=require('./survival').hpPots(i.lastSave),before=i.vitals.currentHp;
 const row={at:Date.now(),key,build:i.catalog().build,room,beforeHp:before,beforeStock:stock,status:'STARTED'};
 const write=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});return require('./telemetry-file').writeTelemetry(file,row).ok;};
 if(!write())return false;
 try{
  const clicked=await i.eval(`(() => {const b=Array.from(document.querySelectorAll('#hotbar .slot')).find(b=>b.querySelector('.k')?.textContent==='R');if(!b||b.hidden||b.disabled||b.querySelector('.cdn')?.textContent.trim()||Number(b.style.opacity||1)<1)return false;b.click();return true;})()`);
  row.status=clicked?'WAITING_CONFIRMATION':'NOT_SENT';if(!write()||!clicked)return false;
  const end=Date.now()+3500;
  while(Date.now()<end){
   await sleep(350);const s=await i.screen();i.vitals=require('../team-readiness').vitals(s);
   if(s.death||i.livePos?.room!==room)break;
   if(i.vitals.currentHp>before||i.lastSaveAt>row.at&&require('./survival').hpPots(i.lastSave)<stock){
    row.status='CONFIRMED';row.observedAt=Date.now();row.afterHp=i.vitals.currentHp;row.afterStock=require('./survival').hpPots(i.lastSave);row.evidence='native_HUD_or_fresh_owned_stock';if(!write())return false;
    i.assistanceTransitStatus={...row};return held()?.assignment.key===key&&i.vitals.hp>=.35;
   }
  }
  row.status='UNCERTAIN';row.reason='owned potion effect not observed; no replay';write();i.assistanceTransitStatus={...row};return false;
 }catch{row.status='UNCERTAIN';row.reason='dispatch outcome unknown; no replay';write();i.assistanceTransitStatus={...row};return false;}
}
module.exports={check};
