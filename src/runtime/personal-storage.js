'use strict';
const fresh=require('./freshness');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function gate(i,{payment=null,action=null,ids=[]}={}){
 const deny=reason=>({allowed:false,reason}),state=fresh.decisionGate(i);
 if(i.livePos?.room!=='town')return deny('storage-town-required');
 if(!state.allowed)return deny('storage-'+state.reason);
 if(i.livePos.dead)return deny('storage-actor-dead');
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation)return deny('storage-team-activity-owns-navigation');
 if(i.pendingTravel||i.recycling||i.v2?.trial?.active())return deny('storage-travel-recovery-or-trial-active');
 if(i.v2?.sourceCoherence?.matches===false)return deny('storage-current-client-source-required');
 if(i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))return deny('storage-trade-awaiting-reconciliation');
 if(require('./equipment-headroom').developmentBlocks(i)||i.equipmentLedger?.pending()||require('./equipment-headroom').journalBlocks(i,Date.now(),payment)){
  if(!require('./storage-payment-scope').independent(i,{action,ids,payment}))return deny('storage-payment-awaiting-reconciliation');
 }
 return {allowed:true,reason:'storage-current-owned-state'};
}
function allowed(i,options){return gate(i,options).allowed;}
async function access(i,options){
 const first=gate(i,options);
 if(first.reason!=='storage-payment-awaiting-reconciliation'||!require('./storage-payment-scope').historyIndependent(i,options))return first;
 if(Date.now()-(i.storageReadbackAt||0)<30000)return {allowed:false,reason:'storage-current-session-readback-pending'};
 i.storageReadbackAt=Date.now();
 try{await require('./isolated-storage').readback(i);}catch{return {allowed:false,reason:'storage-native-readback-unavailable'};}
 return gate(i,options);
}
function protectedGear(i,id){
 const s=i.lastSave||{},it=i.catalog().items[id];
 return require('./storage-payment-scope').protectedId(i,id)||require('./equipment-headroom').uncertainGear(i,id)||!it||it.slot==='wing'||Object.values(s.equip||{}).includes(id)||s.locks?.includes(id)||s.refine?.[id]>0||s.stage?.[id]>0||s.holes?.[id]>0||s.sockets?.[id]?.length||s.weaponOpts?.[id]?.some(Boolean)||s.plk?.[id]?.some(Boolean);
}
async function read(i,side='bag'){
 const open=await i.openTownService('storage');if(!open?.ok)return {rows:[],reason:'storage-not-open'};
 await i.eval(`(() => {const b=document.querySelector('#pBody [data-store="mine"]');if(b&&!b.classList.contains('on'))b.click();const c=document.querySelector('#pBody [data-stc="gear"]');if(c&&!c.classList.contains('on'))c.click();const q=document.querySelector('#pBody .stx-find');if(q&&q.value){q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
 return i.eval(`(() => {const body=document.getElementById('pBody');if(body?.dataset.stView!=='mine|gear')return {rows:[],reason:'personal-gear-view-unverified'};const side=${JSON.stringify(side)};return {rows:Array.from(body.querySelectorAll('[data-sk]')).filter(b=>b.dataset.sk.startsWith(side+'|')).map(b=>({key:b.dataset.sk,id:(b.dataset.tip||'').replace(/^gu?:/,''),upgraded:(b.dataset.tip||'').startsWith('gu:'),blocked:b.disabled||b.classList.contains('no')}))};})()`);
}
function teamAccessoryTarget(i,id,now=Date.now()){
 const cat=i.catalog(),own=i.lastSave||{},trade=require('../planning/team-trade');
 if(cat.items[id]?.slot!=='acc'||trade.blockedGear(id,own,cat)||require('../gear-value').compare(own,cat,id).upgrade)return null;
 try{
  const fs=require('fs'),path=require('path'),other=require('os').platform()==='win32'?'tum':'windows',sources=['local',other].map(n=>JSON.parse(fs.readFileSync(path.join(i.root,'logs/fleet',n+'.json'),'utf8')));
  if(sources.some(s=>s.build!==cat.build||!fresh.fresh(s.at,15000,now)))return null;
  const roster=i.roster;if(roster?.length!==6||new Set(roster.map(m=>m.charName)).size!==6)return null;
  const members=sources.flatMap(s=>s.members||[]);if(roster.some(r=>members.filter(m=>m.charName===r.charName).length!==1))return null;
  const receivers=members.filter(m=>m.charName!==i.character?.name&&m.status==='playing'&&!m.recycling&&!m.actionOwner&&fresh.fresh(m.teamInventory?.at,30000,now)&&m.teamInventory.bagFree>=2).filter(m=>{const r=m.teamInventory;return !r.locks?.includes(id)&&!r.refine?.[id]&&!r.stage?.[id]&&!r.holes?.[id]&&!r.sockets?.[id]?.length&&!r.weaponOpts?.[id]?.some(Boolean);}).map(m=>({name:m.charName,comparison:require('../gear-value').compare(m.teamInventory,cat,id),save:m.teamInventory})).filter(r=>r.comparison.upgrade); // An upgrade can release the old accessory for a second teammate.

  receivers.sort((a,b)=>Number(!b.save.equip?.[b.comparison.slot])-Number(!a.save.equip?.[a.comparison.slot])||require('../equipment-goal').priority(b.comparison)-require('../equipment-goal').priority(a.comparison)||a.name.localeCompare(b.name));return receivers[0]||null;
 }catch{return null;}
}
async function supplyTeamAccessory(i){
 if(!allowed(i)||require('./equipment-headroom').space(i)?.free<3||!(i.lastSave?.storage?.gear||[]).some(g=>!g.lk&&!g.up&&teamAccessoryTarget(i,g.id)))return {moved:0};
 await i.expeditionAuto(false);await i.closeGamePanel();
 const plan=await i.planBag(i.roster),keep=new Set((plan.keep||[]).map(r=>r.id)),view=await read(i,'st');if(view.reason)return {moved:0,reason:view.reason};
 const choices=view.rows.filter(r=>!r.blocked&&!r.upgraded&&!keep.has(r.id)).map(r=>({...r,target:teamAccessoryTarget(i,r.id)})).filter(r=>r.target).sort((a,b)=>require('../equipment-goal').priority(b.target.comparison)-require('../equipment-goal').priority(a.target.comparison));
 const pick=choices[0];if(!pick)return {moved:0};const result=await move(i,[{id:pick.id,key:pick.key}],{side:'st',forTeam:true});
 if(result.moved)i.teamAccessorySupply={at:Date.now(),id:pick.id,receiver:pick.target.name,status:'withdrawal_observed',evidence:result.evidence,reason:'ถอนของสำรองเพื่อให้คิวเทรดเติมช่องว่าง;ยังไม่ถือว่าผู้รับสวมแล้ว'};
 return result;
}
async function expand(i){
 const permission=await access(i,{action:'capacity'});if(!permission.allowed)return {ok:false,reason:permission.reason};
 const save=i.lastSave||{},world=i.catalog().world||{},tier=save.storeTier,price=world.STORE_PRICES?.[tier]?.copper,cap=world.storeCap?.(tier);
 if(!Number.isInteger(tier)||!Number.isFinite(cap)||!Array.isArray(save.storage?.gear))return {ok:false,reason:'storage-capacity-unverified'};
 if(save.storage.gear.length<cap)return {ok:true,expanded:false};
 if(!Number.isFinite(price)||price<=0)return {ok:false,reason:'personal-storage-max-tier'};
 const wingCost=Math.max(0,...(i.endgameCampaign?.requirements||[]).filter(r=>r.name==='Copper').map(r=>Number(r.want)||0));
 const reserve=Math.max(require('../upgrade-reserve').reserve(save,world),wingCost+Math.max(1000,(save.lv||1)*100))+(require('./paid-actions').heldResources(i).Copper||0);
 if(!Number.isFinite(save.coins)||save.coins-price<reserve)return {ok:false,reason:'storage-upgrade-reserve-required'};
 const journal=i.v2?.journal||(i.bagJournal ||=new(require('./action-journal').ActionJournal)(i.root,i.credentials?.username||'slot-'+i.storageSlot));
 journal.observe(save,i.lastSaveAt);
 if(!gate(i,{action:'capacity'}).allowed)return {ok:false,reason:'previous-payment-awaiting-confirmation'};
 const row=journal.begin('storage-upgrade',{item:'personal-storage-capacity',fromTier:tier,price},save,Date.now(),i.catalog().build);
 if(!row)return {ok:false,reason:'previous-storage-upgrade-awaiting-confirmation'};
 try{
  const view=await read(i);if(view.reason||!allowed(i,{payment:row,action:'capacity'})){journal.sent(row,{ok:false,reason:view.reason||'storage-owner-changed'});return {ok:false,reason:row.reason};}
  const armed=await i.eval(`(() => {const body=document.getElementById('pBody');if(body?.dataset.stView!=='mine|gear')return false;const b=body.querySelector('[data-storeup="copper"]');if(!b||b.disabled||b.classList.contains('sure'))return false;b.click();return true;})()`);
  if(armed)await sleep(300);
  const current=i.lastSave||{},stillSafe=allowed(i,{payment:row,action:'capacity'})&&current.storeTier===tier&&current.coins-price>=reserve;
  const sent=armed&&stillSafe&&await i.eval(`(() => {const body=document.getElementById('pBody');if(body?.dataset.stView!=='mine|gear')return false;const b=body.querySelector('[data-storeup="copper"]');if(!b||b.disabled||!b.classList.contains('sure'))return false;b.click();return true;})()`);
  journal.sent(row,{ok:!!sent,reason:sent?null:'storage-upgrade-confirmation-unavailable'});
  if(!sent)return {ok:false,reason:row.reason};
  const until=Date.now()+15000;while(Date.now()<until&&row.status!=='CONFIRMED'){journal.observe(i.lastSave,i.lastSaveAt);await sleep(250);}
  return {ok:row.status==='CONFIRMED',expanded:row.status==='CONFIRMED',reason:row.status==='CONFIRMED'?null:'storage-tier-awaiting-confirmation',status:row.status,evidence:row.evidence};
 }catch(e){row.status='UNCERTAIN';row.reason='Storage upgrade outcome unknown; reconcile before retry';journal.save();throw e;}
}
async function move(i,wanted,{side='bag',forTeam=false}={}){
 const scope=side==='bag'&&!forTeam?{action:'deposit',ids:(wanted||[]).map(r=>r.id)}:{};
 const permission=await access(i,scope);if(!permission.allowed){
  if(side==='bag'&&!forTeam&&permission.reason==='storage-payment-awaiting-reconciliation'&&i.registryV32?.policy?.isolatedStorageCanaryActors?.includes(i.actorIdentity?.actorId))return require('./isolated-storage').deposit(i,wanted);
  return {moved:0,sent:false,reason:permission.reason};
 }
 if(side==='bag'&&Number.isInteger(i.lastSave?.storeTier)&&Array.isArray(i.lastSave?.storage?.gear)&&i.lastSave.storage.gear.length>=i.catalog().world?.storeCap?.(i.lastSave.storeTier)){const up=await expand(i);if(!up.ok)return {moved:0,reason:up.reason};}
 const opened=await read(i,side);if(opened.reason)return {moved:0,reason:opened.reason};
 let moved=0;const missed=[];
 for(const want of (wanted||[]).slice(0,6)){
  const id=want.id;if(!allowed(i,scope)||!id||side==='bag'&&protectedGear(i,id)){missed.push(id);continue;}
  // The previous move can fill the last storage slot during this same batch.
  // Recheck each step, expanding with the journaled copper path when possible.
  if(side==='bag'&&Number.isInteger(i.lastSave.storeTier)&&Array.isArray(i.lastSave.storage?.gear)&&i.lastSave.storage.gear.length>=i.catalog().world?.storeCap?.(i.lastSave.storeTier)){
   const up=await expand(i);if(!up.ok)return {moved,reason:up.reason,missed:[...missed,id]};
  }
  if(side==='st'&&(!(forTeam?teamAccessoryTarget(i,id):require('../gear-value').compare(i.lastSave,i.catalog(),id).upgrade)||require('./equipment-headroom').space(i)?.free<1)){missed.push(id);continue;}
  if(side==='st'&&forTeam){const idx=Number(want.key?.split('|')[1]),g=i.lastSave?.storage?.gear?.[idx];if(!Number.isInteger(idx)||!g||g.id!==id||g.lk||g.up){missed.push(id);continue;}}
  const before=i.lastSaveAt,count=(i.lastSave.bag||[]).filter(b=>(typeof b==='string'?b:b.id)===id).length;
  if(!Array.isArray(i.lastSave.storage?.gear))return {moved,reason:'personal-storage-save-unverified',missed:[...missed,id]};
  const storedCount=i.lastSave.storage.gear.filter(g=>g.id===id).length;
  const key=await i.eval(`(() => {const body=document.getElementById('pBody');if(body?.dataset.stView!=='mine|gear')return null;const b=Array.from(body.querySelectorAll('[data-sk]')).find(b=>b.dataset.sk.startsWith(${JSON.stringify(side+'|')})&&(${JSON.stringify(want.key||null)}===null||b.dataset.sk===${JSON.stringify(want.key||null)})&&(!${forTeam}||b.dataset.tip==='g:'+${JSON.stringify(id)})&&(b.dataset.tip==='g:'+${JSON.stringify(id)}||b.dataset.tip==='gu:'+${JSON.stringify(id)})&&!b.disabled&&!b.classList.contains('no'));if(!b)return null;const key=b.dataset.sk;if(!b.classList.contains('sel'))b.click();return key;})()`);
  // Selection re-renders the panel; recheck ownership and the exact selected tile.
  if(!key||!allowed(i,scope)||side==='bag'&&protectedGear(i,id)||side==='st'&&(!(forTeam?teamAccessoryTarget(i,id):require('../gear-value').compare(i.lastSave,i.catalog(),id).upgrade)||require('./equipment-headroom').space(i)?.free<1)){missed.push(id);continue;}
  const sent=await i.eval(`(() => {const body=document.getElementById('pBody');if(body?.dataset.stView!=='mine|gear')return false;const pick=body.querySelector('[data-sk].sel'),go=body.querySelector('[data-st-go]');if(pick?.dataset.sk!==${JSON.stringify(key)}||(!${forTeam}?(pick?.dataset.tip!=='g:'+${JSON.stringify(id)}&&pick?.dataset.tip!=='gu:'+${JSON.stringify(id)}):pick?.dataset.tip!=='g:'+${JSON.stringify(id)})||!go||go.disabled)return false;go.click();return true;})()`);
  if(!sent){missed.push(id);continue;}
  const until=Date.now()+10000;let observed=false;
  while(Date.now()<until){const n=(i.lastSave.bag||[]).filter(b=>(typeof b==='string'?b:b.id)===id).length,st=i.lastSave.storage?.gear;
   const stored=Array.isArray(st)?st.filter(g=>g.id===id).length:null;
   observed=i.lastSaveAt>before&&stored!==null&&(side==='bag'?n===count-1&&stored===storedCount+1:n===count+1&&stored===storedCount-1);if(observed)break;await sleep(250);}
  if(!observed)return {moved,reason:'awaiting-outgoing-save',missed:[...missed,id]};
  moved++;
 }
 return {moved,missed,evidence:moved?'outgoing_client_save':null,reason:moved?null:'no-confirmed-storage-move'};
}
async function restoreCampaignMaterial(i,plan){
 const missing=(plan.missing||[]).filter(r=>!r.protected&&Number.isInteger(r.want)&&r.want>0&&Number.isInteger(i.lastSave?.storage?.materials?.[r.name])&&i.lastSave.storage.materials[r.name]>0&&!i.lastSave.locks?.includes(r.name));
 if(!missing.length||i.v2?.sourceCoherence?.matches!==true||!allowed(i)||i.vitals?.hp<.95||!fresh.fresh(i.vitals?.at,15000))return null;
 const fs=require('fs'),path=require('path'),hash=require('crypto').createHash('sha256').update(i.character?.name||i.credentials?.charName||'slot-'+i.slot).digest('hex').slice(0,24);
 const file=path.join(i.root,'logs/storage-material',hash+'.json');
 let row;try{row=JSON.parse(fs.readFileSync(file));}catch{}
 if(row&&['DISPATCHING','UNCERTAIN'].includes(row.status)){
  const s=i.lastSave,n=s.materials?.[row.name]||0,st=s.storage?.materials?.[row.name];
  if(s.storage?.materials&&i.lastSaveAt>row.at&&row.build===i.catalog().build&&n===row.bag+row.quantity&&Number.isFinite(st??0)&&(st||0)===row.stored-row.quantity){row.status='OBSERVED';row.evidence='outgoing_client_save_bag_and_personal_storage_delta';require('./telemetry-file').writeTelemetry(file,row);}
  else return {moved:0,reason:'personal-material-move-awaiting-confirmation',status:row.status};
 }
 const need=missing[0],s=i.lastSave,bag=s.materials?.[need.name]||0,stored=s.storage.materials[need.name],quantity=Math.min(stored,Math.max(0,need.want-bag));
 if(!Number.isInteger(quantity)||quantity<=0)return null;
 const opened=await i.openTownService('storage');if(!opened?.ok)return {moved:0,reason:'storage-not-open'};
 try{
  await i.eval(`(() => {const b=document.querySelector('#pBody [data-store="mine"]');if(b&&!b.classList.contains('on'))b.click();const c=document.querySelector('#pBody [data-stc="mat"]');if(c&&!c.classList.contains('on'))c.click();const q=document.querySelector('#pBody .stx-find');if(q&&q.value){q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  if(!allowed(i)||i.lastSave.locks?.includes(need.name)||(i.lastSave.materials?.[need.name]||0)!==bag||i.lastSave.storage?.materials?.[need.name]!==stored)return {moved:0,reason:'storage-material-plan-changed'};
  row={build:i.catalog().build,name:need.name,bag,stored,quantity,at:Date.now(),status:'DISPATCHING'};
  fs.mkdirSync(path.dirname(file),{recursive:true});if(!require('./telemetry-file').writeTelemetry(file,row).ok)return {moved:0,reason:'storage-material-journal-unavailable'};
  const sent=await i.eval(`(() => {const body=document.getElementById('pBody');if(body?.dataset.stView!=='mine|mat')return false;const b=Array.from(body.querySelectorAll('[data-sk]')).find(b=>b.dataset.sk==='st|'+${JSON.stringify(need.name)});if(!b||b.disabled||b.classList.contains('no')||b.dataset.tip!=='m:'+${JSON.stringify(need.name)})return false;if(!b.classList.contains('sel'))b.click();const q=body.querySelector('[data-stq-in]'),pick=body.querySelector('.tile.sel[data-sk]'),go=body.querySelector('[data-st-go]');if(pick?.dataset.sk!==b.dataset.sk||!go||go.disabled||!q&&1!==${quantity})return false;if(q){q.value=${quantity};q.dispatchEvent(new Event('change',{bubbles:true}));}go.click();return true;})()`);
  row.status=sent?'UNCERTAIN':'NOT_SENT';require('./telemetry-file').writeTelemetry(file,row);
  if(!sent)return {moved:0,reason:'personal-material-button-not-verified'};
  const end=Date.now()+10000;while(Date.now()<end){const s=i.lastSave;if(s.storage?.materials&&i.lastSaveAt>row.at&&(s.materials?.[row.name]||0)===bag+quantity&&(s.storage?.materials?.[row.name]||0)===stored-quantity){row.status='OBSERVED';row.evidence='outgoing_client_save_bag_and_personal_storage_delta';require('./telemetry-file').writeTelemetry(file,row);return {moved:quantity,name:row.name,status:row.status,evidence:row.evidence};}await sleep(250);}
  return {moved:0,reason:'personal-material-move-awaiting-confirmation',status:row.status};
 }finally{await i.closeGamePanel();}
}
module.exports={allowed,gate,access,protectedGear,read,move,expand,teamAccessoryTarget,supplyTeamAccessory,restoreCampaignMaterial};
