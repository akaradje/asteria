'use strict';
class CharacterTelemetry{
 constructor(reports,slot,name){this.reports=reports;this.slot=slot;this.name=name;this.previous=null;}
 observe(i,now=Date.now()){
  const s=i.lastSave,p=i.livePos,v=i.vitals;if(!s||!p||!v||now-i.lastSaveAt>30000||now-p.at>10000||now-v.at>15000||i.lastSaveAt>now||p.at>now||v.at>now||i.recycling||i.choresBusy){this.previous=null;return;}
  const sample={at:now,saveAt:i.lastSaveAt,room:p.room,dead:p.dead,hp:s.hp,mp:s.mp,mpRatio:v.mp,potions:s.potions,cons:s.consumables||{},materials:s.materials||{},keys:s.keyItems||{},lv:s.lv,job:s.job};const prev=this.previous;this.previous=sample;if(!prev||now<=prev.at||now-prev.at>30000||prev.room!==sample.room||prev.lv!==sample.lv||prev.job!==sample.job||prev.dead||sample.dead)return;
  const dt=now-prev.at,b=this.reports.bucket(this.slot,now);this.reports.row(this.slot,this.name());b.telemetryObservedMs=(b.telemetryObservedMs||0)+dt;if(sample.mpRatio<=.1&&prev.mpRatio<=.1)b.lowMpMs=(b.lowMpMs||0)+dt;
  if(sample.saveAt!==prev.saveAt){if(Number.isFinite(sample.hp)&&Number.isFinite(prev.hp)){b.hpLossObserved=(b.hpLossObserved||0)+Math.max(0,prev.hp-sample.hp);b.hpRecoveryObserved=(b.hpRecoveryObserved||0)+Math.max(0,sample.hp-prev.hp);}if(Number.isFinite(sample.mp)&&Number.isFinite(prev.mp))b.mpUsedObserved=(b.mpUsedObserved||0)+Math.max(0,prev.mp-sample.mp);
   b.consumablesUsedObserved ||= {};for(const [k,n]of Object.entries(prev.cons))if(Number.isFinite(n)&&Number.isFinite(sample.cons[k]))b.consumablesUsedObserved[k]=(b.consumablesUsedObserved[k]||0)+Math.max(0,n-sample.cons[k]);
   b.materialNet ||= {};for(const group of ['materials','keys'])for(const k of new Set([...Object.keys(sample[group]),...Object.keys(prev[group])])){const change=(sample[group][k]||0)-(prev[group][k]||0);if(change)b.materialNet[group+':'+k]=(b.materialNet[group+':'+k]||0)+change;}
  }this.reports.flush(now);
 }
}
module.exports={CharacterTelemetry};
