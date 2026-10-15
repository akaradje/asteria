'use strict';
// Consume exact existing market receipts; never modify or repeat a purchase.
function view(i,now=Date.now()){
 const signature=require('../learning/completion-measurements').context(i.lastSave||{}),build=i.catalog().build,actorId=i.actorIdentity?.actorId;
 const rows=(i.v2?.journal?.rows||[]).filter(r=>r.kind==='market-class'&&r.status==='CONFIRMED'&&r.evidence==='exact_native_market_receipt_and_fresh_wallet_material_deltas'&&r.context?.actorId===actorId&&r.context.build===build&&r.context.loadoutSignature===signature&&require('../runtime/market-receipts').persisted(r)&&Number.isFinite(r.observedAt)&&r.observedAt<=now&&now-r.observedAt<3600000&&r.observedAt>=r.nativeReceipt.at&&r.nativeReceipt.at>=r.dispatchAt);
 const buyMs=rows.length?Math.max(...rows.map(r=>r.nativeReceipt.at-r.dispatchAt)):null,verifyMs=rows.length?Math.max(...rows.map(r=>r.observedAt-r.nativeReceipt.at)):null,room=i.livePos?.room;
 let travelMs=null;if(room==='town'&&i.livePos.at<=now&&now-i.livePos.at<=10000)travelMs=0;else if(typeof i.loadedSourceIdentity==='function'){const travel=require('../runtime/route-travel').view(i,{},now),a=travel[room+'>town'],b=travel['town>'+room];if(a?.build===build&&b?.build===build&&a.samples>=3&&b.samples>=3&&a.failures===0&&b.failures===0&&Number.isFinite(a.maxMs)&&Number.isFinite(b.maxMs))travelMs=a.maxMs+b.maxMs;}
 return {at:now,actorId,build,signature,samples:rows.length,buyMs,verifyMs,travelMs,receipts:rows.map(r=>r.id),estimatedFutureDuration:true,executable:false,evidence:'existing_exact_market_receipt_and_wallet_item_save_timing_plus_observed_roundtrip'};
}
module.exports={view};
