'use strict';
const crypto=require('crypto'),economy=require('../economy');
function inventory(s,cat){const available={...s.materials,...s.keyItems,...s.consumables,Copper:s.coins||0,'Rune Dust':s.runeDust||0,'Guild Token':s.tokens||0,'Boar Leaf':s.leaves||0};for(const id of economy.ownedNames(s)){const name=cat.items[id]?.name;if(name)available[name]=(available[name]||0)+1;}available.Copper=Math.max(0,available.Copper-require('../upgrade-reserve').reserve(s,cat.world));if(Object.values(cat.world?.HIGH_CLASSES||{}).some(c=>c.from===s.job))for(const k of require('../upgrade-reserve').cores)available[k]=Math.max(0,(available[k]||0)-1);return available;}
function estimate(i,name,args){
 const cat=i.catalog(),s=i.lastSave,wiki=economy.withNativeRecipes(economy.loadWiki(i.root),cat);
 if(name==='craftAtExchange'){const r=wiki?.crafting?.recipes?.find(r=>r.result===args[0]);return r?{targetId:require('./craft-scope').target(i,args[0]),cost:Object.fromEntries(Object.entries(r.cost).map(([key,value])=>[key==='tokens'?'Guild Token':key==='runeDust'?'Rune Dust':key==='coins'?'Copper':key,value])),args}:null;}
 if(name==='enchantWeapon'){if(i.registryV32)return null;const p=require('../enchant-plan').plan(s,cat.items,cat.world,wiki);return p.ready?{cost:{Copper:p.cost.coins,'Rune Dust':p.cost.dust,'Guild Token':p.cost.tokens,...(p.rune?{'Ancient Rune':1}:{})},args}:null;}
 if(name==='refineEquipped'){
  const options=args[0]||{},protectedMaterials=options.reservedMaterials||{},extra=options.extraReserveCoins??0;
  if(!Number.isFinite(extra)||extra<0||typeof protectedMaterials!=='object'||Object.values(protectedMaterials).some(n=>!Number.isFinite(n)||n<0))return null;
  const foundation=options.foundation===true&&options.guaranteedOnly===true&&require('../equipment-goal').policy(cat).bridgeOwned===true&&s.lv>=20&&s.lv<cat.world.MAX_LV;
  const materials=Object.fromEntries(Object.entries(s.materials||{}).map(([k,v])=>[k,Math.max(0,v-(protectedMaterials[k]||0))]));
  const p=economy.refinePlan({...s,materials,coins:Math.max(0,inventory(s,cat).Copper-extra),items:cat.items,world:cat.world,wiki,maxChanceDrop:options.maxChanceDrop??0,foundation,state:s});
  const base=require('../gear-value').totals(s,cat).score;
  const steps=p.doable.filter(x=>(!options.targetId||x.id===options.targetId)&&(!options.guaranteedOnly||x.guaranteed)).map(x=>({...x,gain:Math.max(0,require('../gear-value').totals({...s,refine:{...s.refine,[x.id]:(s.refine?.[x.id]||0)+1}},cat).score-base)*x.chancePct/100/Math.max(1,x.coinCost)})).filter(x=>!x.foundation||x.gain>0).sort((a,b)=>b.gain-a.gain);
  const step=steps[0];return step?{cost:step.cost||{Copper:step.coinCost,[step.oreName]:step.oreNeed},args:[{...options,targetId:step.id,maxAttempts:1}]}:null;
 }
 return null;
}
// Planning and dispatch see the same durable claims, including unknown older
// builds. Only the claim currently executing inside the scheduler is excluded.
function heldResources(i){const held={...(i.v2?.reservations?.totals(i.catalog().build,i.activeResourceClaim?.id)||{})};if(i.actorIdentity?.actorId)for(const[k,n]of Object.entries(i.registryV32?.store?.held(i.actorIdentity.actorId)||{}))held[k]=(held[k]||0)+n;return held;}
function preflight(i,name,args){
 if(!require('./legacy-material-reserve').verified(i))return {allowed:false,reason:'historical reserve archive or replay fence invalid',missing:[]};
 const row=estimate(i,name,args);if(name==='craftAtExchange'&&require('./craft-scope').blocking(i,row?.targetId))return {allowed:false,reason:'original craft outcome fenced; no replay',missing:[]};if(!row)return {allowed:false,reason:'no executable paid estimate',missing:[]};
 if(name==='refineEquipped'&&require('./refine-scope').blocks(i,row.args?.[0]?.targetId))return {allowed:false,reason:'unknown refinement step or journal outcome; no replay',missing:[]};
 const cat=i.catalog(),available=inventory(i.lastSave,cat),held=heldResources(i);
 const campaign=i.endgameCampaign,wingCraft=name==='craftAtExchange'&&campaign?.phase==='wing'&&args[0]===campaign.wing?.name;
 if(campaign?.phase==='wing'&&campaign.active&&!wingCraft){
  const bill=require('../planning/campaign-equipment').reserve(i);
  if(!bill)return {allowed:false,reason:'verified wing bill required before other paid equipment work',missing:[]};
  for(const [key,n]of Object.entries(bill))available[key]=Math.max(0,(available[key]||0)-n);
 }
 const missing=Object.entries(row.cost).filter(([key,n])=>!Number.isFinite(n)||n<0||(available[key]||0)-(held[key]||0)<n).map(([key,n])=>({name:key,need:n,available:Math.max(0,(available[key]||0)-(held[key]||0)),reserved:held[key]||0}));
 return {allowed:!missing.length,reason:missing.length?'insufficient unreserved resources':null,missing,row};
}
function installPaidActions(GameInstance){for(const name of ['craftAtExchange','refineEquipped','enchantWeapon']){
 const original=GameInstance.prototype[name];if(!original)continue;
 GameInstance.prototype[name]=function(...args){const v=this.v2;if(!v?.reservations)return original.apply(this,args);return v.scheduler.run('reserve-'+name,async()=>{
  if(args[0]?.dryRun)return original.apply(this,args);
  if(name==='craftAtExchange'?require('./craft-scope').blocking(this,require('./craft-scope').target(this,args[0])):this.developmentLedger?.blocking({refineEquipped:'refine',enchantWeapon:'enchant'}[name]))return {ok:false,refined:0,reason:'existing development result awaiting reconciliation'};
  if(v.trial?.active())return {ok:false,refined:0,reason:'paid work paused during zero-spend trial'};
  const check=preflight(this,name,args);if(!check.allowed)return {ok:false,refined:0,reason:check.reason,missing:check.missing};
  const estimateRow=check.row,cat=this.catalog(),build=cat.build||require('path').basename(this.cache.dir),id=crypto.randomUUID(),reserved=v.reservations.reserve(id,estimateRow.cost,inventory(this.lastSave,cat),{build});
  if(!reserved.ok)return {ok:false,refined:0,reason:reserved.reason};
  const tracked=original.paidDispatchTracked===true;
  v.reservations.started(id,{trackDispatch:tracked});const previousClaim=this.activeResourceClaim;this.activeResourceClaim={id,name,tracked};
  try{
   const result=await original.apply(this,estimateRow.args),claim=v.reservations.data.claims.find(c=>c.id===id);
   const ledger=this.developmentLedger?.view()?.find(r=>r.id===claim.transactionId),status=ledger?.status;
   v.reservations.finish(id,['server_confirmed','server_no_increase','reconciled_increase','reconciled_no_increase'].includes(status)?'CONFIRMED':status==='not_sent'||!claim.transactionId&&result?.reservationNotSent===true?'CANCELLED':'UNCERTAIN');return result;
  }catch(e){const claim=v.reservations.data.claims.find(c=>c.id===id),row=this.developmentLedger?.rows?.find(r=>r.id===claim?.transactionId);if(!v.reservations.cancelPreparation(id))v.reservations.finish(id,row?.status==='not_sent'&&row.evidence==='failed_before_native_payment_dispatch'?'CANCELLED':'UNCERTAIN');throw e;}finally{this.activeResourceClaim=previousClaim;}
 });};
 GameInstance.prototype[name].paidDispatchTracked=original.paidDispatchTracked===true;
}}
module.exports={installPaidActions,inventory,estimate,preflight,heldResources};
