'use strict';
function assess(rows,context,{now=Date.now(),horizonMs=30000}={}){
 const matches=(rows||[]).filter(r=>r.actorId===context.actorId&&r.build===context.build&&r.sourceSignature===context.sourceSignature&&r.loadoutSignature===context.loadoutSignature&&r.map===context.map&&r.target===context.target&&r.party===context.party&&(r.ready||r.deaths>0)&&r.at<=now&&now-r.at<86400000),deaths=matches.reduce((n,r)=>n+r.deaths,0),rates=matches.map(r=>r.damageTakenPerSecond).filter(x=>Number.isFinite(x)&&x>0),pots=matches.map(r=>r.potionsPerMinute).filter(x=>Number.isFinite(x)&&x>=0);
 const incoming=rates.length?Math.max(...rates):null,requiredHp=incoming===null?null:Math.ceil(incoming*horizonMs/1000*1.5),requiredPotions=pots.length?Math.max(40,Math.ceil(Math.max(...pots)*1.5*horizonMs/60000)+20):null;
 const hp=context.currentHp,stock=context.potions,retreat=deaths>0||Number.isFinite(requiredHp)&&Number.isFinite(hp)&&hp<requiredHp||Number.isFinite(requiredPotions)&&Number.isFinite(stock)&&stock<requiredPotions;
 return {at:now,build:context.build,samples:matches.length,deaths,incomingPerSecond:incoming,requiredHp,requiredPotions,retreat,mode:retreat?'withdraw':matches.length>=3?'observed_survival':'unknown_require_native_probe',soloVerified:false,entryPermission:false,reason:retreat?'observed_death_or_conservative_survival_budget':'native_role_readiness_and_owned_probe_still_required'};
}
function view(i,now=Date.now()){const e=i.combatEvidence?.view(i,now);return e?.scope?assess(e.windows,{...e.scope,currentHp:i.vitals?.currentHp,potions:require('../runtime/survival').hpPots(i.lastSave||{})},{now}):null;}
module.exports={assess,view};
