'use strict';
const economy=require('../economy');
// Native ownership/equipment is the milestone, never a wishlist or a sent command.
function assess(save={},cat={}){
 const known=cat.world?.MONSTERS,owned=Object.keys(save.pets||{}).filter(id=>Number.isFinite(save.pets[id])&&save.pets[id]>=0&&(!Array.isArray(known)||known.some(m=>m.id===id)));
 const pet=owned.includes(save.petActive),nextClass=economy.nextPromotion(save.job,cat.world),id=save.equip?.wing,item=cat.items?.[id];
 const wing=!!(id&&item?.slot==='wing'&&(item.reqLv||1)<=(save.lv||1)&&economy.canUse(item,save.job,cat.world));
 const stage=!pet?'pet':nextClass?'class':!wing?'wing':'equipment';
 const reason={pet:'ต้องมีสัตว์เลี้ยงที่เป็นเจ้าของและใช้งานจริงอย่างน้อย 1 ตัวก่อน',class:'เลื่อนคลาสเป็น '+nextClass+' ก่อนปีกและงานอุปกรณ์',wing:'ต้องมีปีกที่ใช้ได้สวมจริงอย่างน้อย 1 ชิ้นก่อนงานอุปกรณ์',equipment:'สัตว์เลี้ยง คลาส และปีกขั้นต่ำครบแล้ว พัฒนาอุปกรณ์สู่เพดานที่ตรวจจากเกม'}[stage];
 return {version:1,order:['pet','class','wing','equipment'],stage,pet,ownedPets:owned.length,nextClass,wing,wingId:wing?id:null,equipmentAllowed:stage==='equipment',reason};
}
function filter(candidates,p,craft){
 if(!p||p.equipmentAllowed)return candidates;
 const blocked=new Set(['gear','gear-hunt','refine','equipment-drill','craft-work','craft-wait','team-gather']);
 return candidates.filter(c=>!blocked.has(c.kind)&&(c.kind!=='craft'||p.stage==='wing'&&craft?.type==='wing')&&(c.kind!=='wing'||p.stage==='wing')&&(c.kind!=='promotion'||p.stage==='class')&&(c.kind!=='pet-unlock'||p.stage==='pet'));
}
module.exports={assess,filter};
