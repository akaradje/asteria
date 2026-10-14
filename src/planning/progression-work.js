'use strict';
const economy=require('../economy');
function context(i,now=Date.now()){
 const fresh=require('../runtime/freshness').fresh;
 return {now,catalog:i.catalog(),maxHp:fresh(i.vitals?.at,15000,now)?i.vitals.maxHp:null,adaptiveNormalMaterials:i.v2?.sourceCoherence?.matches===true&&require('../equipment-goal').policy(i.catalog()).adaptiveNormalMaterials===true,bossBoard:i.socialInbox?.last('bossboard'),firstClearRouteProof:(m,map)=>require('../runtime/class-boss-probe').eligible(i,m,map,now,{route:true}),firstClearProof:(m,map)=>require('../runtime/class-boss-probe').eligible(i,m,map,now),combatReady:fresh(i.lastSaveAt,30000,now)&&fresh(i.vitals?.at,15000,now)&&fresh(i.livePos?.at,10000,now)&&i.vitals.hp>=.85&&require('../runtime/survival').hpPots(i.lastSave||{})>=20&&!i.survivalRecovery&&!i.survivalStatus?.deaths?.length&&!i.lastSave?.developmentDefensive&&i.v2?.sourceCoherence?.matches!==false};
}
function combatProof(m,map,save,ctx={}){
 return !!m&&!!map&&!/^(pv|p\d|tw|dx|gd)/.test(map.id)&&['boss','miniboss'].includes(m.kind)&&ctx.combatReady===true&&Number.isFinite(m.level)&&(m.level<=save.lv-10&&(save.bestiary?.[m.id]||0)>0||ctx.firstClearProof?.(m,map)?.allowed===true);
}
function allowedSource(m,map,save,ctx={}){
 if(!m||!map||!Number.isFinite(m.level)||!Number.isFinite(save.lv))return false;
 if(m.kind==='normal'){
  if(m.level<=save.lv-20&&map.levelMax<=save.lv-20)return true;
  const cat=ctx.catalog,n=cat?.world?.MONSTERS?.find(x=>x.id===m.id),area=cat?.world?.MAPS?.find(x=>x.id===map.id);
  // The blanket twenty-level margin excluded every Starmetal source. Use
  // personally proven normal kills and current native HP/attack tables.
  // Elite eligibility and all route/death/ownership checks remain separate.
  return ctx.adaptiveNormalMaterials===true&&ctx.combatReady===true&&save.lv>=cat?.world?.MAX_LV&&map.kind==='field'&&map.bossRoom===false&&!/^(pv|p\d|tw|dx|gd)/.test(map.id)&&area?.kind==='field'&&area.bossRoom===false&&area.levelMax===map.levelMax&&map.monsters?.normal?.includes(m.id)&&n?.kind==='normal'&&n.level===m.level&&m.level<=save.lv-10&&map.levelMax<=save.lv-5&&(save.bestiary?.[m.id]||0)>=5&&Number.isFinite(n.atk)&&n.atk>0&&Number.isFinite(ctx.maxHp)&&ctx.maxHp>=n.atk*8;
 }
 const now=ctx.now??Date.now(),b=ctx.bossBoard;
 return combatProof(m,map,save,ctx)&&require('../runtime/freshness').fresh(b?._receivedAt,30000,now)&&!!b.list?.some(r=>r.id===m.id&&r.map===map.id&&r.up&&!r.next);
}
function fallback(save,wiki,room,blocked={},ceiling=save.lv-20){
 const rows=[];for(const map of wiki?.maps?.maps||[]){if(map.kind!=='field'||blocked[map.id]||!Number.isFinite(map.levelMax)||map.levelMax>ceiling||(map.monsters?.miniboss||[]).length||(map.monsters?.boss||[]).length)continue;
  for(const m of wiki?.monsters?.monsters||[]){if(m.kind!=='normal'||!map.monsters?.normal?.includes(m.id)||!Number.isFinite(m.level)||m.level>ceiling)continue;
   const kills=save.bestiary?.[m.id]||0;if(kills===0&&m.level>20)continue;
   const milestone=kills<30?30:kills<150?150:null;
   const travelMs=require('./boss-window').travelBudget(room||'town',map.id,wiki).ms;if(!Number.isFinite(travelMs))continue;
   rows.push({kind:'development-side',mapId:map.id,mapName:map.name,monsterId:m.id,monsterKind:'normal',score:milestone?950:700,label:milestone?'โบนัสสมุดมอน: '+m.name+' '+kills+'/'+milestone:'เงินและเสบียง: '+map.name,reason:milestone?'เก็บจำนวนฆ่ามอนปกติที่ตรวจชนิดแล้วเพื่อโบนัสถาวร':'เก็บเงินเสบียงจากมอนปกติที่เคยฆ่าได้ ไม่รอบอสหรือเก็บ EXP ตัวละครที่ตัน',level:m.level,milestone,travelMs});
  }
 }
 // A reachable permanent bonus outranks endless cash once a target is safe.
 rows.sort((a,b)=>b.score-a.score||Number(b.mapId===room)-Number(a.mapId===room)||a.travelMs-b.travelMs||b.level-a.level||a.monsterId.localeCompare(b.monsterId));return rows[0]||null;
}
// Early OBT actors cannot satisfy the endgame twenty-level margin. During
// recovery only, return to a starter gate with personally proven normal kills.
// The runtime must select that exact target before enabling AUTO; a miniboss
// elsewhere on the map is never a target or permission to enter a boss room.
function recoveryFallback(save,wiki,room,blocked={},ceiling){
 if(!Number.isFinite(save.lv)||save.lv>=99||!Number.isFinite(ceiling))return null;
 const rows=[];
 for(const map of wiki?.maps?.maps||[]){
  if(map.kind!=='field'||map.bossRoom!==false||blocked[map.id]||(map.monsters?.boss||[]).length||!Number.isFinite(map.levelMax)||map.levelMax>ceiling)continue;
  const home=require('./boss-window').travelBudget('town',map.id,wiki);
  if(!Number.isFinite(home.ms)||home.ms>310000)continue;
  for(const m of wiki?.monsters?.monsters||[]){
   const kills=save.bestiary?.[m.id];
   if(m.kind!=='normal'||!map.monsters?.normal?.includes(m.id)||!Number.isFinite(m.level)||m.level>Math.min(ceiling,save.lv-(save.lv>40?10:5))||!Number.isFinite(kills)||kills<1)continue;
   rows.push({kind:'development-side',mapId:map.id,mapName:map.name,monsterId:m.id,monsterKind:'normal',level:m.level,travelMs:home.ms,kills,label:'ฟาร์มฟื้นตัว: '+m.name,reason:'มอนปกติที่มีประวัติฆ่าจริง · เขตข้างเมืองต่ำกว่าเลเวลและเขตที่ตายอย่างน้อย 5 ระดับ'});
  }
 }
 rows.sort((a,b)=>Number(b.mapId===room)-Number(a.mapId===room)||b.level-a.level||b.kills-a.kills||a.monsterId.localeCompare(b.monsterId));return rows[0]||null;
}
function assess(i,wiki,board,now=Date.now(),{campaignSideWork=false}={}){
 const out={at:now,candidates:[],blocked:[],reason:'รอเงื่อนไขพัฒนา'},s=i.lastSave||{},cat=i.catalog();out.build=cat.build;
 const parallel=campaignSideWork?require('./campaign-equipment').profile(i):null;
 if(s.lv<cat.world?.MAX_LV||!cat.world?.MAX_LV||i.endgameCampaign?.phase!=='complete'&&!parallel)return out;
 const p=i.developmentProgress,portfolio=parallel?.craftPortfolio||(p?.build===cat.build&&now-p.at>=0&&now-p.at<30000?p.craftPortfolio:require('../character-brain').profile(s,cat,wiki,{reserved:require('../runtime/paid-actions').heldResources(i),...require('../runtime/craft-scope').profileOptions(i)}).craftPortfolio);
 out.primary=portfolio?.selected?{id:portfolio.selected.id,name:portfolio.selected.name}:null;
 if(portfolio?.selected?.ready&&!require('../runtime/craft-scope').blocking(i,portfolio.selected.id)){out.reason='สูตรพร้อมแล้ว ให้คราฟและตรวจผลก่อนออกเก็บของ';return out;}
 if(portfolio?.selected?.ready)out.blocked.push({itemId:portfolio.selected.id,reason:'ready craft has an unresolved native payment fence; no replay; independent work only'});
 const ctx={...context(i,now),bossBoard:board};
 if(!ctx.combatReady||i.teamControl||i.pendingTravel||i.choresBusy||i.recycling||require('../runtime/room-policy').roomPolicy(i.livePos?.room).dungeon)return out;
 const maps=wiki?.maps?.maps||[],blocked=i.brain?.blocked?.(now)||{},index=require('./craft-portfolio').sourceIndex(wiki),timed=[];
 const travelCache=new Map(),travelFor=mapId=>{if(!travelCache.has(mapId))travelCache.set(mapId,require('./boss-window').travelBudget(i.livePos.room,mapId,wiki).ms);return travelCache.get(mapId);};
 // A conservative multi-hop estimate is not an unreachable route. Keep the
 // short-trip budget for optional work, but let the verified missing-slot
 // recipe use its finite route; native travel and arrival readiness still gate it.
 const primaryRoute=c=>c?.id===out.primary?.id&&c.goalPromotion===true&&c.recipeVerified===true&&c.verifiedBuild===cat.build;
 const reachable=(src,c)=>!blocked[src.mapId]&&allowedSource(wiki.monsters.monsters.find(m=>m.id===src.monsterId),maps.find(m=>m.id===src.mapId),s,ctx)&&Number.isFinite(travelFor(src.mapId))&&(primaryRoute(c)||travelFor(src.mapId)<=465000);
 for(const c of [portfolio?.selected,...(portfolio?.workCandidates||portfolio?.alternatives||[]),...require('./combat-work').requirements(i,wiki,now)].filter(Boolean)){
 const finishable=(c.missing||[]).every(n=>!n.protected&&(n.name==='Copper'?(s.coins||0)-n.want>=require('../upgrade-reserve').reserve(s,cat.world):(index.get(n.name)||[]).some(src=>reachable(src,c))));
 for(const need of c.missing||[]){
  if(need.protected)continue;const sources=index.get(need.name)||[];let found=false;
  for(const src of sources){const map=maps.find(x=>x.id===src.mapId),m=wiki.monsters.monsters.find(x=>x.id===src.monsterId);if(blocked[src.mapId])continue;
   if(c.id===out.primary?.id&&combatProof(m,map,s,ctx)&&require('../runtime/freshness').fresh(board?._receivedAt,30000,now)&&Number.isFinite(board.now)){
    const field=board.list?.find(r=>r.id===m.id&&r.map===map.id);
    if(field&&!field.up&&Number.isFinite(field.next)&&field.next>board.now&&Number.isFinite(require('./boss-window').travelBudget('town',map.id,wiki).ms))timed.push({kind:'craft-work',itemId:c.id,material:need.name,mapId:map.id,mapName:map.name,monsterId:m.id,monster:m.name,monsterKind:m.kind,alive:false,nextAt:field.next+board._receivedAt-board.now,label:'เตรียม '+need.name+' เพื่อ '+c.name});
   }
   if(!allowedSource(m,map,s,ctx))continue;
   if(!Number.isFinite(travelFor(map.id)))continue;
   const adjacent=maps.find(x=>x.id===i.livePos.room)?.connectsTo;
   if(!primaryRoute(c)&&![adjacent?.prev,adjacent?.next].includes(map.id)&&travelFor(map.id)>465000)continue;
   const acquisition=require('./acquisition-value').value(c,need,src,{finishable,travelMs:travelFor(map.id)});
   found=true;out.candidates.push({kind:'craft-work',firstClear:m.kind!=='normal'&&(!(s.bestiary?.[m.id]>0)||m.level>s.lv-10),itemId:c.id,expectedCombatGain:c.expectedCombatGain??c.gain,purpose:c.purpose||'craft',goalPromotion:c.goalPromotion===true,material:need.name,monsterId:m.id,monsterKind:m.kind,mapId:map.id,mapName:map.name,score:acquisition.score,acquisition,label:'เก็บ '+need.name+' เพื่อ '+c.name,reason:'มี '+need.have+'/'+need.want+' · คาด '+acquisition.expectedKills+' ฆ่าตามอัตราดรอป (ไม่รับประกัน) · '+(finishable?'แหล่งของที่ขาดทั้งสูตรผ่านเกณฑ์ตอนนี้':'เก็บเตรียมไว้ แต่สูตรยังมีขั้นติดขัด')+' · ระบุเป้าหมายมอนจริง',routeHint:[adjacent?.prev,adjacent?.next].includes(map.id)?'adjacent-field':'via-town'});
  }
   if(!found&&sources.some(x=>x.kind!=='normal'))out.blocked.push({itemId:c.id,material:need.name,reason:'บอสยังไม่มีข้อมูลเกิดสดหรือยังไม่ผ่านความพร้อมรบ/ประวัติฆ่า/ระดับปลอดภัย'});
 }
 }
 const side=fallback(s,wiki,i.livePos.room,blocked);if(side)out.candidates.push(side);
 const cards=require('./campaign-side-work').cards(i,wiki,now);out.cardCollection=cards.view;
 out.candidates.push(...cards.candidates.map(c=>({...c,score:1200+Math.min(100,c.score-350)})));
 if(timed.length&&!campaignSideWork){
  // Reuse the conservative travel deadline; only our already-validated normal
  // candidates may fill this idle window, not arbitrary Wiki side sources.
  const schedule=require('./boss-window').schedule({hunt:{boardFresh:true,sources:timed},save:s,wiki:{...wiki,monsters:{monsters:[]}},now,room:i.livePos.room,previous:i.progressionWork?.schedule,extraCandidates:out.candidates.filter(c=>c.monsterKind==='normal')});out.schedule=schedule;
  if(schedule.goal)out.candidates=[{...schedule.goal,kind:schedule.phase==='side-work'?schedule.goal.kind:'craft-wait',sideWork:schedule.phase==='side-work',score:4000,reason:schedule.phase==='side-work'?schedule.goal.reason+' · กลับบอสตามเวลาที่เผื่อเดินทาง':schedule.reason}];else out.candidates=[];
 }
 out.candidates=require('./side-work-budget').filter(i,out.candidates,now);
 out.candidates.sort((a,b)=>b.score-a.score||Number(b.mapId===i.livePos.room)-Number(a.mapId===i.livePos.room));out.candidates=out.candidates.slice(0,12);
 out.reason=out.blocked.length?'พักขั้นที่ติดบอส เลือกวัตถุดิบขั้นอื่นหรือโบนัสถาวรที่ทำได้จริง':'เลือกงานที่มีแหล่งพร้อมและเป้าหมายมอนจริง';return out;
}
module.exports={context,combatProof,allowedSource,fallback,recoveryFallback,assess};
