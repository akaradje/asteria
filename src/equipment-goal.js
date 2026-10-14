'use strict';
const fs=require('fs'),path=require('path'),contexts=new WeakMap();
const slots=['weapon','offhand','head','armor','boots','wing','acc1','acc2'];
function read(root){try{const p=JSON.parse(fs.readFileSync(path.join(root,'machines','equipment-goal.json'),'utf8'));if(p.enabled===true&&p.rarity==='legendary'&&(p.refine==='native-max'||Number.isSafeInteger(p.refine)&&p.refine>=0))return {...p,enabled:true,rarity:'legendary',nativeMax:p.refine==='native-max'||p.nativeMax===true,dynamicProgression:p.dynamicProgression===true,top10Progression:p.top10Progression===true,bridgeOwned:p.bridgeOwned===true,freshRefineAfterClosedOutcome:p.freshRefineAfterClosedOutcome===true,adaptiveNormalMaterials:p.adaptiveNormalMaterials===true,unsupportedRefineSlots:[]};}catch{}return {enabled:false};}
function target(cat,slot='weapon'){const p=policy(cat),c=require('./knowledge/refine-capability').support(slot,cat.world);return p.nativeMax||p.refine==='native-max'?c.state==='supported'?c.max:null:Number.isSafeInteger(p.refine)?p.refine:null;}
function configure(cat,p){cat.equipmentGoal=p;contexts.set(cat.items,p);return cat;}
// Legacy helpers carry {items,world} rather than the full catalog. Keep their
// policy context without putting a non-item entry in the native item dictionary.
function policy(cat){return cat?.equipmentGoal||contexts.get(cat?.items)||{enabled:false};}
function priority(comparison){return (comparison?.goalPromotion?10000:0)+Math.max(0,comparison?.gain||0);}
function assess(save,cat){
 const p=policy(cat);if(!p.enabled)return null;
 const rows=slots.map(slot=>{const id=save.equip?.[slot],it=cat.items[id],duplicate=id&&Object.entries(save.equip||{}).some(([k,v])=>k!==slot&&v===id),capability=require('./knowledge/refine-capability').support(slot,cat.world),refineSupported=capability.state==='supported',nativeMax=capability.max;
  const requestedRefine=target(cat,slot),rarityMet=!!it&&it.rarity==='legendary'&&!duplicate&&it.slot===(slot.startsWith('acc')?'acc':slot)&&require('./economy').canUse(it,save.job,cat.world)&&(it.reqLv||1)<=(save.lv||1),refine=save.refine?.[id]||0,ruleVerified=capability.state==='unsupported'||refineSupported&&Number.isInteger(nativeMax)&&Number.isInteger(requestedRefine)&&nativeMax>=requestedRefine;
  const refineMet=refineSupported&&rarityMet&&ruleVerified&&refine>=requestedRefine;
  return {slot,id:id||null,name:it?.name||'ช่องว่าง',rarity:it?.rarity||null,requiredRarity:p.rarity,rarityMet,refine,requestedRefine,refineSupported,refineState:capability.state,refineEvidence:capability.evidence||null,refineMet,nativeMax:refineSupported?nativeMax??null:null,ruleVerified,complete:rarityMet&&ruleVerified&&(!refineSupported||refineMet),stage:!rarityMet?'acquire_legendary':!ruleVerified?'review_native_refine_limit':refineMet?'done':refineSupported?'refine_to_native_target':'unsupported_refine'};
 });
 return {rarity:'legendary',requestedRefine:target(cat),dynamic:p.dynamicProgression===true,legendaryEquipped:rows.filter(r=>r.rarityMet).length,legendaryTarget:slots.length,refineTargetEquipped:rows.filter(r=>r.refineMet).length,refine10Equipped:rows.filter(r=>r.rarityMet&&r.refineSupported&&r.refine>=10).length,refine10Target:rows.filter(r=>r.refineSupported).length,unknownRefineSlots:rows.filter(r=>r.refineState==='unknown').map(r=>r.slot),unsupportedRefineSlots:rows.filter(r=>r.refineState==='unsupported').map(r=>r.slot),complete:rows.every(r=>r.complete),rows,method:'observed equipped rarity/refinement under loaded native rules; not measured DPS or server receipt'};
}
module.exports={read,configure,policy,priority,assess,target};
