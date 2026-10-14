'use strict';
// Ranking evidence only. Native ownership, payment and recipe gates still own dispatch.
function spareReady(primary, rows, build){
 if(!primary||primary.ready||!primary.holdings)return null;
 return rows.find(c=>c.ready&&(!primary.goalPromotion||c.goalPromotion)&&c.gain>0&&c.recipeVerified&&c.verifiedBuild===build&&
  Object.entries(primary.cost||{}).every(([name,want])=>{
   const have=primary.holdings[name],spend=c.cost?.[name]||0;
   return Number.isFinite(have)&&Number.isFinite(want)&&have>=0&&want>=0&&
    Number.isFinite(spend)&&spend>=0&&have-spend>=Math.min(have,want);
  }))||null;
}
function legendaryBill(profile,build){
 const c=profile?.craft;
 return c?.goalPromotion&&c.recipeVerified&&c.verifiedBuild===build&&c.cost&&Object.values(c.cost).every(n=>Number.isSafeInteger(n)&&n>=0)?{...c.cost}:{};
}
function objective(save,cat,{role,milestones,craft,reserve,spendableCoins}){
 const equipment=require('../equipment-goal').assess(save,cat),loadout=require('../gear-value').totals(save,cat);
 return {version:1,goal:'combat_power',role,stage:milestones.stage,
  priorities:['active_pet','class','first_usable_wing','Legendary_8_and_native_refine_10','role_combat_bonuses'],
  equipment:equipment?{legendary:equipment.legendaryEquipped,target:equipment.legendaryTarget,refine10:equipment.refine10Equipped,refineTarget:equipment.refine10Target,complete:equipment.complete}:null,
  loadout:{score:loadout.unknown.length?null:loadout.score,method:loadout.method,unknown:loadout.unknown.slice(0,12)},
  funding:{reserve,spendable:Math.max(0,spendableCoins-reserve),purpose:spendableCoins<reserve?'supplies':craft?'upgrade:'+craft.id:'combat_upgrade_reserve'},
  next:craft?{id:craft.id,ready:craft.ready,estimatedGain:craft.gain,missing:craft.missing}:null,
  reason:'พัฒนาพลังตามอาชีพ: ปิดอัปเกรดที่พร้อมโดยไม่กินของเป้าหมายหลัก วัดผลสวมจริงแยกจากคะแนนประมาณ',
  evidence:'role_weighted_estimate_not_native_power_or_measured_DPS'};
}
module.exports={spareReady,objective,legendaryBill};
