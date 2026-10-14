'use strict';
const economy=require('../economy');
function assessWithWing(save,cat,wiki,progression,wing){
 const milestones=require('./progression-priority').assess(save,cat);
 if(milestones.stage==='pet')return {active:false,phase:'pet',reason:milestones.reason};
 const next=progression.nextClass,missing=progression.promotionMissing||[];
 if(next&&missing.some(m=>['lv','jobLv'].includes(m.name)))return {active:false,phase:'class-training',target:next,missing,reason:'เก็บเลเวล / Job Lv ให้ถึงเงื่อนไขเลื่อนคลาสก่อน'};
 if(next)return {active:true,phase:'class',target:next,ready:missing.length===0,missing,requirements:Object.entries(cat.world.ASCEND?.items||{}).map(([name,want])=>({name,want,have:save.materials?.[name]||0})),reason:missing.length?'เก็บเงื่อนไขเลื่อนคลาสก่อน ห้ามใช้แกนบอสไปคราฟปีก':'เงื่อนไขครบ เลื่อนคลาสและตรวจ save ใหม่'};
 const ownedWing=economy.ownedNames(save).find(id=>cat.items[id]?.slot==='wing'&&(cat.items[id].reqLv||1)<=save.lv&&economy.canUse(cat.items[id],save.job,cat.world));
 // Equipping a prerequisite unlocks basic readiness, not completion of the
 // final-wing campaign. Do not repeatedly equip that prerequisite while a
 // verified higher tier is still missing, or choose it over an owned final wing.
 if(ownedWing&&!milestones.wing&&!wing?.completed)return {active:true,phase:'equip',target:ownedWing,ready:true,missing:[],reason:'มีปีกใช้งานแล้ว สวมและตรวจเซฟก่อนเดินคิวปีกปลายทางต่อ'};
 if(wing?.levelOk===false)return {active:false,phase:'wing-training',missing:[{name:'lv',want:wing.reqLv,have:save.lv}],reason:'เก็บเลเวลให้ถึงปีกขั้นต่ำก่อน'};
 if(!wing?.recipeVerified)return {active:true,phase:'blocked',reason:wing?.blockedReason||'ยังไม่มีสูตรปีกที่ตรวจตรงกับเกม',missing:[]};
 if(wing.completed){const equipped=save.equip?.wing===wing.finalTarget;return {active:!equipped,phase:equipped?'complete':'equip',target:wing.finalTarget,wing,ready:true,missing:[],reason:equipped?'คลาสล่าสุดและปีกปลายทางสวมจริงแล้ว':'มีปีกปลายทางแล้ว ต้องตรวจการสวมจริง'};}
 return {active:true,phase:'wing',target:wing.target,wing,ready:wing.craftable,missing:wing.requirements.filter(r=>r.short>0).map(r=>({...r,have:r.usable,want:r.want})),requirements:wing.requirements,reason:wing.craftable?'สูตรปีกและทรัพยากรพร้อม คราฟหนึ่งขั้นแล้วตรวจของจริง':'เก็บปีก prerequisite ตามสูตรที่ตรวจแล้ว'};
}
function plan(instance){const cat=instance.catalog(),save=instance.lastSave||{};if(!cat.world?.MAX_LV)return {active:false};const wiki=economy.loadWiki(instance.root),progression=require('./endgame').assess(save,cat,wiki),wing=economy.wingPlan({job:save.job,lv:save.lv,coins:save.coins,materials:save.materials,held:economy.ownedNames(save),world:cat.world,items:cat.items,wings:economy.loadWings(instance.root,cat.build),recipes:wiki?.crafting?.recipes||[]});return assessWithWing(save,cat,wiki,progression,wing);}
function chooseHunt(plan,save,wiki,board,now=Date.now(),blocked={},ctx=null){
 const idx=require('../director').mapIndex(wiki),sources=[];const rows=wiki?.monsters?.monsters||[];
 const boardFresh=!!(board&&Number.isFinite(board.now)&&Number.isFinite(board._receivedAt)&&now-board._receivedAt>=0&&now-board._receivedAt<45000);
 for(const need of plan.missing||[]){if(['lv','jobLv','coins','Copper','bag_slots','class_system_closed'].includes(need.name))continue;
  for(const m of rows){const drop=m.dropTable?.find(d=>d.item===need.name);if(!drop)continue;for(const mapId of idx[m.id]||[]){if(blocked[mapId]||m.level>(save.lv||1)+2)continue;const map=wiki.maps.maps.find(x=>x.id===mapId);if(!map||map.levelMin>save.lv)continue;
   const boss=['boss','miniboss'].includes(m.kind);
   if(ctx&&!boss&&!require('./progression-work').allowedSource(m,map,save,ctx))continue;
   // Tracking an authoritative respawn is separate from permission to fight.
   // allowedSource requires an already-live boss and used to erase every timer.
   const combatEligible=!ctx||!boss||require('./progression-work').combatProof(m,map,save,ctx);
   const routeProof=['class','wing'].includes(plan.phase)&&boss?ctx?.firstClearRouteProof?.(m,map):null;
   const routeEligible=combatEligible||routeProof?.allowed===true;
   const field=boardFresh?board.list?.find(x=>x.id===m.id&&x.map===mapId):null,skew=boardFresh?board._receivedAt-board.now:0;
   const alive=!boss||!!(field?.up&&!field.next);
   const nextAt=!alive&&Number.isFinite(field?.next)&&field.next>board.now?field.next+skew:null;
   sources.push({kind:plan.phase==='class'?'promotion':'wing',firstClear:boss&&!(save.bestiary?.[m.id]>0),mapId,mapName:map.name,material:need.name,monsterId:m.id,monster:m.name,monsterKind:m.kind,ratePct:drop.ratePct,alive,combatEligible,routeEligible,plannedSupport:routeProof?.plannedSupport===true,routeBlock:routeEligible?null:routeProof?.reason||null,combatBlock:combatEligible?null:ctx?.firstClearProof?.(m,map)?.reason||'ยังไม่ผ่านความพร้อมรบ / ประวัติฆ่า / ระดับปลอดภัย',boardKnown:!boss||!!field,boardAt:boardFresh?board._receivedAt:null,nextAt,short:need.short??need.want-need.have,score:(save.mapId===mapId?100:0)+(drop.ratePct||0),label:'หา '+need.name+' · '+m.name,reason:'ต้องการ '+need.have+'/'+need.want+' · '+(boss?field?alive?'บอสอยู่ในแมพ':'รอบบอสจากเซิร์ฟเวอร์':'รอข้อมูลบอสสด':'แหล่งดรอปตาม Wiki')});
  }}
 }
 sources.sort((a,b)=>Number(b.alive)-Number(a.alive)||Number(b.boardKnown)-Number(a.boardKnown)||(a.nextAt||Infinity)-(b.nextAt||Infinity)||b.score-a.score);
 return {sources,target:sources.find(x=>x.alive&&x.combatEligible)||null,next:sources.filter(x=>x.nextAt).sort((a,b)=>a.nextAt-b.nextAt)[0]||null,boardFresh};
}
function secondaryMissing(instance){const cat=instance.catalog(),save=instance.lastSave||{},wiki=economy.loadWiki(instance.root);const wing=economy.wingPlan({job:save.job,lv:save.lv,coins:save.coins,materials:save.materials,held:economy.ownedNames(save),world:cat.world,items:cat.items,wings:economy.loadWings(instance.root,cat.build),recipes:wiki?.crafting?.recipes||[]});return wing.recipeVerified?(wing.requirements||[]).filter(r=>r.short>0).map(r=>({...r,have:r.usable})):[];}
module.exports={assessWithWing,plan,chooseHunt,secondaryMissing};
