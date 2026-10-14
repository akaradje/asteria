'use strict';
const integer=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const text=x=>typeof x==='string'&&x.length<=120?x:null;
class BuildLabState{
 constructor(){this.reset(0);}
 reset(generation){this.generation=generation;this.status=null;this.session=null;this.events=[];this.invalid=0;}
 receive(m,at=Date.now()){
  if(!['bt','btenter','btset','btko','btend','btleave'].includes(m?.t)||!Number.isFinite(at)||at<0)return false;
  if(m.t==='bt'){
   if(this.status&&at<this.status.at)return false;
   this.status={at,generation:this.generation,fee:integer(m.fee),copper:integer(m.copper),minutes:integer(m.min),vip:typeof m.vip==='boolean'?m.vip:null,vipLeft:integer(m.vipLeft),vipFree:integer(m.vipFree),session:m.sess&&Number.isFinite(m.sess.until)&&Number.isFinite(m.sess.now)?{until:m.sess.until,now:m.sess.now}:null};
  }else if(m.t==='btenter'){
   if(m.ok===true||m.ok===1){if(!/^bt#[0-9]+$/.test(m.room||'')||!Number.isFinite(m.until)||!Number.isFinite(m.now)||m.until<m.now){this.invalid++;return false;}this.session={room:m.room,at,until:m.until,serverNow:m.now,generation:this.generation,active:true,paid:integer(m.paid),copper:integer(m.copper),free:m.free===true||m.free===1};}
  }else if(m.t==='btend'||m.t==='btleave'){if(this.session)this.session={...this.session,active:false,endedAt:at};}
  this.events.push({type:m.t,at,generation:this.generation,ok:m.ok===true||m.ok===1,why:text(m.why),knockouts:integer(m.n),warnings:Array.isArray(m.warn)?m.warn.map(text).filter(Boolean).slice(0,16):[],scope:'native_lab_not_field_result'});this.events=this.events.slice(-32);return true;
 }
 view(now=Date.now()){return {status:this.status,session:this.session,fresh:!!this.status&&now>=this.status.at&&now-this.status.at<=30000,events:this.events.slice(-8),invalid:this.invalid,generation:this.generation,fieldBenefitVerified:false};}
}
function entryPlan({status,now=Date.now(),wallet,reserve,held,ownerFree,saveClean,sourceAligned,maxCopper=0}={}){
 if(!status||now<status.at||now-status.at>30000||!ownerFree||!saveClean||!sourceAligned||[wallet,reserve,held,maxCopper].some(n=>integer(n)===null))return {action:'observe',reason:'fresh_native_eligibility_and_budget_required'};
 if(status.session)return {action:'observe',reason:'existing_lab_session_requires_reconciliation'};
 if(status.vip===true&&status.vipLeft>0)return {action:'candidate',pay:'vip',cost:0,requires:'entry_receipt_and_restored_real_save',executable:false};
 if(status.copper!==null&&status.copper>0&&status.copper<=maxCopper&&status.copper<=wallet-reserve-held)return {action:'candidate',pay:'copper',cost:status.copper,requires:'entry_receipt_and_restored_real_save',executable:false};
 return {action:'defer',reason:'no_verified_free_entry_or_research_budget',premiumSpend:false};
}
module.exports={BuildLabState,entryPlan};
