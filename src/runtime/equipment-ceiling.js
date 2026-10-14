'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const checked=new Map();
function ownershipClear(i){return !i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.v2?.trial?.active()&&(!i.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase));}
const drillRegion={1:['Boar Leaf','rootmother','Ancient Bark'],2:['Worm Carapace','king_ahmrak','Pharaoh Gold'],3:['Warden Core','frostwyrm_glacius','Wyrm Scale'],4:['Behemoth Horn','ignar_the_flame_tyrant','Tyrant Ember'],5:['Morvane Chain','nyxara_queen_of_the_abyss','Abyss Crystal'],6:['Morvane Chain','nyxara_queen_of_the_abyss','Abyss Crystal'],7:['Titan Stormhorn','aetheris_sky_sovereign','Sovereign Starheart']};
function drillCost(s,cat){const q=s.drill,it=cat.items[q?.id];if(!q||!it)return null;const t=Math.max(1,Math.min(7,it.tier||1)),region=drillRegion[t],ore=cat.world.REFINE.ore(t);return q.hole===1?{Copper:t*20000,[ore]:20,[region[0]]:t===1?30:1}:{Copper:t*50000,[ore]:40,[region[2]]:1,'Ancient Rune':1};}
function drillReady(s,cat){const q=s.drill,cost=drillCost(s,cat);if(!cost||!Object.values(s.equip||{}).includes(q.id)||(s.holes?.[q.id]||0)+1!==q.hole)return false;if(!(q.hole===1?q.kills>=q.need:q.bossDone))return false;const have=require('./paid-actions').inventory(s,cat);return Object.entries(cost).every(([k,n])=>(have[k]||0)>=n);}
async function drillAction(i,r,start){
 const ledger=i.developmentLedger ||=new(require('../result-ledger').ResultLedger)(i.actorStateRoot||i.root,i.actorIdentity?.actorId||(i.storageSlot??i.slot)),kind=start?'drill-quest':'drill';if(ledger.blocking(kind))return null;
 const open=await i.openTownService('smithShop');if(!open?.ok)return null;
 await i.eval(`(() => {document.querySelector('#pBody [data-smith="drill"]')?.click();})()`);
 const s=i.lastSave,cat=i.catalog();if(!ownershipClear(i)||!require('./freshness').decisionGate(i).allowed||s.equip?.[r.slot]!==r.id||(start?!!s.drill:!drillReady(s,cat))){await i.closeGamePanel();return null;}
 const row=ledger.begin(kind,{id:r.id},s,Date.now(),true);if(!row)return null;
 try{const selector=start?'#pBody [data-drill='+JSON.stringify(r.id)+']':'#pBody [data-drill-go]';const sent=await i.eval(`(() => {const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)return false;b.click();return true;})()`);if(!sent)ledger.cancel(row.id,'native drill command not sent');for(let n=0;sent&&n<20&&!row.observedStatus;n++){await new Promise(resolve=>setTimeout(resolve,500));ledger.observe(i.lastSave,i.lastSaveAt);}ledger.seal(row.id);i.onBrainReport?.('เจาะรู '+r.name+' · '+row.status);return sent?'equipment '+kind+': '+row.status:null;}catch(e){ledger.seal(row.id);throw e;}finally{await i.closeGamePanel();}
}
function reviewed(i){try{
 const dir=i.cache.dir,file=path.join(dir,'asteria-online.io','asteria-online-visual-polish.html'),world=path.join(dir,'asteria-online.io','asteria-world-system.js');const key=dir+fs.statSync(file).mtimeMs+fs.statSync(world).mtimeMs;if(checked.has(key))return checked.get(key);
 const text=fs.readFileSync(file,'utf8'),a=text.indexOf('const DRILL_REGION'),b=text.indexOf('// Equipment shop',a);
 // Review the rules used by these commands, rather than unrelated monster or
 // catalog edits. 8e94a59/736f7d7 add an enchant response and daily stage counter
 // to the client region; forge/drill prices, dispatch and confirmations are unchanged.
 const source=fs.readFileSync(world,'utf8'),scopes=[['const FORGE=(()=>{','})();',5],['const REFINE={',';',1],['function maxHoles(e)','\n',0]].map(([start,end,n])=>{const x=source.indexOf(start),y=source.indexOf(end,x);if(x<0||y<=x)throw Error('missing native equipment rules');return source.slice(x,y+n);});
 const ok=a>=0&&b>a&&['9a8c89d5f18c5afd5e197e8e3a612796154b349f999fa94a9d8c86fda0a58fa9','3f221f09f16fca393c44876ca07f9ce132202e9033011255e93f107360c7afc3'].includes(hash(text.slice(a,b)))&&hash(scopes.join('\n'))==='4443b6707920167c3a2c7e8b7efaf6367cb046085a3bc9ed8546e486eb2c6bd6';checked.clear();checked.set(key,ok);return ok;
 }catch{return false;}}
