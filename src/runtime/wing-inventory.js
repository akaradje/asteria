'use strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function space(i){const cap=i.catalog().world?.bagCap?.(i.lastSave?.bagTier||0),bag=i.lastSave?.bag;return Number.isFinite(cap)&&Array.isArray(bag)?{cap,used:bag.length,free:cap-bag.length}:null;}
async function prepare(i,{minimum=1}={}){
 if(!Number.isInteger(minimum)||minimum<1||minimum>2)return {ok:false,reason:'unsupported-inventory-minimum'};
 let before=space(i);if(!before)return {ok:false,reason:'inventory-capacity-unverified'};
 // The verified exchange UI checks one free slot BEFORE consuming prerequisite gear.
 if(before.free>=minimum)return {ok:true,...before};
 await i.expeditionAuto(false);
 await require('./capacity-recovery').reconcile(i);
 const plan=await i.planBag(i.roster),s=i.lastSave,cat=i.catalog();
 const headroom=require('./equipment-headroom'),stored=typeof i.stashItems==='function'?await headroom.storageSurplus(i):[],safe=headroom.safeSurplus(i,plan);
 let action;
 if(stored.length){action={kind:'store-surplus',result:await i.stashItems(stored,[])};
  if(headroom.storageCapacityBlocked(action.result)){
   const rows=await headroom.capacitySale(i);
   if(rows.length)action={kind:'sell-surplus',storageFailure:action.result,result:await i.sellItems(rows)};
   else action={kind:'sell-one-duplicate',storageFailure:action.result,result:await require('./capacity-recovery').sellOne(i,{minimum})};
  }
 }
 else if(safe.length){action={kind:'sell-surplus',result:await i.sellItems(safe.slice(0,2))};}
 else {
  const tier=s.bagTier,world=cat.world;
  // A known maximum is a capacity blocker; another purchase cannot free it.
  const maximum=Number.isInteger(tier)&&Array.isArray(world.BAG_PRICES)&&tier===world.BAG_PRICES.length&&Number.isFinite(world.bagCap?.(tier));
  action=maximum?{kind:'capacity-blocked',result:{ok:false,sent:false,reason:'bag-max-tier',capacity:world.bagCap(tier)}}:{kind:'bag-upgrade',result:await i.bagUpgrade()};
 }
 const r=action.result,notSent=r?.sent===false&&!r.moved&&!r.stashed&&!r.sold&&!r.id&&!r.transactionId;
 const until=Date.now()+(notSent?0:10000);while(Date.now()<until&&space(i)?.free<minimum)await sleep(500);
 if(minimum===2&&space(i)?.free===1&&action.kind==='sell-one-duplicate'&&action.result?.sold===1){const second=await require('./capacity-recovery').sellOne(i,{minimum});action={...action,second};}
 await i.closeGamePanel();const after=space(i);
 return {ok:!!after&&after.free>=minimum,before,after,action,reason:after?.free>=minimum?null:action.result?.reason||'no-confirmed-free-slot; preserve protected gear'};
}
module.exports={space,prepare};
