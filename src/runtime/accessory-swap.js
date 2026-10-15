'use strict';
const gear=require('../gear-value');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(i,test,after){
 for(let n=0;n<30;n++){if(i.lastSaveAt>after&&test(i.lastSave))return true;await pause(400);}return false;
}
async function wear(i,id,slot,retained){
 const name=i.catalog().items[id]?.name,owned=i.lastSave.bag.find(x=>(typeof x==='string'?x:x.id)===id);
 if(!name||!owned)return false;
 const uid=Number.isInteger(owned.uid)?String(owned.uid):null;
 const other=slot==='acc1'?'acc2':'acc1',retainedName=catName(i,retained);
 const nativeGuard=`const empty=document.querySelector('#pBody .eslot[data-k="slot:${slot}"]'),other=document.querySelector('#pBody .eslot[data-k="slot:${other}"] .eslot-n');if(!empty?.classList.contains('empty')||other?.textContent!==${JSON.stringify(retainedName)})return false;`;
 const hit=await i.eval(`(() => {${nativeGuard}const b=Array.from(document.querySelectorAll('#pBody .tile[data-k]')).find(b=>/^[0-9]+$/.test(b.dataset.k)&&(${JSON.stringify(uid)}!==null?b.dataset.k===${JSON.stringify(uid)}:b.title===${JSON.stringify(name)}||b.querySelector('.ico[data-tipn]')?.dataset.tipn===${JSON.stringify(name)}));if(!b)return false;b.click();return true;})()`);
 if(!hit)return false;await pause(450);
 return i.eval(`(() => {${nativeGuard}const p=document.getElementById('itemPop'),b=document.querySelector('#itemPopBody [data-act="equip"]');if(!p||p.hidden||!b||b.disabled)return false;b.click();return true;})()`);
}
const catName=(i,id)=>i.catalog().items[id]?.name;
// Native keyFor selects acc1 when both slots are occupied. Make the requested
// slot the only empty one, keep the other item, and verify each save boundary.
async function replace(i,want){
 const empiricalBefore=i.combatEvidence?.view(i)?.current||null;
 const s=i.lastSave,cat=i.catalog(),comparison=gear.compare(s,cat,want.id),slot=comparison.slot;
 if(!comparison.upgrade||!['acc1','acc2'].includes(slot)||slot!==want.slot)return {equipped:0,reason:'accessory-plan-changed'};
 const other=slot==='acc1'?'acc2':'acc1',old=s.equip[slot],retained=s.equip[other];
 if(!old||!retained)return {equipped:0,reason:'accessory-slots-changed'};
 if(!Array.isArray(s.bag)||s.bag.length>=cat.world.bagCap(s.bagTier)||!s.bag.some(x=>(typeof x==='string'?x:x.id)===want.id))return {equipped:0,reason:'accessory-needs-bag-space'};
 const at=Date.now();
 const opened=await i.eval(`(() => {const b=document.querySelector('#pBody .eslot[data-k="slot:${slot}"]');if(!b)return false;b.click();return true;})()`);
 if(!opened)return {equipped:0,reason:'accessory-slot-not-open'};await pause(450);
 if(i.lastSave.equip[slot]!==old||i.lastSave.equip[other]!==retained)return {equipped:0,reason:'accessory-state-changed'};
 const detached=await i.eval(`(() => {const p=document.getElementById('itemPop'),b=document.querySelector('#itemPopBody [data-act="unequip"]');if(!p||p.hidden||!b||b.disabled)return false;b.click();return true;})()`);
 if(!detached)return {equipped:0,reason:'accessory-not-detached'};
 if(!await wait(i,x=>!x.equip?.[slot]&&x.equip?.[other]===retained&&x.bag?.some(b=>(typeof b==='string'?b:b.id)===old),at))return {equipped:0,reason:'accessory-detach-outcome-unknown'};
 const sentAt=Date.now(),sent=await wear(i,want.id,slot,retained);
 if(sent&&await wait(i,x=>x.equip?.[slot]===want.id&&x.equip?.[other]===retained,sentAt))return {equipped:1,slot,id:want.id,combatBaseline:empiricalBefore?{id:empiricalBefore.id,loadoutSignature:empiricalBefore.loadoutSignature,dps:empiricalBefore.dps,killsPerHour:empiricalBefore.killsPerHour,deaths:empiricalBefore.deaths}:null,benefitMeasured:false,evidence:'outgoing_client_save'};
 // Restore only a proven empty slot. An unknown/non-empty state is left for
 // fresh reconciliation, never overwritten or reported as an upgrade.
 if(!i.lastSave.equip[slot]&&i.lastSave.equip[other]===retained&&Date.now()-i.lastSaveAt<30000){const restoreAt=Date.now(),restored=await wear(i,old,slot,retained);if(restored&&await wait(i,x=>x.equip?.[slot]===old&&x.equip?.[other]===retained,restoreAt))return {equipped:0,reason:'accessory-restored-after-failed-swap'};}
 return {equipped:0,reason:'accessory-swap-outcome-unknown'};
}
function reversesRecentSwap(ledger,slot,id,now=Date.now()){
 return ledger?.rows?.some(r=>r.kind==='equip'&&r.status==='change_observed'&&Number.isFinite(r.finishedAt)&&now-r.finishedAt>=0&&now-r.finishedAt<600000&&r.before?.equip?.[slot]===id&&r.after?.equip?.[slot]&&r.after.equip[slot]!==id)||false;
}
module.exports={replace,reversesRecentSwap};
