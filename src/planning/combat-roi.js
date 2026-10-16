'use strict';
// All values here are role-weighted estimates unless an explicitly comparable
// native combat measurement is supplied. Native receipts prove effects, not ROI.
function refinement(save,cat,step){
 const gear=require('../gear-value'),before=gear.totals(save,cat),after=gear.totals({...save,refine:{...save.refine,[step.id]:step.to}},cat);
 if(before.unknown.length||after.unknown.length)return {eligible:false,reason:'unpriced_native_effect',estimated:true};
 const gain=Math.max(0,after.score-before.score),p=step.chancePct/100;
 const replacement=step.spare?gear.totals({...save,refine:{...save.refine,[step.id]:0},stage:{...save.stage,[step.id]:0},holes:{...save.holes,[step.id]:0},sockets:{...save.sockets,[step.id]:[]},weaponOpts:{...save.weaponOpts,[step.id]:[]}},cat):null;
 const loss=step.destructive?replacement?Math.max(0,before.score-replacement.score):before.score:0;
 const expectedGain=p*gain-(1-p)*loss;
 return {eligible:gain>0&&expectedGain>0&&(!step.destructive||step.spare),gain,loss,expectedGain,estimated:true,guard:step.guard,reason:step.destructive&&!step.spare?'spare_required':expectedGain<=0?'negative_expected_combat_value':null,roi:expectedGain/Math.max(1,step.coinCost+(step.starNeed||0)*(cat.world.REFINE?.starCraft?.coin||0)+(step.guard?cat.world.STONES?.guard?.coin||0:0)),evidence:'native_bonus_role_weights_expected_value_not_measured_DPS'};
}
function comparableMeasurement(m,context,now){return !!m&&m.actorId===context.actorId&&m.build===context.build&&m.loadoutSignature===context.loadoutSignature&&m.job===context.job&&m.samples>=10&&m.observedMs>=300000&&Number.isFinite(m.at)&&now>=m.at&&now-m.at<86400000&&m.deaths===0&&Number.isFinite(m.combatGain)&&m.combatGain>0&&m.confounded!==true;}
function delta(before,after,cat){const g=require('../gear-value'),a=g.totals(before,cat),b=g.totals(after,cat);return a.unknown.length||b.unknown.length?null:Math.max(0,b.score-a.score);}
function astralPoint(save,cat,state){
 const r=cat.world.ASTRAL;if(!state?.p||!r?.nodes||typeof cat.world.astralBonus!=='function')return null;
 return r.nodes.map(n=>(state.p[n.id]||0)<n.max?delta({...save,astral:state},{...save,astral:{...state,s:Math.max(state.s||0,Object.values(state.p).reduce((a,n)=>a+n,0)+1),p:{...state.p,[n.id]:(state.p[n.id]||0)+1}}},cat):null).filter(Number.isFinite).sort((a,b)=>b-a)[0]??null;
}
function decorate(i,rows,now=Date.now()){
 const save=i.lastSave||{},cat=i.catalog(),astral=i.socialInbox?.astral?.view(now),context={actorId:i.actorIdentity?.actorId,build:cat.build,job:save.job,loadoutSignature:require('../learning/completion-measurements').context(save)};
 const out=rows.map(g=>{
  let gain=g.expectedCombatGain,seconds=null;
  if(!Number.isFinite(gain)&&g.itemId&&cat.items[g.itemId])gain=require('../gear-value').compare(save,cat,g.itemId).gain;
  if(g.kind==='astral-training')gain=astral?.fresh?astralPoint(save,cat,astral.state):null;
  if(g.kind==='card-collection'&&g.cardId)gain=delta(save,{...save,cardAlbum:{...save.cardAlbum,[g.cardId]:1}},cat);
  const learned=i.v2?.farmEvidence?.matching?.(save,i.v2.learningRevision||cat.build,g),combat=i.combatEvidence?.view(i,now)?.current,measuredRate=combat?.ready&&combat.actorId===context.actorId&&combat.build===cat.build&&combat.target===g.monsterId&&combat.map===g.mapId&&combat.deaths===0&&combat.killsPerHour>0?combat.killsPerHour/3600000:null;
  const rate=measuredRate??(learned?.samples>=10&&learned.ms>=300000&&!learned.deaths&&now>=learned.at&&now-learned.at<86400000?learned.kills/learned.ms:null);
  const m=cat.world.MONSTERS?.find(m=>m.id===g.monsterId),kills=g.expectedKills??g.acquisition?.expectedKills;
  if(Number.isFinite(kills)&&kills>0)seconds=rate?kills/rate/1000:m?.hp>0?kills*(2+m.hp/5000):null;
  if(g.kind==='astral-training'&&m?.exp>0&&astral?.state?.need>astral.state.exp){const left=astral.state.need-astral.state.exp;seconds=rate?left/(rate*m.exp)/1000:left/m.exp*(2+m.hp/5000);}
  const meta=i.competitiveMeta?.build===cat.build&&now>=i.competitiveMeta.at&&now-i.competitiveMeta.at<360000?i.competitiveMeta.targets?.find(t=>t.id===g.itemId):null;
  return {...g,metaBenchmark:meta?{benchmark:meta.benchmark,observedAt:meta.observedAt,estimatedBaseGain:meta.baseGain,optimalVerified:false}:null,combatRateMeasured:!!measuredRate,expectedCombatGain:gain,expectedDurationMs:g.expectedDurationMs??(Number.isFinite(seconds)?seconds*1000+Math.max(0,g.travelMs||g.acquisition?.travelMs||0):null)};
 });return require('./legendary-acquisition').prioritize(rank(out,{context,now}),save,cat);
}
function rank(rows,{context={},now=Date.now()}={}){
 const decorated=rows.map((g,n)=>{
  const m=g.combatMeasurement,measured=comparableMeasurement(m,context,now),gain=measured?m.combatGain:g.expectedCombatGain;
  const duration=measured?m.observedMs:g.expectedDurationMs??g.travelMs;
  const known=Number.isFinite(gain)&&gain>0&&Number.isFinite(duration)&&duration>0;
  const roi=known?gain/(duration+Math.max(0,g.replacementMs||0)):null;
  return {g:{...g,combatROI:{roi,known,measured,benefitMeasured:measured,estimated:!measured,evidence:measured?'comparable_native_combat_measurement':'native_effect_estimate_or_unknown'}},n};
 });
 // Existing protected ownership is binding. No fixed equipment/Astral/card/pet tier.
 decorated.sort((a,b)=>Number(b.g.ownsOperation===true)-Number(a.g.ownsOperation===true)||Number(b.g.combatROI.known)-Number(a.g.combatROI.known)||(b.g.combatROI.roi??0)-(a.g.combatROI.roi??0)||a.n-b.n);
 return decorated.map(r=>r.g);
}
function townChoice(i){
 const cat=i.catalog(),save=i.lastSave||{},out=[];
 const craft=i.developmentProgress?.target;if(craft?.ready&&craft.build!==undefined&&craft.build!==cat.build)return null;
 if(craft?.ready&&craft.id){const gain=require('../gear-value').compare(save,cat,craft.id).gain;if(gain>0)out.push({kind:'craft',expectedCombatGain:gain,expectedDurationMs:30000});}
 const held=require('../runtime/paid-actions').heldResources(i),materials=Object.fromEntries(Object.entries(save.materials||{}).map(([k,n])=>[k,Math.max(0,n-(held[k]||0))]));
 const refine=require('../economy').refinePlan({...save,materials,coins:Math.max(0,(save.coins||0)-(held.Copper||0)-require('../upgrade-reserve').reserve(save,cat.world)),items:cat.items,world:cat.world,state:save});
 for(const r of refine.doable)if(require('../runtime/paid-actions').preflight(i,'refineEquipped',[{targetId:r.id,maxAttempts:1}]).allowed)out.push({kind:'refine',expectedCombatGain:r.valuation?.expectedGain,expectedDurationMs:8000});
 const a=i.socialInbox?.astral?.view();if(i.astralObjective?.action==='asbt'&&a?.fresh){const gain=astralPoint(save,cat,{...a.state,s:(a.state.s||0)+1}),duration=Math.max(60000,Number(a.state.need)||60000);out.push({kind:'astral',expectedCombatGain:gain,expectedDurationMs:duration});}
 return rank(out)[0]?.kind||null;
}
module.exports={refinement,rank,comparableMeasurement,delta,astralPoint,decorate,townChoice};
