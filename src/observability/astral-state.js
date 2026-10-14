'use strict';
const NUM=['s','exp','need','g','k','sec','bt','up','died'];
const BOOL=['gate','wbNeed','wb','bsNeed','bs','wtNeed','wt','man'];
function delta(d){
 if(!d||typeof d!=='object'||Array.isArray(d))return null;
 const out={};if(d.coins!=null){if(!Number.isSafeInteger(d.coins))return null;out.coins=d.coins;}
 for(const key of ['mats','keys'])if(d[key]!=null){const entries=Object.entries(d[key]);if(entries.length>128||entries.some(([k,n])=>k.length>100||!Number.isSafeInteger(n)))return null;out[key]=Object.fromEntries(entries);}
 return out;
}
class AstralState{
 constructor(){this.progress=new(require('./astral-progress').AstralProgress)();this.reset(0);}
 reset(generation){this.progress=new(require('./astral-progress').AstralProgress)();this.generation=generation;this.state=null;this.fullAt=null;this.at=null;this.rejection=null;this.sequence=null;this.lastEvent=null;this.events=[];}
 receive(m,at,generation=this.generation){
  if(generation!==this.generation||!Number.isFinite(at)||!['as','asno'].includes(m?.t))return false;
  if(m.t==='asno'){this.rejection={reason:typeof m.why==='string'?m.why.slice(0,80):'unknown',at};return true;}
  if(Number.isInteger(m.seq)&&this.sequence!=null&&m.seq<=this.sequence)return false;
  const next=m.lite?{...(this.state||{})}:{};
  // Action/delta markers are one event, never inherited by later lite frames.
  for(const key of ['did','up','died'])delete next[key];
  for(const key of NUM)if(Number.isFinite(m[key])&&m[key]>=0)next[key]=m[key];
  for(const key of BOOL)if(typeof m[key]==='boolean'||m[key]===0||m[key]===1)next[key]=!!m[key];
  if(typeof m.gn==='string')next.gn=m.gn.slice(0,16);
  if(['bt','reset'].includes(m.did))next.did=m.did;
  if(m.p&&typeof m.p==='object'&&!Array.isArray(m.p)){
   const entries=Object.entries(m.p);if(entries.length>128)return false;
   next.p=Object.fromEntries(entries.filter(([key,value])=>/^[a-zA-Z0-9_-]{1,64}$/.test(key)&&Number.isSafeInteger(value)&&value>=0));
  }
  this.state=next;this.at=at;this.lastEvent={at,seq:Number.isInteger(m.seq)?m.seq:null,did:m.did||null,bt:next.bt,points:m.p?structuredClone(next.p):null,delta:delta(m.d)};if(m.did||m.p)this.events=[...this.events,this.lastEvent].filter(e=>at-e.at<120000).slice(-32);if(!m.lite)this.fullAt=at;
  if(Number.isInteger(m.seq))this.sequence=m.seq;
  if(m.did||m.p)this.rejection=null;
  this.progress.observe(this.view(at,false));return true;
 }
 view(now=Date.now(),withProgress=true){
  const age=this.at==null?null:now-this.at;
  const result={authority:'server_socket',generation:this.generation,completeness:this.fullAt==null?(this.state?'partial':'unobserved'):'full',
   receivedAt:this.at,fullAt:this.fullAt,ageMs:age,fresh:age!=null&&age>=0&&age<=30000,
   state:this.state?structuredClone(this.state):null,lastEvent:this.lastEvent?structuredClone(this.lastEvent):null,actionEvents:structuredClone(this.events),rejection:this.rejection?{...this.rejection}:null};
  return withProgress?{...result,progress:this.progress.view(result)}:result;
 }
}
module.exports={AstralState,delta};
