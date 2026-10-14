'use strict';
class AstralProgress{
 constructor(){this.rows=[];this.previous=null;}
 observe(view){
  if(!view?.fresh||view.completeness!=='full'||!Number.isFinite(view.state?.s)||!Number.isFinite(view.state?.exp))return this.view(view);
  const sample={at:view.receivedAt,generation:view.generation,star:view.state.s,exp:view.state.exp,need:view.state.need};
  const previous=this.previous;
  if(previous&&sample.generation!==previous.generation){this.rows=[];this.previous=null;}
  if(this.previous&&sample.at>this.previous.at){const prior=this.previous;
   const delta=sample.star===prior.star?sample.exp-prior.exp:sample.star===prior.star+1&&Number.isFinite(prior.need)?prior.need-prior.exp+sample.exp:null;
   const ms=sample.at-prior.at;
   if(delta!=null&&ms>0&&ms<=120000){this.rows.push({delta,ms});if(this.rows.length>360)this.rows.shift();}
  }
  if(!this.previous||sample.at>this.previous.at)this.previous=sample;
  return this.view(view);
 }
 view(observation){const ms=this.rows.reduce((n,r)=>n+r.ms,0),net=this.rows.reduce((n,r)=>n+r.delta,0),rate=ms>=60000?net*3600000/ms:null,s=observation?.state;
  const need=Number.isFinite(s?.need)&&s.need>0?s.need:null;
  return {authority:'server_socket',sampleMs:ms,samples:this.rows.length,netExp:net,netExpPerHour:rate,
   progressPct:need&&Number.isFinite(s.exp)?Math.max(0,Math.min(100,100*s.exp/need)):null,
   nextStarEtaMs:observation?.fresh&&!s?.gate&&rate>0&&need?Math.max(0,need-s.exp)*3600000/rate:null,
   reason:!observation?.fresh?'waiting_fresh_server_state':s?.gate?'breakthrough_required':ms<60000?'insufficient_observation':rate<=0?'no_positive_net_star_exp':'measured_net_star_exp',
   scope:'observed server time window including death loss; ETA estimate, not a guaranteed deadline'};
 }
}
module.exports={AstralProgress};
