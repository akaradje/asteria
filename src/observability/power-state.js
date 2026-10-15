'use strict';
// Only native numeric effects and owned/worn IDs in public projections. The
// current wallet is private receipt input, never part of telemetry or JSON.
const monotonic=()=>require('node:perf_hooks').performance.now();
const ids=v=>Array.isArray(v)&&v.length<=512&&v.every(x=>/^[a-zA-Z0-9_:-]{1,100}$/.test(x))?[...new Set(v)]:null;
const bookReceipts=new WeakMap();
class PowerState{
 reset(generation=0){this.generation=generation;this.combatDomain=null;this.premium=null;this.guild=null;this.premiumSequence=0;this.combat=new(require('./combat-state').CombatState)();this.combat.reset(generation);bookReceipts.delete(this);}
 constructor(){this.reset();}
 receive(m,at=Date.now()){
  if(['mons','mspawn'].includes(m?.t)&&typeof(m.room||m.r)==='string')this.combatDomain=require('./combat-domain').classify(m.room||m.r);
  this.combat.receive(m,at);
  if(m?.t==='prem'){const owned=ids(m.owned),book=ids(m.book||[]),worn=m.worn;if(!owned||!book||!worn||typeof worn!=='object'||Array.isArray(worn)||Object.keys(worn).length>20||Object.values(worn).some(x=>x!=null&&(typeof x!=='string'||x.length>100))){bookReceipts.delete(this);return false;}let boost=null;const b=m.boost;if(b&&typeof b.on==='boolean'&&[b.day,b.bank,b.pct].every(Number.isFinite)&&b.day>=0&&b.bank>=0&&b.pct>=0&&b.pct<=5)boost={on:b.on,day:b.day,bank:b.bank,pct:b.pct};this.premium={at,monotonicAt:monotonic(),generation:this.generation,state:{owned,book,worn:{...worn},boost},authority:'server_socket'};this.premiumSequence++;bookReceipts.delete(this);if(Array.isArray(m.book)&&Number.isSafeInteger(m.coins)&&m.coins>=0)bookReceipts.set(this,{...this.premium,sequence:this.premiumSequence,coins:m.coins});return true;}
  if(m?.t==='guild'){const runes=m.id?m.runes:{};if(!runes||typeof runes!=='object'||Array.isArray(runes)||Object.keys(runes).length>32||Object.entries(runes).some(([k,v])=>k.length>40||!Number.isSafeInteger(v)||v<0||v>100))return false;this.guild={at,monotonicAt:monotonic(),generation:this.generation,runes:{...runes},authority:'server_socket',hasGuild:!!m.id};return true;}return false;
 }
 enrich(i,save,now=Date.now()){
  delete save.premiumRulesInput;delete save.guildRunesInput;delete save.guildRuneObservation;
  const fresh=row=>row&&row.generation===i.socialInbox?.generation&&now>=row.at&&now-row.at<=120000&&Math.abs((now-row.at)-(monotonic()-row.monotonicAt))<1500;
  if(!i.actorIdentity?.actorId)return save;
  if(fresh(this.premium))save.premiumRulesInput={...this.premium,actorId:i.actorIdentity.actorId};
  if(fresh(this.guild)){save.guildRunesInput=this.guild.runes;save.guildRuneObservation={at:this.guild.at,generation:this.guild.generation,actorId:i.actorIdentity.actorId,authority:this.guild.authority};}return save;
 }
 view(now=Date.now()){return {combat:this.combat.view(),combatDomain:this.combatDomain,generation:this.generation,premiumObservedAt:this.premium?.at||null,guildObservedAt:this.guild?.at||null,premiumFresh:!!this.premium&&now>=this.premium.at&&now-this.premium.at<=120000,guildFresh:!!this.guild&&now>=this.guild.at&&now-this.guild.at<=120000,authority:this.premium||this.guild?'server_socket':null,serverVerified:!!(this.premium||this.guild)};}
 bookView(i,now=Date.now()){
  const r=bookReceipts.get(this);
  if(!r||i.socialInbox?.power!==this||!i.actorIdentity?.actorId||r.generation!==i.socialInbox.generation||now<r.at||now-r.at>15000||Math.abs((now-r.at)-(monotonic()-r.monotonicAt))>=1500)return null;
  return {...r,actorId:i.actorIdentity.actorId,state:structuredClone(r.state)};
 }
}
module.exports={PowerState};
