'use strict';
const fs=require('fs'),path=require('path');
// Budget the same shortest verified gate chain used by the runtime.
function makeTravelBudget(wiki,measurements={},options={}){
 const root=options.root||path.resolve(__dirname,'../..'),now=options.now??Date.now();let build=options.build||wiki?._source?.verifiedBuild,home;
 if(!build){try{build=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'),'utf8')).build;}catch{}}
 const memo=new Map();
 return function cost(from,to){
  if(from===to)return {ms:0,evidence:'same-map'};
  const key=from+'>'+to;if(memo.has(key))return memo.get(key);
  // One current source-byte check per synchronous planning decision, never a
  // cross-decision cache that could conceal a same-build game update.
  home ||= require('../runtime/native-gates').graphForBuild(root,build,wiki?.maps?.maps||[]);
  const route=require('./gate-route').route(from,to,wiki,home),hops=route?.length??null,measured=measurements[key];let out;
  if(hops===null)out={ms:Infinity,evidence:'unknown-route'};
  else{
   const fallback=hops*155000,native=measured?.evidence==='fresh_native_route_arrivals';
   const freshNative=native&&Number.isFinite(measured.at)&&now-measured.at>=0&&now-measured.at<3600000&&measured.samples>=3&&measured.attempts>=measured.samples&&measured.failures===0&&Number.isFinite(measured.maxMs)&&measured.maxMs>0&&measured.maxMs<=900000&&(!build||measured.build===build);
   if(freshNative)out={ms:Math.max(hops*15000,measured.maxMs*1.5+30000),evidence:'observed-native-route-max-with-50pct-margin',samples:measured.samples};
   else if(native)out={ms:Math.max(fallback,Number.isFinite(measured.failedMaxMs)?measured.failedMaxMs+30000:0,Number.isFinite(measured.maxMs)?measured.maxMs*1.5+30000:0),evidence:'native-route-insufficient-or-unreliable-conservative'};
   else out={ms:measured?.samples>=3?Math.max(hops*60000,measured.maxMs*1.5+30000):Math.max(fallback,Number(measured?.maxMs)||0),evidence:measured?.samples>=3?'observed-max-with-50pct-margin':'unmeasured-conservative-route'};
  }
  memo.set(key,out);return out;
 };
}
function travelBudget(from,to,wiki,measurements={},options={}){return makeTravelBudget(wiki,measurements,options)(from,to);}
function workValue(c,now){
 if(c.goal.kind!=='exp')return null;
 const route=require('./training-route'),tier=route.cycleMeasured(c.goal,now)?2:route.measured(c.goal,now)?1:0;
 const e=tier===2?c.goal.routeEvidence:tier===1?c.goal.farmEvidence:null;
 if(!e||e.deaths||e.expLossEvents||e.expPerHour<=0)return null;
 const availableMs=Math.min(600000-c.out.ms,c.workMs);
 return {tier,rate:e.expPerHour,availableMs:Math.max(0,availableMs),expectedExp:e.expPerHour*Math.max(0,availableMs)/3600000,evidence:tier===2?'observed_net_cycle_rate':'observed_field_rate',estimate:true};
}
function sideSources(save,wiki,missing=[],blocked={}){
 const rows=[];for(const map of wiki?.maps?.maps||[]){if(blocked[map.id]||!['field','dungeon'].includes(map.kind)||map.kind==='dungeon'&&(map.bossRoom!==false||require('../runtime/room-policy').roomPolicy(map.id).dungeon)||map.levelMin>save.lv)continue;
 for(const m of wiki?.monsters?.monsters||[]){if(m.kind!=='normal'||m.level>save.lv+2||!(map.monsters?.normal||[]).includes(m.id))continue;
 const drop=(m.dropTable||[]).find(d=>missing.some(n=>n.name===d.item&&(n.short>0||n.want>n.have)));
 const kills=Number(save.bestiary?.[m.id])||0,unlock=m.level<=20?500:m.level<=40?1000:m.level<=60?1500:m.level<=80?2000:3000,petGoal=!Object.hasOwn(save.pets||{},m.id)&&kills<unlock;
 const threshold=kills<30?30:kills<150?150:petGoal?unlock:null;
 if(!drop&&!threshold)continue;
 rows.push({kind:'campaign-side',mapId:map.id,mapName:map.name,monsterId:m.id,monster:m.name,monsterKind:'normal',material:drop?.item||null,alive:true,
 score:(drop?1000+(drop.ratePct||0):petGoal&&threshold===unlock?10:100),priority:drop?1:petGoal&&threshold===unlock?4:3,label:drop?'งานคั่น: เก็บ '+drop.item:'งานคั่น: '+m.name+' '+kills+'/'+threshold,
 reason:drop?'เก็บวัตถุดิบที่ยังขาดจากมอนปกติตาม Wiki':petGoal&&threshold===unlock?'สะสมจำนวนฆ่าเพื่อปลดสัตว์เลี้ยง':'เก็บโบนัสสมุดมอนถาวร',threshold});
 }}return rows;
}
function schedule({hunt,save,wiki,now=Date.now(),room=save.mapId||'town',missing=[],blocked={},previous=null,pendingTravel=null,measurements={},extraCandidates=[],sideSourcesAllowed=true,allowBlockedBossDetour=false}){
 const leadMs=90000,minWorkMs=120000;
 const cost=makeTravelBudget(wiki,measurements,{now});
 const observed=hunt.boardFresh?(hunt.sources||[]).filter(s=>['boss','miniboss'].includes(s.monsterKind)&&s.boardKnown!==false&&(s.alive||s.nextAt>now)).sort((a,b)=>Number(b.alive)-Number(a.alive)||(a.nextAt||Infinity)-(b.nextAt||Infinity))[0]:null;
 const observation=observed?{monster:observed.monster,monsterId:observed.monsterId,mapId:observed.mapId,material:observed.material,alive:observed.alive,spawnAt:observed.nextAt||null,boardAt:observed.boardAt||null,combatEligible:observed.combatEligible!==false,combatBlock:observed.combatBlock||null,routeEligible:observed.routeEligible??observed.combatEligible!==false,routeBlock:observed.routeBlock||null,plannedSupport:observed.plannedSupport===true,evidence:'fresh_server_bossboard_not_wiki_interval'}:null;
 const finish=result=>({...result,bossObservation:observation});
 const reachable=s=>Number.isFinite(cost(room,s.mapId).ms);
 const routeReady=s=>s.routeEligible??s.combatEligible!==false;
 const liveBoss=hunt.boardFresh&&(hunt.sources||[]).filter(s=>s.alive&&routeReady(s)&&['boss','miniboss'].includes(s.monsterKind)&&reachable(s)).sort((a,b)=>Number(b.mapId===room)-Number(a.mapId===room)||Number(b.mapId===pendingTravel?.mapId)-Number(a.mapId===pendingTravel?.mapId)||cost(room,a.mapId).ms-cost(room,b.mapId).ms)[0];
 if(liveBoss)return finish({phase:'boss-live',goal:liveBoss,boss:liveBoss,reason:'เซิร์ฟเวอร์ยืนยันบอสเกิด เปลี่ยนจากงานคั่นทันที'});
 const boss=hunt.boardFresh?((hunt.sources||[]).filter(s=>s.nextAt>now&&!s.alive&&routeReady(s)&&reachable(s)).sort((a,b)=>a.nextAt-b.nextAt)[0]||null):null;
 const candidates=[...(hunt.sources||[]).filter(s=>s.alive&&s.monsterKind==='normal').map(s=>({...s,priority:0,score:2000+(s.ratePct||0)})),...extraCandidates,...(sideSourcesAllowed?sideSources(save,wiki,missing,blocked):[])];
 const travel=boss?cost(room,boss.mapId):null;
 const departAt=boss?boss.nextAt-leadMs-travel.ms:null;
 if(boss&&now>=departAt)return finish({phase:room===boss.mapId?'preposition':'return-to-boss',goal:{...boss,kind:room===boss.mapId?'campaign-wait':boss.kind,label:'ไปรอก่อนรอบ '+boss.monster},boss,spawnAt:boss.nextAt,arrivalAt:boss.nextAt-leadMs,departAt,travelMs:travel.ms,travelEvidence:travel.evidence,leadMs,reason:'เผื่อเดินทางและเข้าพื้นที่บอสก่อนเกิด 90 วินาที'});
 const valid=candidates.map(goal=>{const out=cost(room,goal.mapId),back=boss?cost(goal.mapId,boss.mapId):null;
 const stopAt=boss?boss.nextAt-leadMs-back.ms:null,workMs=boss?stopAt-now-out.ms:Infinity;
 return {goal,out,back,stopAt,workMs};}).filter(c=>{
  const map=wiki.maps?.maps?.find(m=>m.id===c.goal.mapId);
  const usefulDetour=allowBlockedBossDetour&&observation?.combatEligible===false&&['exp','card-collection','campaign-side','craft-work'].includes(c.goal.kind)&&c.goal.monsterKind==='normal'&&(c.goal.priority??99)<=2&&map?.bossRoom===false&&!require('../runtime/room-policy').roomPolicy(map.id).dungeon&&!blocked[map.id]&&c.out.ms<=465000;
  const moneyTarget=wiki.monsters?.monsters?.find(m=>m.id===c.goal.monsterId);
  const incomeDetour=c.goal.income===true&&c.goal.kind==='campaign-side'&&c.goal.material==='Copper'&&c.goal.priority===0&&map?.kind==='field'&&map.bossRoom===false&&!blocked[map.id]&&!(map.monsters?.boss||[]).length&&!(map.monsters?.miniboss||[]).length&&map.monsters?.normal?.includes(moneyTarget?.id)&&moneyTarget?.kind==='normal'&&moneyTarget.level<=save.lv-20&&map.levelMax<=save.lv-20&&save.bestiary?.[moneyTarget.id]>0&&c.out.ms<=465000;
  return c.workMs>=minWorkMs&&(boss||c.goal.mapId===room||usefulDetour||incomeDetour||room==='town'&&c.out.ms<=(c.goal.kind==='main-quest'?465000:155000))&&Number.isFinite(c.out.ms);
 });
 for(const c of valid)c.value=workValue(c,now);
 valid.sort((a,b)=>{const priority=(a.goal.priority??2)-(b.goal.priority??2);if(priority)return priority;
  if(a.goal.kind==='exp'&&b.goal.kind==='exp'&&(a.value||b.value))return (b.value?.tier||0)-(a.value?.tier||0)||(b.value?.expectedExp||0)-(a.value?.expectedExp||0)||a.out.ms-b.out.ms;
  return (b.goal.score+(b.goal.mapId===room?500:0))-(a.goal.score+(a.goal.mapId===room?500:0))||a.out.ms-b.out.ms;
 });
 // Keep a useful assignment while its deadline and inventory still allow it; avoid oscillating routes.
 const ownedRoute=pendingTravel?.mapId===previous?.goal?.mapId&&Number.isFinite(pendingTravel?.until)&&now<pendingTravel.until&&pendingTravel.until-now<=540000&&now-previous?.assignedAt<900000;
 const retained=previous?.phase==='side-work'&&(now-previous.assignedAt<180000||ownedRoute)?valid.find(c=>c.goal.mapId===previous.goal.mapId&&c.goal.monsterId===previous.goal.monsterId&&c.goal.material===previous.goal.material):null;
 const pick=retained&&(retained.goal.priority??2)<=(valid[0]?.goal.priority??2)?retained:valid[0];
 if(pick)return finish({phase:'side-work',goal:pick.goal,boss,spawnAt:boss?.nextAt||null,arrivalAt:boss?boss.nextAt-leadMs:null,departAt:pick.stopAt,travelMs:pick.back?.ms||0,travelEvidence:pick.back?.evidence||'same-map',workEfficiency:pick.value||null,leadMs,workMs:Number.isFinite(pick.workMs)?pick.workMs:null,assignedAt:pick===retained?previous.assignedAt:now,reason:pick.goal.reason+(pick.value?' · เปรียบเทียบ EXP ที่วัดได้หลังหักเวลาเดินทางในช่วงงาน 10 นาที':'')+(boss?' · หยุดตามเวลาเดินทางกลับและเผื่อ 90 วินาที':observation?' · รอบบอสยืนยันแล้ว แต่ยังติดเงื่อนไขพร้อมรบ จึงทำงานปลอดภัยใกล้ตัว':room==='town'?' · ตารางบอสยังไม่ยืนยัน เลือกเขตข้างเมืองและตรวจรอบระหว่างเดิน':' · ตารางบอสยังไม่ยืนยัน จึงทำงานในแมพเดิม')});
 if(boss)return finish({phase:'return-to-boss',goal:{...boss,label:'เตรียมรอบ '+boss.monster},boss,spawnAt:boss.nextAt,arrivalAt:boss.nextAt-leadMs,departAt:now,travelMs:travel.ms,travelEvidence:travel.evidence,leadMs,reason:'เวลาที่เหลือไม่พอสำหรับงานคั่นและเดินทางกลับ จึงไปพื้นที่บอสก่อน'});
 return finish({phase:'await-board',goal:null,reason:observation?'รอบบอสยืนยันแล้ว แต่ยังไม่ผ่านเงื่อนไขพร้อมรบ':'รอตารางบอสสดก่อนเดินทางไกล'});
}
module.exports={schedule,travelBudget,sideSources,workValue,makeTravelBudget};
