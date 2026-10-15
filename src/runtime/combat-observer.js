'use strict';
// The shipped client consumes dmgs as [monsterNumber, damage, attackerId].
// Only server frames attributed to this connection are included; chat is never retained.
class CombatObserver {
 constructor(reports,slot,name,{now=Date.now,lab=()=>false,instance=()=>null}={}){this.reports=reports;this.slot=slot;this.name=name;this.now=now;this.lab=lab;this.instance=instance;this.id=null;this.pve=false;this.seen=new Set();}
 receive(payload){
  if(typeof payload!=='string'||payload.length>200000)return;
  try{this.message(JSON.parse(payload),0);}catch{}
 }
 sent(payload){
  if(this.lab())return;
  if(typeof payload!=='string'||payload.length>200000)return;
  try{const m=JSON.parse(payload);if(m.t!=='hit'||!Array.isArray(m.l))return;
   for(const hit of m.l.slice(0,1000))if(Array.isArray(hit)&&Number.isFinite(hit[0])&&Number.isFinite(hit[1])&&hit[1]>0)this.reports.clientHit(this.slot,this.name(),hit[1],this.now());
  }catch{}
 }
 message(m,depth){
  if(!m||depth>3)return;
  if(m.t==='b'&&Array.isArray(m.l)){for(const row of m.l.slice(0,1000))this.message(row,depth+1);return;}
  if(m.t==='welcome'&&(typeof m.id==='number'||typeof m.id==='string')){this.id=m.id;this.pve=!!m.pve;this.seen.clear();const c=this.instance()?.combatEvidence;if(c){c.potionSequence=0;c.previousHp=null;c.deathSeen=false;}this.reports?.startCombat(this.slot,this.name(),this.now());return;}
  if(this.lab())return;
  if(this.id===null)return;
  if(m.t==='hres'&&Number.isSafeInteger(m.q)){if(this.seen.has(m.q))return;this.seen.add(m.q);if(this.seen.size>2048)this.seen.delete(this.seen.values().next().value);}
  const i=this.instance();if(i)require('../learning/combat-evidence').ensure(i)?.frame(i,m,this.id,this.now());
  if(m.t==='hres'&&Array.isArray(m.l)){this.pve=true;for(const h of m.l.slice(0,80))if(Array.isArray(h)&&Number.isFinite(h[1])&&h[1]>0)this.reports?.damage(this.slot,this.name(),h[1],this.now());return;}
  if(m.t==='phit'&&Number.isFinite(m.d)&&m.d>0)this.reports?.combatMetric(this.slot,this.name(),'damageTakenServer',m.d,this.now());
  if(m.t==='pheal'&&Number.isFinite(m.n)&&m.n>0)this.reports?.combatMetric(this.slot,this.name(),'healReceivedServer',m.n,this.now());
  if(m.t==='pvhit'&&!m.m&&Number.isFinite(m.d)&&m.d>0){if(String(m.b)===String(this.id))this.reports.combatMetric(this.slot,this.name(),'damageTakenServer',m.d,this.now());if(String(m.a)===String(this.id))this.reports.damage(this.slot,this.name(),m.d,this.now());}
  if(m.t==='pvheal'&&String(m.b)===String(this.id)&&Number.isFinite(m.v)&&m.v>0)this.reports.combatMetric(this.slot,this.name(),'healReceivedServer',m.v,this.now());
  if(m.t==='psup'&&['heal','sanctum_bloom','hexwing_sanctuary'].includes(m.sk)&&Number.isFinite(m.amt)&&m.amt>0)this.reports.combatMetric(this.slot,this.name(),'healOfferedReceived',m.amt,this.now());
  if(m.t==='psupok'&&Number.isFinite(m.n))this.reports.combatMetric(this.slot,this.name(),'supportRecipients',m.n,this.now());
  if(m.t!=='dmgs'||!Array.isArray(m.l)||this.pve)return;
  for(const hit of m.l.slice(0,1000))if(Array.isArray(hit)&&String(hit[2])===String(this.id)&&Number.isFinite(hit[1])&&hit[1]>0)
   this.reports.damage(this.slot,this.name(),hit[1],this.now());
 }
}
module.exports={CombatObserver};