async function forgeAction(i,task){
 const ledger=i.developmentLedger ||=new(require('../result-ledger').ResultLedger)(i.actorStateRoot||i.root,i.actorIdentity?.actorId||(i.storageSlot??i.slot));if(ledger.blocking(task.kind))return null;
 const open=await i.openTownService('smithShop');if(!open?.ok)return null;
 await i.eval(`(() => {document.querySelector('#pBody [data-smith="forge"]')?.click();document.querySelector('#pBody [data-fsub="'+${JSON.stringify(task.kind==='forge-essence'?'ess':'frag')}+'"]')?.click();})()`);
 const cat=i.catalog(),wiki=require('../economy').loadWiki(i.root),s=i.lastSave,current=require('../planning/forge-materials').next(s,cat,wiki,require('../planning/equipment-ceiling').assess(s,cat,wiki));
 if(!ownershipClear(i)||!require('./freshness').decisionGate(i).allowed||!current||JSON.stringify(current)!==JSON.stringify(task)){await i.closeGamePanel();return null;}
 const row=ledger.begin(task.kind,{name:task.name},s,Date.now(),true);if(!row)return null;
 try{const sent=await i.eval(`(() => {const box=document.querySelector('#pBody [data-fq='+${JSON.stringify(JSON.stringify(task.key))}+']'),input=box?.querySelector('input'),b=box?.querySelector('[data-fgo]');if(!input||!b||b.disabled)return false;input.value='1';input.dispatchEvent(new Event('change',{bubbles:true}));b.click();return true;})()`);if(!sent)ledger.cancel(row.id,'native forge not sent');for(let n=0;sent&&n<20&&!row.observedStatus;n++){await new Promise(resolve=>setTimeout(resolve,500));ledger.observe(i.lastSave,i.lastSaveAt);}ledger.seal(row.id);return sent?'forge '+task.name+': '+row.status:null;}catch(e){ledger.seal(row.id);throw e;}finally{await i.closeGamePanel();}
}
function cardPlan(i,rows){
 const file=path.join(i.cache.dir,'asteria-online.io','asteria-online-visual-polish.html');if(!['ba36d6593be5b27259cc03bbffe3e32443a9fb77ce77e26c1fe7d52a3696e546','c6fc8bf415a53916e26555e9b10fee215dfaca2f8d81dead8316bfdc18efd049'].includes(hash(fs.readFileSync(file))))return null;
 const s=i.lastSave,cat=i.catalog(),gear=require('../gear-value'),before=gear.totals(s,cat),options=[];if(before.unknown.length)return null;
 for(const r of rows){if(r.target||!r.id||!Array.isArray(r.sockets)||r.sockets.some(x=>!x)||r.sockets.length>=r.holes)continue;
  for(const [id,n]of Object.entries(s.cards||{})){const c=gear.card(id,cat.world),type=cat.items[r.id].slot;if(!(n>0)||!c||!(c.slot===type||type==='acc'&&['head','boots'].includes(c.slot)))continue;
   // Elemental armour changes incoming damage; weighted stats cannot prove it safe.
   if(type==='armor'&&cat.world.elementKey?.(cat.world.getMonster(id)?.element)!=='neutral')continue;
   const after=gear.totals({...s,sockets:{...s.sockets,[r.id]:[...r.sockets,id]}},cat);if(!after.unknown.length&&after.score>before.score)options.push({build:cat.build,locked:true,item:r.id,card:id,index:r.sockets.length,gain:after.score-before.score});
  }
 }
 return options.sort((a,b)=>b.gain-a.gain)[0]||null;
}
async function tick(i,screen){
 if(!i.lastSave||!i.canDo('equipmentCeilingPlan',30000))return null;
 const cat=i.catalog(),s=i.lastSave;i.equipmentCeiling=require('../planning/equipment-ceiling').assess(s,cat,require('../economy').loadWiki(i.root));
 if(!require('../planning/progression-priority').assess(s,cat).equipmentAllowed)return null;
 if(i.equipmentCeiling.goal&&!i.equipmentCeiling.goal.complete)return null;
 if(i.endgameCampaign?.phase!=='complete'||!ownershipClear(i)||i.pendingTravel||i.choresBusy||screen.death||screen.panelOpen||!require('./freshness').decisionGate(i).allowed||!reviewed(i)||!Number.isFinite(i.vitals?.hp)||i.vitals.hp<.8)return null;
 if(i.livePos?.room!=='town'){if(drillReady(s,cat)&&i.canDo('equipmentDrillReturn',60000)){await i.expeditionAuto(false);await i.returnToTown();return 'completed drill quest: return to blacksmith';}return null;}
 if(!i.canDo('equipmentStageAttempt',120000))return null;
 // Do not pay to permanently bind an item when a better catalog target is known.
 const rows=i.equipmentCeiling.rows,q=s.drill;
 if(i.v2?.trial?.active())return null;
 if(drillReady(s,cat)){const r=rows.find(r=>r.id===q.id);if(r)return drillAction(i,r,false);}
 const card=cardPlan(i,rows);if(card){try{const result=await i.insertPlannedCard(card);return result?.ok?'card sent: awaiting socket/card save proof':null;}finally{await i.closeGamePanel();}}
 const forge=require('../planning/forge-materials').next(s,cat,require('../economy').loadWiki(i.root),i.equipmentCeiling);if(forge&&i.goal?.kind!=='team-gather')return forgeAction(i,forge);
 const r=rows.find(r=>!r.target&&r.stageNext?.ready);
 if(!r){if(!q){const next=rows.find(r=>!r.target&&r.tier>=6&&Number.isFinite(r.holes)&&r.holes<r.holesMax);if(next)return drillAction(i,next,true);}return null;}
 const ledger=i.developmentLedger ||=new(require('../result-ledger').ResultLedger)(i.actorStateRoot||i.root,i.actorIdentity?.actorId||(i.storageSlot??i.slot));
 ledger.observe(s,i.lastSaveAt);if(ledger.blocking('stage'))return null;
 const open=await i.openTownService('smithShop');if(!open?.ok)return null;
 await i.eval(`(() => {document.querySelector('#pBody [data-smith="stage"]')?.click();})()`);
 const before=i.lastSave;if(!ownershipClear(i)||before.equip?.[r.slot]!==r.id||!require('./freshness').decisionGate(i).allowed){await i.closeGamePanel();return null;}
 const current=require('../planning/equipment-ceiling').assess(before,cat,require('../economy').loadWiki(i.root)).rows.find(x=>x.slot===r.slot);
 if(!current.stageNext?.ready||current.stage!==r.stage){await i.closeGamePanel();return null;}
 const row=ledger.begin('stage',{id:r.id,to:r.stageNext.to},before,Date.now(),true);if(!row)return null;
 let sent=false;
 try{
  const selector='#pBody [data-stup='+JSON.stringify(r.id)+']';
  const hit=await i.eval(`(() => {const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)return false;b.click();return true;})()`);
  if(hit&&(r.stageNext.chance<1||r.stageNext.copy)){await new Promise(resolve=>setTimeout(resolve,550));sent=await i.eval(`(() => {const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled||!b.classList.contains('warn'))return false;b.click();return true;})()`);}else sent=hit;
  if(!sent)ledger.cancel(row.id,'native stage button not sent');
  for(let n=0;sent&&n<20&&row.status==='pending'&&!row.observedStatus;n++){await new Promise(resolve=>setTimeout(resolve,500));ledger.observe(i.lastSave,i.lastSaveAt);}
  ledger.seal(row.id);i.onBrainReport?.('อัปขั้น '+r.name+' ★'+r.stageNext.to+' · '+row.status);return sent?'equipment stage: '+row.status:null;
 }catch(e){ledger.seal(row.id);throw e;}finally{await i.closeGamePanel();}
}
module.exports={tick,reviewed,drillCost,drillReady,cardPlan,ownershipClear};
