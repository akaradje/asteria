'use strict';
function nativeBill(delta,bill,rules){
 if(!delta||delta.coins!==-bill.copper)return false;
 let reward=0;const spent={};for(const group of ['mats','keys'])for(const [id,n]of Object.entries(delta[group]||{})){if(n>0){if(id==='Guardian Stone'&&n===1&&++reward===1)continue;return false;}spent[id]=(spent[id]||0)-n;}
 const allowed=new Set([...rules.bossCores,...rules.miniCores,'Starforged Ore']);
 if(Object.entries(spent).some(([id,n])=>n&&!allowed.has(id)))return false;
 const count=ids=>ids.reduce((n,id)=>n+(spent[id]||0),0);
 return count(rules.bossCores)===bill.boss&&count(rules.miniCores)===bill.mini&&(spent['Starforged Ore']||0)===bill.ore;
}
function applied(row,view,rules){
 const event=view?.lastEvent;if(!event||event.at<row.sentAt)return null;
 if(row.kind==='astral:aspt'&&event.points&&Object.entries(row.target.points).every(([k,n])=>event.points[k]===n)&&Object.entries(event.points).every(([k,n])=>(row.target.points[k]||0)===n))return {points:event.points,star:view.state.s};
 if(row.kind==='astral:asbt'&&event.did==='bt'&&event.bt===row.target.beforeBt+1&&nativeBill(event.delta,row.target.gateBill,rules))return {bt:event.bt,delta:event.delta,star:view.state.s};
 if(row.kind==='astral:asrst'&&event.did==='reset'&&event.points&&Object.values(event.points).every(n=>n===0)&&event.delta?.coins===-row.bill.Copper&&Object.values(event.delta.mats||{}).every(n=>n===0)&&Object.values(event.delta.keys||{}).every(n=>n===0))return {points:event.points,delta:event.delta,star:view.state.s};
 return null;
}
function resources(save){return {...save.materials,...save.keyItems,Copper:save.coins};}
function reserveBill(action,goal,save,rules){
 if(action==='aspt')return {};
 if(action==='asrst')return {Copper:rules.resetCopper};
 // Native UI sends asbt without choosing cores; reserve the entire eligible
 // stacks until the server identifies the consumed alternatives in its delta.
 const have=resources(save),out={Copper:goal.bill.copper,'Starforged Ore':goal.bill.ore};
 for(const id of [...rules.bossCores,...rules.miniCores])if(have[id]>0)out[id]=have[id];return out;
}
function confirmedEvent(row,view,rules){for(const event of [...(view?.actionEvents||[]),view?.lastEvent].filter(Boolean)){const proof=applied(row,{...view,lastEvent:event},rules);if(proof)return {...proof,eventAt:event.at};}return null;}
function closedPointOwner(row,i){
 if(i.previousOwnerProof?.closed===true&&i.previousOwnerProof.session===row.session)return true;
 if(!i.root||!/^[a-zA-Z0-9_-]{10,100}$/.test(row.session||''))return false;
 try{
  const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto'),old=JSON.parse(fs.readFileSync(path.join(i.root,'logs/browser-owners',row.session+'.json')));
  const prefix='v32:'+crypto.createHash('sha256').update(path.resolve(i.root)).digest('hex').slice(0,16)+':';
  // Shared browser contexts retain the browser's first owner marker. The
  // per-context record still binds this exact actor session and positive close.
  return old.version===1&&old.session===row.session&&typeof old.marker==='string'&&old.marker.startsWith(prefix)&&/^[a-zA-Z0-9_-]{10,100}$/.test(old.marker.slice(prefix.length))&&old.closed===true&&Number.isFinite(old.closedAt)&&old.closedAt>=row.sentAt&&old.closedAt<=i.bagSessionStartedAt;
 }catch{return false;}
}
function closedPointState(row,i,view,now=Date.now()){
 if(row.kind!=='astral:aspt'||Object.keys(row.bill||{}).length||!['SENT','UNCERTAIN','OBSERVED'].includes(row.status)||row.session===i.actorOwner?.session||!closedPointOwner(row,i)||!Number.isFinite(i.bagSessionStartedAt)||row.at>=i.bagSessionStartedAt||view?.authority!=='server_socket'||view.completeness!=='full'||!view.fresh||view.generation!==i.socialInbox?.generation||!Number.isFinite(view.fullAt)||view.fullAt<i.bagSessionStartedAt||view.fullAt<row.sentAt||view.fullAt>now||!Number.isInteger(view.state?.s)||!view.state.p)return null;
 const rules=i.catalog().world,clean=rules.astralPts(view.state);
 if(JSON.stringify(Object.entries(clean).sort())!==JSON.stringify(Object.entries(view.state.p).filter(([,n])=>n!==0).sort()))return null;
 return {authority:'server_socket',at:view.fullAt,session:i.actorOwner.session,generation:view.generation,star:view.state.s,points:clean,historicalApplied:null,scope:'closed-session zero-cost allocation state only; not original success; never applies to paid breakthrough/reset'};
}
module.exports={applied,confirmedEvent,closedPointState,nativeBill,resources,reserveBill};
