'use strict';
const fs=require('fs'),path=require('path'),tables=new Map();
function quantileRate(rows,q){const rates=rows.filter(r=>r.ms>0&&Number.isFinite(r.used)&&r.used>=0).map(r=>r.used*60000/r.ms).sort((a,b)=>a-b);return rates.length?rates[Math.min(rates.length-1,Math.ceil(rates.length*q)-1)]:0;}
function prices(i){
 const build=i.catalog().build,key=i.root+':'+build;if(tables.has(key))return tables.get(key);
 if(!/^[\w-]{1,80}$/.test(build||''))return [];
 const html=fs.readFileSync(path.join(i.root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
 const rows=['Red Potion','Orange Potion','Yellow Potion','White Potion'].map(name=>{
  const match=html.match(new RegExp("'"+name+"':\\s*\\{\\s*price:\\s*(\\d+),\\s*reqLv:\\s*(\\d+),\\s*hp:\\s*(\\d+)\\s*\\}"));
  return match?{name,price:Number(match[1]),lv:Number(match[2]),hp:Number(match[3])}:null;
 }).filter(r=>r&&r.price>0&&r.hp>0);
 if(tables.size>8)tables.clear();tables.set(key,rows);return rows;
}
function choice(i,minimum,{reserveCoins=0}={}){
 const s=i.lastSave||{},missing=Math.max(1,minimum-require('./survival').hpPots(s));let rows;
 const available=s.coins-Math.max(0,reserveCoins)-Number(require('./paid-actions').heldResources(i).Copper||0);
 try{rows=prices(i).filter(r=>r.lv<=s.lv&&!(i.v2?.journal?.supplyBlock?i.v2.journal.supplyBlock(r.name,s,{minimum,limit:Math.min(20,missing),at:Date.now(),saveAt:i.lastSaveAt,sessionStartedAt:i.bagSessionStartedAt}):i.v2?.journal?.pending(r.name))&&available>=r.price);}catch{return null;}
 return rows.filter(r=>available>=missing*r.price).sort((a,b)=>b.hp-a.hp)[0]||rows.sort((a,b)=>a.price-b.price)[0]||null;
}
function manaChoice(i){
 try{
  const s=i.lastSave||{},text=fs.readFileSync(path.join(i.root,'cache',i.catalog().build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8'),reserve=Math.max(1000,(s.lv||1)*100);
  const rows=['Blue Potion','Sapphire Potion','Starlight Potion'].map(name=>{
   const match=text.match(new RegExp("'"+name+"':\\s*\\{\\s*price:\\s*(\\d+),\\s*reqLv:\\s*(\\d+),\\s*mp:\\s*(\\d+)\\s*\\}"));
   return match?{name,price:Number(match[1]),lv:Number(match[2]),mp:Number(match[3])}:null;
  }).filter(r=>r&&r.price>0&&r.mp>0&&r.lv<=s.lv&&s.coins-reserve>=r.price&&!i.v2?.journal?.pending(r.name));
  return rows.sort((a,b)=>b.mp-a.mp)[0]||null;
 }catch{return null;}
}
function hpBatch(i,now=Date.now()){
 const s=i.lastSave||{},build=i.catalog().build,at=i.lastSaveAt,pots=require('./survival').hpPots(s),room=i.livePos?.room;
 if(!Number.isFinite(at)||at>now||now-at>=30000||!require('./freshness').fresh(i.livePos?.at,10000,now))return {limit:20,target:20,reason:'waiting_for_fresh_supply'};
 let w=i.hpSupplyWindow;if(!w||w.build!==build)w=i.hpSupplyWindow={build,previous:null,rows:[]};
 const p=w.previous;
 if(!p||at>p.at){
  if(p&&room!== 'town'&&p.room===room&&at-p.at<=30000&&pots<=p.pots&&p.pots-pots<=80)w.rows.push({at,ms:at-p.at,used:p.pots-pots});
  w.previous={at,pots,room};
 }
 w.rows=w.rows.filter(r=>now-r.at<720000);
 const ms=w.rows.reduce((n,r)=>n+r.ms,0),used=w.rows.reduce((n,r)=>n+r.used,0),rate=ms>0?used/ms*60000:null;
 // A bounded twelve-minute stock window amortizes town travel. Only observed
 // consumption can expand the normal batch; emergency spending still uses
 // the existing minimum policy and all purchase/no-replay guards.
 const measured=w.rows.length>=3&&ms>=30000&&used>0;
 const p90=measured?quantileRate(w.rows,.9):null;const target=measured?Math.max(20,Math.min(80,Math.ceil(Math.max(rate,p90)*12))):20;
 return {limit:measured?Math.max(1,target-pots):20,target,samples:w.rows.length,minutes:ms/60000,potsPerMinute:measured?rate:null,reason:measured?'native_consumption_12min_stock_capped80':'collecting_native_consumption'};
}
function essentialReserve(i){
 const s=i.lastSave||{},cat=i.catalog(),upkeep=Math.max(1000,(s.lv||1)*100);
 const promotion=Math.max(0,require('../upgrade-reserve').reserve(s,cat.world)-upkeep);
 const milestone=require('./class-boss-probe').milestone(i);
 const ready=i.endgameCampaign?.phase==='class'||i.endgameCampaign?.ready===true;
 return Math.max(1000,promotion,ready?milestone?.coins||0:0);
}
function hpRefill(i,supply,now=Date.now(),bucket='hpMilestoneRefill'){
 if(!supply){i[bucket]=null;return null;}
 const build=i.catalog().build,session=i.v2?.observations?.sessionId||null,pots=require('./survival').hpPots(i.lastSave||{});
 const minimum=supply.minimum,target=Math.max(minimum,Math.min(80,Number.isFinite(supply.target)?supply.target:minimum));
 let intent=i[bucket];
 if(intent&&(intent.build!==build||intent.session!==session||now<intent.startedAt||now-intent.startedAt>=900000))intent=null;
 if(intent&&pots>=intent.target)intent=null;
 if(pots<minimum&&!intent)intent={build,session,startedAt:now,target};
 if(intent)intent.target=Math.max(intent.target,target);
 i[bucket]=intent;
 return {trigger:minimum,target:intent?.target||target,minimum:intent?.target||minimum,refilling:!!intent};
}
function ordinaryRefill(i,batch,now=Date.now()){
 const bucket='hpOrdinaryRefill',s=i.lastSave||{},minimum=s.lv>=i.catalog().world.MAX_LV?20:10;
 if(i.v2?.sourceCoherence?.matches!==true||!require('./freshness').decisionGate(i,now).allowed){i[bucket]=null;return null;}
 const target=Math.max(20,Math.min(80,Number.isFinite(batch?.target)?batch.target:20));
 const plan=hpRefill(i,{minimum,target},now,bucket);if(!plan.refilling)return null;
 const reserve=require('../upgrade-reserve').reserve(s,i.catalog().world),held=Number(require('./paid-actions').heldResources(i).Copper||0);
 const item=choice(i,plan.minimum,{reserveCoins:reserve}),missing=Math.max(0,plan.minimum-require('./survival').hpPots(s));
 // Optional stock may never turn poor/held wallets into an endless town owner.
 // First-ten essential refill remains separate; all paid actions still journal.
 if(!item||s.coins-reserve-held<missing*item.price){i[bucket]=null;return null;}
 return {...plan,reserve};
}
function bootstrap(i,wiki,now=Date.now()){
 const s=i.lastSave||{},hp=require('./survival').hpPots(s),rows=prices(i).filter(r=>r.lv<=s.lv);
 const available=s.coins-essentialReserve(i)-Number(require('./paid-actions').heldResources(i).Copper||0);
 // Use the same protected wallet as actual purchases. An apparent 98 Copper
 // cannot buy supplies when it is already covered by durable reservations.
 // This hunt spends nothing; old closed-session known potion uncertainties
 // remain quarantined rather than blocking unrelated, proven starter kills.
 if(s.lv<30||hp<1||hp>=10||!rows.length||available>=Math.min(...rows.map(r=>r.price))*(10-hp)||!require('./freshness').fresh(i.lastSaveAt,30000,now)||!require('./freshness').fresh(i.vitals?.at,15000,now)||i.vitals.hp<.95||i.survivalRecovery||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.choresBusy||i.pendingTravel||i.v2?.trial?.active()||i.v2?.sourceCoherence?.matches===false||require('../learning/experiment-governor').routePaymentBlocks(i,now)||require('./equipment-headroom').developmentBlocks(i,now))return null;
 const blocked=i.brain?.blocked?.(now)||{},deaths=i.brain?.data?.deaths||{};
 for(const map of wiki?.maps?.maps||[]){
  if(map.kind!=='field'||map.bossRoom||!Number.isFinite(map.levelMax)||map.levelMax>15||blocked[map.id]||(deaths[map.id]||[]).some(at=>at<=now&&now-at<1800000))continue;
  const monster=(wiki.monsters?.monsters||[]).find(m=>m.kind==='normal'&&m.level<=8&&m.level<=s.lv-25&&map.monsters?.normal?.includes(m.id)&&s.bestiary?.[m.id]>0);
  if(monster&&s.lv>=i.catalog().world.MAX_LV){const native=i.catalog().world.MONSTERS?.find(m=>m.id===monster.id);if((map.monsters?.boss||[]).length||(map.monsters?.miniboss||[]).length||!native||native.kind!=='normal'||native.level!==monster.level||!Number.isFinite(native.atk)||native.atk<=0||!Number.isFinite(i.vitals.maxHp)||i.vitals.maxHp<native.atk*8||i.v2?.sourceCoherence?.matches!==true)continue;}
  if(monster)return {at:now,until:now+600000,bootstrap:true,goal:{kind:'survival',mapId:map.id,monsterId:monster.id,monsterKind:'normal',label:'หาเงินเติมยา: '+monster.name,reason:'เงินไม่พอเสบียงขั้นต่ำ · เฉพาะมอนปกติเริ่มต้นที่เคยฆ่าได้และต่ำกว่าอย่างน้อย25เลเวล; กลับแผนหลักเมื่อยา>=10'}};
 }
 return null;
}
function manaBatch(i,name,now=Date.now()){
 if(!['Blue Potion','Sapphire Potion','Starlight Potion'].includes(name))return {limit:20,target:20,measured:false};
 const at=i.lastSaveAt,room=i.livePos?.room,build=i.catalog().build,count=Number(i.lastSave?.consumables?.[name])||0;
 if(!require('./freshness').fresh(at,30000,now)||!require('./freshness').fresh(i.livePos?.at,10000,now))return {limit:20,target:20,measured:false};
 i.mpSupplyWindows ||= {};let w=i.mpSupplyWindows[name];if(!w||w.build!==build)w=i.mpSupplyWindows[name]={build,previous:null,rows:[]};
 const prev=w.previous;
 if(!prev||at>prev.at){
  if(prev&&room!=='town'&&prev.room===room&&at-prev.at<=30000&&count<=prev.count&&prev.count-count<=80)w.rows.push({at,ms:at-prev.at,used:prev.count-count});
  w.previous={at,count,room};
 }
 w.rows=w.rows.filter(r=>now-r.at<720000);
 const ms=w.rows.reduce((n,r)=>n+r.ms,0),used=w.rows.reduce((n,r)=>n+r.used,0),measured=w.rows.length>=5&&ms>=60000&&used>0,rate=measured?used*60000/ms:null;
 const p90=measured?quantileRate(w.rows,.9):null;const target=measured?Math.max(20,Math.min(80,Math.ceil(Math.max(rate,p90)*12))):20;
 return {limit:measured?Math.max(0,target-count):20,target,measured,samples:w.rows.length,potsPerMinute:rate,reason:measured?'native_mp_consumption_12min_stock_capped80':'collecting_native_mp_consumption'};
}
async function townRestock(i,screen){
 if(!/town/i.test(screen.loc||'')||screen.panelOpen||!i.lastSave||!i.autoRestock||i.pendingTravel||require('./survival').hpPots(i.lastSave)>=i.restockBelow)return null;
 const item=choice(i,i.restockBelow);if(!item||!i.canDo('restock',120000))return null;
 const result=await i.restockPotions(item.name);
 if(result.ok)return 'restocked HP potions: confirmed '+item.name;
 return result.sent?'HP restock sent; awaiting inventory confirmation':null;
}
function milestoneIncome(i,wiki,supply,now=Date.now()){
 const s=i.lastSave||{},pots=require('./survival').hpPots(s),last=i.survivalSupply;
 // Training actors may earn the missing supply budget with the existing ten
 // potion normal-field minimum. Boss and capped readiness remain twenty;
 // the route below still requires proven boss-free low-level targets and HP.
 const minimumPots=s.lv<i.catalog().world.MAX_LV?10:20;
 const cashDeficit=Number.isFinite(supply?.requiredCopper)&&Number.isFinite(s.coins)&&s.coins<supply.requiredCopper;
 let cashForStock=false;try{cashForStock=prices(i).some(r=>r.lv<=s.lv&&s.coins-(supply?.reserve||0)-Number(require('./paid-actions').heldResources(i).Copper||0)>=r.price);}catch{}
 const unaffordable=!cashForStock&&last?.result?.status==='CANCELLED'&&last.result.sent===false&&last.result.reason==='no affordable unreserved native potion'&&pots<supply?.minimum;
 const prior=i.milestoneIncomeState,key=prior?.goal&&[i.catalog().build,prior.goal.mapId,prior.goal.monsterId].join(':'),continuing=prior?.build===i.catalog().build&&now>=prior.at&&now<prior.until&&i.livePos?.room===prior.goal.mapId&&i.survivalHuntReady===key;
 if(!supply||!cashDeficit&&!unaffordable||last?.result?.sent&&!last.result.ok||['STARTED','SENT','WAITING_CONFIRMATION','UNCERTAIN'].includes(last?.result?.status)||pots<minimumPots||i.assistanceReservation||i.survivalRecovery||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.choresBusy||i.pendingTravel||i.v2?.trial?.active()||i.v2?.sourceCoherence?.matches!==true||!require('./freshness').decisionGate(i,now).allowed||!require('./freshness').fresh(i.vitals?.at,15000,now)||!Number.isFinite(i.vitals.hp)||i.vitals.hp<(continuing?Math.max(.35,require('./survival').criticalHpRatio(i)):.95)||require('./equipment-headroom').journalBlocks(i)||require('./equipment-headroom').developmentBlocks(i))return null;
 const blocked=i.brain?.blocked?.(now)||{};
 for(const death of require('./survival').recentDeaths(i,now))blocked[death.map]={until:death.at+1800000};
 const g=continuing?prior.goal:require('../planning/progression-work').fallback(s,wiki,i.livePos?.room,blocked,Math.min(40,s.lv-25)),m=wiki?.monsters?.monsters?.find(m=>m.id===g?.monsterId),native=i.catalog().world.MONSTERS?.find(n=>n.id===m?.id),map=wiki?.maps?.maps?.find(m=>m.id===g?.mapId);
 if(!g||blocked[g.mapId]||map?.kind!=='field'||map.bossRoom||(map.monsters?.boss||[]).length||(map.monsters?.miniboss||[]).length||map.levelMax>Math.min(40,s.lv-25)||!map.monsters?.normal?.includes(m?.id)||m?.kind!=='normal'||native?.kind!=='normal'||native.level!==m.level||!(s.bestiary?.[m.id]>0)||!Number.isFinite(native.atk)||native.atk<=0||!Number.isFinite(i.vitals.maxHp)||i.vitals.maxHp<native.atk*8)return null;
 return i.milestoneIncomeState={at:continuing?prior.at:now,until:continuing?prior.until:now+600000,build:i.catalog().build,milestoneIncome:true,requiredCopper:supply.requiredCopper||null,goal:{...g,kind:'survival',label:'หาเงินเตรียมทีม: '+m.name,reason:'เงินหรือเสบียงรวมทีมยังไม่ครบ · มอนปกติที่ฆ่าได้จริงและเขตปลอดบอส; ไม่ออกล่าบอสจนเงินและยาครบ'}};
}
module.exports={prices,choice,essentialReserve,manaChoice,hpBatch,hpRefill,ordinaryRefill,manaBatch,bootstrap,quantileRate,townRestock,milestoneIncome};
