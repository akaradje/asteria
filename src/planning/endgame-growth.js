'use strict';
const economy=require('../economy'),gear=require('../gear-value');
const cached=new Map();
function assess(i,wiki,board,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),result={at:now,targets:[],candidates:[],reason:'หลังคลาส/ปีก: เพิ่มพลัง อุปกรณ์ สัตว์เลี้ยง และรางวัลถาวร'};
 const milestones=require('./progression-priority').assess(s,cat);if(!milestones.equipmentAllowed)return {...result,reason:milestones.reason};
 const capped=s.lv>=cat.world?.MAX_LV,early=require('../equipment-goal').policy(cat).top10Progression===true&&s.lv>=20&&!capped&&!i.endgameCampaign?.active;
 if(!early&&(!capped||i.endgameCampaign?.phase!=='complete'))return result;
 const held=new Set(economy.ownedNames(s)),items=Object.values(cat.items||{}).filter(x=>['weapon','offhand','armor','head','boots','acc'].includes(x.slot)&&!held.has(x.id));
 const cacheKey=JSON.stringify([i.root,cat.build,cat.equipmentGoal,s.job,s.lv,s.equip,s.refine,s.stage,s.weaponOpts,s.sockets,s.st,s.developmentDefensive,[...held].sort()]),hit=cached.get(cacheKey);
 // Check sources before truncating: boss-only aspirational items must not hide
 // reachable intermediate upgrades further down the catalog ranking.
 const targets=hit&&now-hit.at>=0&&now-hit.at<30000?hit.targets:items.map(item=>({item,comparison:gear.compare(s,cat,item.id)})).filter(x=>x.comparison.upgrade).sort((a,b)=>Number(!s.equip?.[b.comparison.slot])-Number(!s.equip?.[a.comparison.slot])||require('../equipment-goal').priority(b.comparison)-require('../equipment-goal').priority(a.comparison));
 if(!hit||targets!==hit.targets){if(cached.size>=12)cached.clear();cached.set(cacheKey,{at:now,targets});}
 result.targets=targets.slice(0,6).map(x=>({id:x.item.id,name:x.item.name,slot:x.item.slot,gain:Math.round(x.comparison.gain),method:'whole loadout estimate including owned refine/cards/sets, not measured DPS'}));
 const fresh=at=>Number.isFinite(at)&&now-at>=0&&now-at<10000;
 // The entry HP gate is not a reason to erase an established normal hunt on
 // every damage frame. Only the exact native-confirmed target may continue.
 const established=i.goal?.kind==='gear-hunt'&&i.goal.monsterKind==='normal'&&i.goal.mapId===i.livePos?.room&&i.managedHuntReady===[cat.build,i.goal.mapId,i.goal.monsterId].join(':');
 const continuing=established&&Number.isFinite(i.vitals?.hp)&&i.vitals.hp>=.35&&i.vitals.hp<.95;
 if(!fresh(i.livePos?.at)||!fresh(i.vitals?.at)||!Number.isFinite(i.lastSaveAt)||now-i.lastSaveAt<0||now-i.lastSaveAt>30000||i.vitals.hp<(continuing?.35:.95)||!Number.isFinite(i.vitals.hp)||require('../runtime/survival').hpPots(s)<20||i.teamControl||i.pendingTravel||i.choresBusy||i.recycling||i.livePos.dead||i.survivalRecovery||i.survivalStatus?.deaths?.length||s.developmentDefensive||i.v2?.sourceCoherence?.matches===false||require('../runtime/room-policy').roomPolicy(i.livePos.room).dungeon)return result;
 const blocked=i.brain?.blocked?.(now)||{},maps=wiki?.maps?.maps||[],fromMap=maps.find(m=>m.id===i.livePos.room);
 // A personally proven elite source need not wait until level120. Existing
 // live-spawn/proof/ten-level-margin gates still apply, and early actors need
 // the guaranteed equipment foundation before attempting it again.
 const earlyElitePrepared=['weapon','head','armor','boots'].every(slot=>{const id=s.equip?.[slot],item=cat.items[id];return item?.tier>=4&&['epic','legendary'].includes(item.rarity)&&item.rarityEvidence!=='unknown'&&(s.refine?.[id]||0)>=1;});
 const adjacent=id=>[fromMap?.connectsTo?.prev,fromMap?.connectsTo?.next].includes(id);
 const q=s.drill;
 if(!continuing&&q&&(q.hole===1?q.kills<q.need:!q.bossDone)&&Object.values(s.equip||{}).includes(q.id)){
  const matches=(wiki?.monsters?.monsters||[]).filter(m=>q.hole===1?m.kind==='normal'&&m.level>=q.lo&&m.level<=Math.min(q.hi,s.lv):m.id===q.boss&&s.bestiary?.[m.id]>0).sort((a,b)=>a.level-b.level);
  for(const m of matches){const map=maps.find(map=>map.kind==='field'&&!blocked[map.id]&&(map.monsters?.[m.kind]||[]).includes(m.id)&&map.levelMin<=s.lv&&(map.id===i.livePos.room||i.livePos.room==='town')&&(q.hole===1||board&&now-board._receivedAt>=0&&now-board._receivedAt<30000&&board.list?.some(b=>b.id===m.id&&b.map===map.id&&b.up&&!b.next)));if(!map)continue;result.candidates.push({kind:'equipment-drill',itemId:q.id,monsterId:m.id,monsterKind:m.kind,mapId:map.id,mapName:map.name,score:2300,label:'เควสเจาะรู: '+(cat.items[q.id]?.name||q.id),reason:q.hole===1?'นับเฉพาะมอนปกติในช่วงเลเวล '+q.kills+'/'+q.need:'ร่วมบอสที่มีหลักฐานว่าเกิดแล้ว ไม่ยืนรอค้าง'});break;}
 }
 for(const t of targets)for(const m of wiki?.monsters?.monsters||[]){if(continuing&&(t.item.id!==i.goal.itemId||m.id!==i.goal.monsterId))continue;const drop=(m.dropTable||[]).find(d=>d.item===t.item.name&&d.ratePct>0);if(!drop||m.level>(m.kind==='normal'?early?s.lv-3:s.lv:s.lv-10)||!['normal','miniboss','boss'].includes(m.kind)||early&&m.kind!=='normal'&&!earlyElitePrepared)continue;
  const elite=m.kind!=='normal';if(elite&&(!(s.bestiary?.[m.id]>0)||!board||now-board._receivedAt<0||now-board._receivedAt>=30000))continue;
  const map=maps.find(map=>(!continuing||map.id===i.goal.mapId)&&map.kind==='field'&&!blocked[map.id]&&(map.monsters?.[m.kind]||[]).includes(m.id)&&map.levelMin<=s.lv&&(!early||map.bossRoom===false&&map.levelMax<=s.lv)&&(adjacent(map.id)||require('./boss-window').travelBudget(i.livePos.room,map.id,wiki).ms<=465000)&&(!elite||board.list?.some(b=>b.id===m.id&&b.map===map.id&&b.up&&!b.next)));if(!map)continue;
  const fillsEmpty=!s.equip?.[t.comparison.slot];
  const worn=cat.items[s.equip?.[t.comparison.slot]],weakAccessory=t.item.slot==='acc'&&['common','uncommon','rare'].includes(worn?.rarity);
  result.candidates.push({kind:'gear-hunt',itemId:t.item.id,slot:t.comparison.slot,fillsEmpty,mapId:map.id,mapName:map.name,monsterId:m.id,monsterKind:m.kind,monster:m.name,alive:true,routeHint:adjacent(map.id)?'adjacent-field':'via-town',goalPromotion:t.comparison.goalPromotion,score:(t.comparison.goalPromotion?4000:0)+(fillsEmpty?2400:weakAccessory?2250:1800)+Math.min(100,t.comparison.gain)+Math.min(50,drop.ratePct),label:(fillsEmpty?'เติมช่องว่าง: ':weakAccessory?'เปลี่ยนเครื่องประดับอ่อน: ':'พัฒนาอุปกรณ์: ')+t.item.name,reason:'พบแหล่งดรอปตรงชื่อและผ่านเงื่อนไขพร้อมรบ; ไม่ใช้คะแนนคาดการณ์เป็น DPS',dropRatePct:drop.ratePct});
 }
 result.candidates.sort((a,b)=>b.score-a.score||Number(a.monsterKind!=='normal')-Number(b.monsterKind!=='normal')||b.dropRatePct-a.dropRatePct||a.itemId.localeCompare(b.itemId));
 result.candidates=result.candidates.slice(0,12);
 result.reason=result.candidates.length?'เลือกของที่มีแหล่งดรอปจริงก่อน · เติมช่องว่างและเปลี่ยนเครื่องประดับอ่อน; บอสต้องมีข้อมูลเกิดสด':'ไม่มีแหล่งที่ผ่านเงื่อนไขพร้อมรบ · คงเป้าหมายระยะยาวโดยไม่เดาว่าบอสเกิด';
 return result;
}
module.exports={assess};
