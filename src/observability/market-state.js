'use strict';
const text=x=>typeof x==='string'&&x.length<=160?x:null;
const integer=x=>Number.isSafeInteger(x)&&x>=0?x:null;
function delta(d){
 if(!d||typeof d!=='object'||Array.isArray(d))return {valid:false,value:null};
 const out={};let valid=true;
 for(const [k,v]of Object.entries(d)){
  if(['coins','tokens','dust','leaves','potions'].includes(k)){if(!Number.isSafeInteger(v))valid=false;else if(v!==0)out[k]=v;}
  else if(['mats','cons','keys','cards'].includes(k)){
   if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>256){valid=false;continue;}
   const map=Object.create(null);for(const [id,n]of Object.entries(v)){if(!text(id)||['__proto__','constructor','prototype'].includes(id)||!Number.isSafeInteger(n)){valid=false;continue;}if(n!==0)map[id]=n;}if(Object.keys(map).length)out[k]=map;
  }else if(['bag','add'].includes(k)){if(!Array.isArray(v)||v.length>256||v.some(id=>!text(id)))valid=false;else if(v.length)out[k]=v.slice();}
  else valid=false;
 }
 return {valid,value:out};
}
const listing=r=>{
 if(!r||!['string','number'].includes(typeof r.id)||String(r.id).length>160||!text(r.item)||!Number.isSafeInteger(r.n)||r.n<1||integer(r.price)===null||!Number.isFinite(r.expires))return null;
 return {id:String(r.id),item:r.item,kind:text(r.kind),n:r.n,price:r.price,unitPrice:r.price/r.n,expires:r.expires,status:text(r.status),claimed:r.claimed===true||r.claimed===1,mine:r.mine===true||r.mine===1?true:r.mine===false||r.mine===0?false:null};
};
// Observer only. Does not generate requests, pay, reconcile or release any hold.
class MarketState{
 constructor(){this.reset(0);}
 reset(generation){this.generation=generation;this.board=null;this.history=new Map();this.events=[];this.sequence=0;this.gap=false;this.invalid=0;this.unknownFields=[];this.commandSequence=0;this.inFlight=null;this.commandConflict=false;}
 sent(m,at=Date.now()){
  if(!['mbuy','mlist','mcancel','mclaim'].includes(m?.t))return false;
  if(!Number.isFinite(at)||at<0)return false;
  if(this.inFlight)this.commandConflict=true;
  // Retain neither arbitrary outbound fields nor account data.
  this.inFlight={sequence:++this.commandSequence,at,op:m.t,lid:integer(m.lid),...(m.t==='mlist'?{kind:text(m.kind),item:text(m.name)||text(m.id),n:integer(m.n),price:integer(m.price),each:integer(m.each)}:{})};return true;
 }
 receive(m,at=Date.now()){
  if(!['mk','mh','mkr','mksold'].includes(m?.t))return false;
  if(!Number.isFinite(at)||at<0){this.invalid++;return false;}
  const fields={mk:['t','now','mine','list','tax','fee','max','counts','total'],mh:['t','key','list'],mkr:['t','ok','no','op','res','d','rev'],mksold:['t','item','n','buyer','net']};
  for(const k of Object.keys(m))if(!fields[m.t].includes(k)&&this.unknownFields.length<32&&!this.unknownFields.includes(m.t+':'+k))this.unknownFields.push(m.t+':'+k);
  if(m.t==='mk'){
   if(!Number.isFinite(m.now)||!Array.isArray(m.list)||!Array.isArray(m.mine)||m.list.length>500||m.mine.length>500){this.invalid++;this.gap=true;return false;}
   if(this.board&&(at<this.board.at||m.now<this.board.serverNow)){this.invalid++;return false;}
   const list=m.list.map(listing).filter(Boolean),mine=m.mine.map(listing).filter(Boolean),valid=list.length===m.list.length&&mine.length===m.mine.length;
   this.board={at,generation:this.generation,serverNow:m.now,tax:Number.isFinite(m.tax)&&m.tax>=0&&m.tax<=1?m.tax:null,fee:integer(m.fee),max:integer(m.max),total:integer(m.total),list,mine,rowsValid:valid,queryComplete:valid&&integer(m.total)!==null&&m.total===list.length,queryScope:'native_response_query_not_whole_market'};if(!valid)this.gap=true;
  }else if(m.t==='mh'){
   if(!text(m.key)||!Array.isArray(m.list)||m.list.length>500){this.invalid++;return false;}
   const rows=m.list.filter(r=>integer(r.price)!==null&&Number.isSafeInteger(r.n)&&r.n>0).map(r=>({price:r.price,n:r.n,unitPrice:r.price/r.n}));this.history.set(m.key,{at,rows,complete:false,rowsValid:rows.length===m.list.length});while(this.history.size>32)this.history.delete(this.history.keys().next().value);
  }else{
   const r=m.res||{},event={sequence:++this.sequence,at,generation:this.generation,type:m.t,op:text(m.op),ok:m.ok===true||m.ok===1,no:text(m.no),rev:integer(m.rev),item:text(m.item)||text(r.item),n:integer(m.n)??integer(r.n),price:integer(r.price),coins:integer(r.coins),left:integer(r.left),net:integer(m.net),confirmation:'observation_only_unmatched_to_intent'};
   if(m.t==='mkr'){
    const d=delta(m.d);event.delta=d.value;event.deltaValid=d.valid;
    if(!this.commandConflict&&this.inFlight?.op===m.op&&this.inFlight.at<=at){event.command={...this.inFlight};this.inFlight=null;}
   }
   this.events.push(event);if(this.events.length>128){this.events.shift();this.gap=true;}
  }
  return true;
 }
 view(now=Date.now()){
  const b=this.board;return {generation:this.generation,at:b?.at??null,fresh:!!b&&now>=b.at&&now-b.at<=30000,serverNow:b?.serverNow??null,tax:b?.tax??null,fee:b?.fee??null,max:b?.max??null,visibleListings:b?.list.length??null,total:b?.total??null,queryComplete:b?.queryComplete??false,queryScope:b?.queryScope??null,mine:b?.mine||[],historyKeys:[...this.history.keys()],recentEvents:this.events.slice(-8),sequence:this.sequence,gap:this.gap,invalid:this.invalid,unknownFields:this.unknownFields,mode:'observe_only',claimedIncomeVerified:false};
 }
}
module.exports={MarketState,listing,delta};
