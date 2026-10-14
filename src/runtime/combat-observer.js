'use strict';
// The shipped client consumes dmgs as [monsterNumber, damage, attackerId].
// Only server frames attributed to this connection are included; chat is never retained.
class CombatObserver {
 constructor(reports,slot,name,{now=Date.now,lab=()=>false}={}){this.reports=reports;this.slot=slot;this.name=name;this.now=now;this.lab=lab;this.id=null;}
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
  if(m.t==='welcome'&&(typeof m.id==='number'||typeof m.id==='string')){this.id=m.id;this.reports.startCombat(this.slot,this.name(),this.now());return;}
  if(this.lab())return;
  if(this.id===null)return;
  if(m.t==='pvhit'&&!m.m&&Number.isFinite(m.d)&&m.d>0){if(String(m.b)===String(this.id))this.reports.combatMetric(this.slot,this.name(),'damageTakenServer',m.d,this.now());if(String(m.a)===String(this.id))this.reports.damage(this.slot,this.name(),m.d,this.now());}
  if(m.t==='pvheal'&&String(m.b)===String(this.id)&&Number.isFinite(m.v)&&m.v>0)this.reports.combatMetric(this.slot,this.name(),'healReceivedServer',m.v,this.now());
  if(m.t==='psup'&&['heal','sanctum_bloom','hexwing_sanctuary'].includes(m.sk)&&Number.isFinite(m.amt)&&m.amt>0)this.reports.combatMetric(this.slot,this.name(),'healOfferedReceived',m.amt,this.now());
  if(m.t==='psupok'&&Number.isFinite(m.n))this.reports.combatMetric(this.slot,this.name(),'supportRecipients',m.n,this.now());
  if(m.t!=='dmgs'||!Array.isArray(m.l))return;
  for(const hit of m.l.slice(0,1000))if(Array.isArray(hit)&&String(hit[2])===String(this.id)&&Number.isFinite(hit[1])&&hit[1]>0)
   this.reports.damage(this.slot,this.name(),hit[1],this.now());
 }
}
module.exports={CombatObserver};
