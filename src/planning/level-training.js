'use strict';
// Native EXP/HP is a planning estimate; observed EXP/hour remains separate.
function candidates(save,wiki,cat,{blocked={},room=save.mapId,recovery=false,ceiling=save.lv-3,provenOnly=false,maxTravelMs=465000,measurements={},maxHp=null,now=Date.now()}={}){
 const world=cat?.world,lv=save.lv;if(!Number.isFinite(lv)||!Number.isInteger(world?.MAX_LV)||lv>=world.MAX_LV)return [];
 const native=new Map((world.MONSTERS||[]).map(m=>[m.id,m])),rows=[],cost=require('./boss-window').makeTravelBudget(wiki,measurements,{build:cat.build,now});
 for(const map of wiki?.maps?.maps||[]){
  // Connected overworld Abyss maps are distinct from quota instances (dx/gd/tw).
  const nativeMap=(world.MAPS||[]).find(m=>m.id===map.id);
  const openDungeon=map.kind==='dungeon'&&nativeMap?.kind==='dungeon'&&nativeMap.bossRoom===false&&nativeMap.levelMax===map.levelMax&&!require('../runtime/room-policy').roomPolicy(map.id).dungeon;
  if((map.kind!=='field'&&!openDungeon)||map.bossRoom!==false||blocked[map.id]||!Number.isFinite(map.levelMax)||map.levelMax>Math.max(8,lv-(recovery?5:0)))continue;
  for(const id of map.monsters?.normal||[]){
   const m=native.get(id);if(m?.kind!=='normal'||!Number.isFinite(m.level)||m.level>Math.max(1,ceiling)||!Number.isFinite(m.exp)||!Number.isFinite(m.hp)||m.hp<=0)continue;
   if(Number.isFinite(maxHp)&&(!Number.isFinite(m.atk)||m.atk<=0||maxHp<m.atk*4))continue;
   const kills=save.bestiary?.[id]||0;if(provenOnly&&kills<1)continue;
   const travel=cost(room||'town',map.id).ms;
   if(!Number.isFinite(travel)||travel>maxTravelMs)continue;
   const multiplier=typeof world.expMultiplier==='function'?world.expMultiplier(lv,m.level):null;
   if(!Number.isFinite(multiplier)||multiplier<0)continue;
   const effectiveExp=Math.floor(m.exp*multiplier),score=effectiveExp/(2+m.hp/5000)*(kills?1.1:1);
   rows.push({kind:'exp',mapId:map.id,mapName:map.name,monsterId:id,monsterKind:'normal',level:m.level,kills,travelMs:travel,score,
    effectiveExp,planningEvidence:'loaded_native_exp_hp_estimate_not_measured_dps',label:'เก็บเวล: '+m.name+' · '+map.name,
    reason:'มอนปกติ Lv'+m.level+' · EXP พื้นฐานหลังตัวคูณ '+effectiveExp+' · '+(kills?'มีประวัติฆ่าจริง':'เป้าหมายใหม่ภายในกรอบเลเวล')});
  }
 }
 rows.sort((a,b)=>b.score-a.score||a.travelMs-b.travelMs||a.monsterId.localeCompare(b.monsterId));
 const current=rows.find(r=>r.mapId===room);if(current&&rows[0]&&current.score>=rows[0].score*.85){rows.splice(rows.indexOf(current),1);rows.unshift(current);}
 return rows;
}
module.exports={candidates};
