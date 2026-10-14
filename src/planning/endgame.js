'use strict';
const economy=require('../economy');
function assess(save,cat,wiki,{craft=null,gear=[]}={}){
 const world=cat.world||{},cap=Number.isInteger(world.MAX_LV)&&world.MAX_LV>0?world.MAX_LV:null,capped=cap!==null&&Number.isFinite(save.lv)&&save.lv>=cap;
 const nextClass=economy.nextPromotion(save.job,world),high=!!world.HIGH_CLASSES?.[nextClass],ascend=world.ASCEND||{},promotionMissing=[];
 if(nextClass){const needs={lv:high?ascend.lv:60,jobLv:high?ascend.jobLv:50,coins:high?ascend.coins:0};
  for(const [key,want]of Object.entries(needs))if(!Number.isFinite(want)||!Number.isFinite(save[key])||save[key]<want)promotionMissing.push({name:key,want:want??null,have:save[key]??null});
  if(high)for(const[name,want]of Object.entries(ascend.items||{}))if((save.materials?.[name]||0)<want)promotionMissing.push({name,want,have:save.materials?.[name]||0});
  if(high&&ascend.open!==true)promotionMissing.push({name:'class_system_closed',want:true,have:ascend.open===true});
  const capacity=world.bagCap?.(save.bagTier||0);
  if(Number.isFinite(capacity)&&Array.isArray(save.bag)&&capacity-save.bag.length<2)promotionMissing.push({name:'bag_slots',want:2,have:capacity-save.bag.length});
 }
 const jobCap=wiki?.systems?.jobExpToNext?.[world.HIGH_CLASSES?.[save.job]?'high':save.job==='novice'?'novice':'class']?.length||null;
 const reserve=require('../upgrade-reserve').reserve(save,world),held=economy.ownedNames(save),wings=cat.wingRecipes?.filter(r=>r.verified&&economy.canUse(cat.items[r.resultId],save.job,world))||[];
 const finalWings=wings.filter(r=>(cat.items[r.resultId]?.tier||0)===Math.max(0,...wings.map(w=>cat.items[w.resultId]?.tier||0)));
 const equipmentGoal=require('../equipment-goal').assess(save,cat),refineMax=equipmentGoal?world.REFINE?.max:wiki?.systems?.refine?.max,refinePending=Object.entries(save.equip||{}).filter(([slot,id])=>(equipmentGoal?equipmentGoal.rows.find(r=>r.slot===slot)?.refineSupported&&!equipmentGoal.rows.find(r=>r.slot===slot)?.refineMet:['weapon','offhand','armor','head','boots'].includes(slot)&&cat.items[id]&&(save.refine?.[id]||0)<refineMax));
 const nodes=[
  {id:'base-level',name:'เลเวลตัวละคร',status:cap===null?'needs_evidence':capped?'met':'training',detail:cap===null?'ยังไม่ทราบเพดานจากเกม':`${save.lv}/${cap}`},
  {id:'promotion',name:'อาชีพขั้นล่าสุด',status:nextClass?promotionMissing.length?'gather':'ready':'met',detail:nextClass?'เป้าหมาย '+nextClass:'ไม่มีขั้นถัดไปในอาชีพสายนี้ตามข้อมูลที่โหลด',missing:promotionMissing,branches:Object.keys(world.HIGH_CLASSES||{}).filter(id=>world.HIGH_CLASSES[id].from===save.job)},
  {id:'job-level',name:'เลเวลอาชีพ',status:jobCap===null?'needs_evidence':save.jobLv>=jobCap?'met':'training',detail:jobCap===null?'ยังไม่ทราบเพดานอาชีพ':`${save.jobLv||0}/${jobCap} · เลื่อนคลาสแล้วประเมินใหม่`},
  {id:'points',name:'สเตตัสและสกิล',status:Number.isFinite(save.pts)&&Number.isFinite(save.skPts)?save.pts||save.skPts?'ready':'met':'needs_evidence',detail:'ใช้แต้มที่เหลือด้วยแผนตามบทบาท; ไม่รับรองว่าสกิลทุกสายเหมาะที่สุด'},
  {id:'gear',name:'ชุด อาวุธ และคราฟ',status:equipmentGoal?(equipmentGoal.legendaryEquipped===equipmentGoal.legendaryTarget?'met':craft?.ready?'ready':'gather'):craft?.ready?'ready':craft||gear.length?'gather':'needs_evidence',detail:craft?.name||gear[0]?.item||'ต้องตรวจชุดเป้าหมายและผลจริงก่อนรับรองชุดสูงสุด',missing:craft?.missing||[]},
  {id:'wings',name:'ปีกและปีกขั้นถัดไป',status:wings.length?finalWings.some(r=>held.includes(r.resultId))?'met':'gather':'needs_evidence',detail:'ติดตามสูตรที่ตรวจแล้วและปีก prerequisite; ยังไม่รวมสูตรที่ไม่ทราบ'},
  {id:'refine',name:'ตีบวก',status:Number.isInteger(refineMax)&&Object.keys(save.equip||{}).length?(equipmentGoal?equipmentGoal.rows.some(r=>r.refineSupported&&!r.refineMet):refinePending.length)?'gather':'met':'needs_evidence',detail:equipmentGoal?'เป้า native +'+equipmentGoal.requestedRefine+' '+equipmentGoal.refineTargetEquipped+'/'+equipmentGoal.refine10Target:'ตรวจเฉพาะของที่ใส่ · เพดานตามข้อมูล '+(refineMax??'ไม่ทราบ')},
  ...[['quests','ภารกิจและรางวัลถาวร'],['bag','กระเป๋าและการจัดเก็บ'],['enchant','ออฟอาวุธ'],['cards','การ์ดและช่องใส่'],['pets','สัตว์เลี้ยงและความสนิท'],['bestiary','โบนัสสมุดมอน'],['guild','กิลด์และรูน'],['boss','บอสและของเฉพาะ'],['dungeons','ดันเจี้ยน หอคอย และกิจกรรมทีม']].map(([id,name])=>({id,name,status:'needs_evidence',detail:'ต้องมีตัวตรวจเงื่อนไข/เพดานและผลจริงเฉพาะระบบ; ไม่สรุปว่าตันจากเลเวล'}))
 ];
 const focus=(save.coins||0)<reserve?'focus_income':nextClass&&promotionMissing.some(m=>!['lv','jobLv','coins','class_system_closed'].includes(m.name))?'focus_promotion':craft?'focus_craft':gear.length?'focus_gear':'focus_refine';
 return {cap,capped,mode:capped?'endgame':'level-and-upgrades',jobCap,nextClass,promotionMissing,nodes,focus:capped?focus:null,complete:false,reason:capped?'เลเวลเต็มแล้ว: เลือกของและเงื่อนไขพัฒนาแทน EXP ตัวละคร':'พัฒนาเลเวลควบคู่กับอาชีพและอุปกรณ์',limits:'Coverage plan only; unknown endgame ceilings and gated adapters prevent a maximum-power claim'};
}
module.exports={assess};
