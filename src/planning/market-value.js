'use strict';
const amount=x=>Number.isSafeInteger(x)&&x>=0;
// Estimates only. Nothing in this module owns inventory, a listing or a wallet.
function surplus({owned,equipped=0,locked=0,ownNeed=0,teamNeed=0,held=0,buffer=0,complete=false,copySelectionVerified=false,kind}={}){
 const parts={owned,equipped,locked,ownNeed,teamNeed,held,buffer};if(!complete||Object.values(parts).some(v=>!amount(v)))return {n:0,reason:'requirements_or_inventory_unknown',executable:false};
 if(kind==='gear'&&!copySelectionVerified)return {n:0,reason:'exact_copy_selection_unverified',executable:false};
 const reserved=equipped+locked+ownNeed+teamNeed+held+buffer;if(!Number.isSafeInteger(reserved))return {n:0,reason:'amount_overflow',executable:false};
 return {n:Math.max(0,owned-reserved),reserved,reason:owned>reserved?'surplus_candidate':'reserved_for_progression',executable:false};
}
function listingValue({price,n,tax,fee,saleProbability,unsoldValue,capitalCost,opportunityCost,acquisitionCost=0}={}){
 if(!amount(price)||price<1||!amount(n)||n<1||!Number.isFinite(tax)||tax<0||tax>1||!amount(fee)||!Number.isFinite(saleProbability)||saleProbability<0||saleProbability>1||![unsoldValue,capitalCost,opportunityCost,acquisitionCost].every(v=>Number.isFinite(v)&&v>=0))return {known:false,reason:'missing_market_or_liquidity_evidence'};
 const proceeds=price-Math.floor(price*tax),expected=saleProbability*proceeds+(1-saleProbability)*unsoldValue-fee-capitalCost-opportunityCost-acquisitionCost;
 return {known:true,price,n,unitPrice:price/n,netIfSold:proceeds-fee-acquisitionCost,expectedValue:expected,estimated:true,claimedIncome:false};
}
function acquisition({buyPrice,availableCopper,reservedCopper,travelMs,buyMs,craftMs,equipMs,verifyMs,farmMs}={}){
 const values=[buyPrice,availableCopper,reservedCopper,travelMs,buyMs,craftMs,equipMs,verifyMs,farmMs];if(values.some(v=>!Number.isFinite(v)||v<0))return {choice:'observe',reason:'incomplete_full_cycle_estimate'};
 if(buyPrice>availableCopper-reservedCopper)return {choice:'farm',reason:'preserve_reserved_budget'};
 const downstream=craftMs+equipMs+verifyMs,buyTotal=travelMs+buyMs+downstream,farmTotal=farmMs+downstream;
 return {choice:buyTotal<farmTotal?'buy_candidate':'farm',buyTotalMs:buyTotal,farmTotalMs:farmTotal,estimated:true,executable:false};
}
module.exports={surplus,listingValue,acquisition};
