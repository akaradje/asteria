'use strict';
// Conservative owned-stock choice, not permission to buy or repeat a payment.
function evaluate(save,world,from,consumables=save.consumables||{}){
 const rules=world?.REFINE,stone=world?.STONES?.refine,base=rules?.chance?.[from],have=consumables[stone?.name]||0,add=stone?.add;
 const valid=Number.isSafeInteger(from)&&from>=0&&from<rules?.high&&Number.isFinite(base)&&base>0&&base<100&&Number.isFinite(add)&&add>0&&add<=100&&typeof stone?.name==='string'&&Number.isSafeInteger(have)&&have>1;
 const chance=valid?Math.min(100,base+add):base,saved=valid?100/base-100/chance:0,use=valid&&base<=20&&saved>=1;
 return {use,name:stone?.name||null,baseChancePct:base,boostedChancePct:use?chance:base,owned:have,reserve:1,estimatedAttemptsSaved:use?saved:0,estimated:true,reason:use?'owned_native_boost_preserve_one_stone':'keep_stock_or_unverified_low_risk_value',purchaseAllowed:false};
}
module.exports={evaluate};
