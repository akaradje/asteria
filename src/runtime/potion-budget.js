'use strict';
// Serialized into the existing native shop evaluator; no external state/API.
function potionBudget({coins,price,limit=20,reserve=1000,essential=false,have=0,minimum=10,observedStock=false,observedManaStock=false}){
 if(!Number.isFinite(coins)||coins<0||!Number.isFinite(price)||price<=0||!Number.isFinite(limit)||!Number.isFinite(reserve)||reserve<0||!Number.isFinite(have)||have<0||!Number.isFinite(minimum)||minimum<0)return {qty:0,reason:'invalid current potion budget'};
 const cash=Math.floor(coins),cap=Math.max(0,Math.min(observedStock===true&&essential||observedManaStock===true&&!essential?80:20,Math.floor(limit))),normal=Math.min(cap,Math.floor(Math.max(0,cash-reserve)/price)),missing=Math.max(0,Math.ceil(minimum-have));
 // A cash reserve must not deadlock the minimum HP supply it exists to fund.
 // Emergency spending stops at the missing minimum, never at the refill cap.
 const emergency=essential&&normal<Math.min(cap,missing),qty=emergency?Math.min(cap,missing,Math.floor(cash/price)):normal;
 return {qty,emergency,reserveRemaining:cash-qty*price,reason:qty?'native-priced HP supply budget':'keep Copper reserve or insufficient Copper'};
}
module.exports={potionBudget};
