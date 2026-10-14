'use strict';
// Acquisition evidence ranks work; it never authorizes a payment or asserts a live boss.
const indexes=new WeakMap();
function sourceIndex(wiki){
 const monsters=wiki?.monsters?.monsters, maps=wiki?.maps?.maps;
 if(!Array.isArray(monsters)||!Array.isArray(maps))return new Map();
 const hit=indexes.get(monsters);if(hit?.maps===maps)return hit.index;
 const index=new Map();
 for(const m of monsters){
  if(!['normal','miniboss','boss'].includes(m.kind))continue;
  const locations=maps.filter(map=>map.kind==='field'&&(map.monsters?.[m.kind]||[]).includes(m.id));
  for(const d of m.dropTable||[]){
   if(!d.item||!Number.isFinite(d.ratePct)||d.ratePct<=0||d.ratePct>100)continue;
   const rows=index.get(d.item)||[];
   for(const map of locations)rows.push({monsterId:m.id,kind:m.kind,level:m.level,mapId:map.id,mapLevel:map.levelMin,ratePct:d.ratePct});
   index.set(d.item,rows);
  }
 }
 indexes.set(monsters,{maps,index});return index;
}
function portfolio(crafts,save,cat,wiki,benchmarks=new Set(),{blockedCraftIds=new Set()}={}){
 const index=sourceIndex(wiki),lv=save.lv||1;
 const rows=crafts.map(c=>{
  const requirements=c.missing.map(m=>{
   if(m.protected)return {...m,method:'protected',sources:[]};
   if(m.name==='Copper')return {...m,method:'income',sources:[]};
   if(['tokens','runeDust','Guild Token','Rune Dust'].includes(m.name))return {...m,method:'activity_currency',sources:[]};
   const sources=(index.get(m.name)||[]).filter(s=>Number.isFinite(s.level)&&s.level<=lv&&Number.isFinite(s.mapLevel)&&s.mapLevel<=lv)
    .sort((a,b)=>Number(a.kind!=='normal')-Number(b.kind!=='normal')||b.ratePct-a.ratePct||a.mapId.localeCompare(b.mapId)).slice(0,3);
   return {...m,method:sources.some(s=>s.kind==='normal')?'normal_drop':sources.length?'timed_drop':'unknown_source',sources};
  });
  const tier=c.ready?0:requirements.some(r=>['unknown_source','protected'].includes(r.method))?3:requirements.some(r=>['timed_drop','activity_currency'].includes(r.method))?2:1;
  const reason=c.ready?'ทรัพยากรพร้อม · ต้องผ่านการตรวจสูตรและผลเดิมก่อนจ่าย':tier===1?'มีแหล่งเก็บจากมอนปกติหรือขาดเงิน · ใช้เป็นขั้นพัฒนาถัดไป':tier===2?'ต้องรอบอสหรือสกุลเงินกิจกรรม · ยังไม่ถือว่าเข้าได้หรือบอสเกิด':requirements.some(r=>r.method==='protected')?'วัตถุดิบติดการกันไว้หรือถูกล็อก ไม่เสนอจ่าย':'ยังไม่มีแหล่งของที่ตรงชื่อและระดับ · เก็บเป็นเป้าหมายรอหลักฐาน';
  const fractions=Object.entries(c.cost||{}).map(([name,want])=>{const m=c.missing.find(x=>x.name===name);return want>0?(m?Math.max(0,Math.min(1,m.have/want)):1):1;});
  const path=require('./completion-path').plan({beneficiary:save.actorId,goalId:c.id,bill:c.cost,holdings:{...save.materials,Copper:save.coins},requirements,measurements:{...save.acquisitionMeasurements?._yield,...save.acquisitionMeasurements?.[c.id]},build:cat.build});return {...c,completionPath:{...path,measuredWholeCycle:save.completionEstimates?.[c.id]||null},acquisition:{tier,reason,requirements,coverage:fractions.length?fractions.reduce((a,b)=>a+b,0)/fractions.length:1,scope:'wiki sources within level range; combat, travel, live availability and payment still require runtime checks'},recipeEvidence:cat.build&&c.verifiedBuild===cat.build&&c.recipeVerified?'reviewed_loaded_build':'requires_native_validation'};
 });
 const reviewed=r=>r.recipeEvidence==='reviewed_loaded_build';
 const hasReviewed=rows.some(reviewed);
 rows.sort((a,b)=>Number(reviewed(b))-Number(reviewed(a))||Number(!!b.goalPromotion)-Number(!!a.goalPromotion)||Number(a.acquisition.tier===3)-Number(b.acquisition.tier===3)||Number(b.fillsEmpty)-Number(a.fillsEmpty)||Number(b.ready)-Number(a.ready)||Number(b.ready&&b.type==='wing')-Number(a.ready&&a.type==='wing')||a.acquisition.tier-b.acquisition.tier||(Number.isFinite(a.completionPath.etaMs)&&Number.isFinite(b.completionPath.etaMs)?a.completionPath.etaMs-b.completionPath.etaMs:0)||b.acquisition.coverage-a.acquisition.coverage||b.valuePerCopper-a.valuePerCopper||b.gain-a.gain||a.id.localeCompare(b.id));
 if(require('../equipment-goal').policy(cat).dynamicProgression){const ranked=require('./combat-roi').rank(rows.map(r=>({...r,expectedCombatGain:r.gain,expectedDurationMs:r.ready?30000:r.completionPath?.etaMs})));rows.splice(0,rows.length,...ranked);}
 const eligible=rows.filter(r=>!blockedCraftIds.has(r.id));
 const primary=eligible.find(r=>!r.acquisition.requirements.some(m=>m.protected))||null;
 const opportunity=require('../equipment-goal').policy(cat).dynamicProgression?null:require('./combat-priority').spareReady(primary,eligible,cat.build);
 const selected=opportunity?{...opportunity,combatOpportunity:{primaryId:primary.id,protectedBill:primary.cost,reason:'พร้อมเพิ่มพลังได้โดยไม่ลดเงินหรือวัตถุดิบที่มีสำหรับช่องเป้าหมายหลัก'}}:primary;
 const aspirational=[...rows].sort((a,b)=>b.gain-a.gain||a.id.localeCompare(b.id))[0]||null;
 const workCandidates=eligible.filter(r=>(!hasReviewed||reviewed(r))&&r.id!==selected?.id&&!r.ready&&!r.acquisition.requirements.some(m=>m.protected)).map(({id,name,gain,fillsEmpty,missing})=>({id,name,gain,fillsEmpty,missing}));
 return {selected,aspirational,alternatives:eligible.filter(r=>r.id!==selected?.id).slice(0,6),quarantined:rows.filter(r=>blockedCraftIds.has(r.id)).map(r=>({id:r.id,name:r.name,reason:'original craft outcome unknown; no replay'})),workCandidates,count:rows.length,reason:selected?.combatOpportunity?.reason||selected?.acquisition.reason||(rows.length?'วัตถุดิบสูตรที่เหลือล็อกไว้ รอเปลี่ยนแผนโดยไม่สั่งเก็บหรือจ่ายซ้ำ':'ยังไม่มีสูตรที่เพิ่มคะแนนชุดและใช้ได้ตามอาชีพ/เลเวล'),method:'attainable_upgrade_milestones_not_proven_optimal'};
}
module.exports={portfolio,sourceIndex};
