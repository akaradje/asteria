'use strict';
function plan(save,world){
 const prices=world?.BAG_PRICES,tier=save?.bagTier;
 if(!Array.isArray(prices)||!prices.length||prices.some(p=>!Number.isFinite(p)||p<=0)||!Number.isInteger(tier)||tier<0||tier>prices.length||typeof world.bagCap!=='function')return {ready:false,reason:'bag rules or current tier unverified'};
 const maxTier=prices.length,capacity=world.bagCap(tier),maxCapacity=world.bagCap(maxTier),reserve=Math.max(1000,(save.lv||1)*100);
 if(!Number.isFinite(capacity)||!Number.isFinite(maxCapacity)||capacity>maxCapacity)return {ready:false,reason:'bag capacity unverified'};
 const remainingCost=prices.slice(tier).reduce((n,p)=>n+p,0),price=prices[tier]||0,complete=tier===maxTier;
 return {policy:'maximum-capacity',tier,maxTier,capacity,maxCapacity,remainingCost,reserve,price,complete,ready:!complete&&Number.isFinite(save.coins)&&save.coins-price>=reserve,reason:complete?'กระเป๋าขยายสูงสุดแล้ว':save.coins-price>=reserve?'ขยายทีละขั้นจนสูงสุดและตรวจเซฟทุกครั้ง':'เงินยังไม่พอหลังกันค่ายา · หาเงินแล้วขยายต่อ'};
}
async function tick(i,screen,now=Date.now()){
 const state=plan(i.lastSave,i.catalog().world);i.bagDevelopment={...state,at:now,saveAt:i.lastSaveAt,result:i.bagDevelopment?.result};
 if(state.complete||!state.ready||!i.lastSaveAt||now-i.lastSaveAt>30000||now-i.lastSaveAt < -5000||screen.death||screen.panelOpen||i.teamControl||i.choresBusy||i.recycling||i.pendingTravel||require('./room-policy').roomPolicy(i.livePos?.room).dungeon)return null;
 if(now<(i.maximumBagRetryAt||0)||!i.canDo('maximumBag',5000))return null;
 try{const result=await i.bagUpgrade({toMaximum:true});const after=plan(i.lastSave,i.catalog().world);i.bagDevelopment={...after,at:Date.now(),saveAt:i.lastSaveAt,result};
  if(!result.ok){i.maximumBagRetryAt=Date.now()+120000;return 'bag maximum: '+(result.reason||'waiting for tier confirmation');}
  return 'bag confirmed '+after.capacity+'/'+after.maxCapacity+' slots';
 }finally{await i.closeGamePanel();}
}
module.exports={plan,tick};
