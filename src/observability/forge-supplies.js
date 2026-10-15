'use strict';
// Observation only: no request, payment, retry or historical reconciliation.
const {delta}=require('./market-state');
const operations=['stup','fcraft','fdis','rfore','rfbuy','gsbuy','rfup','ench','xfer'];
const mismatchRejection=e=>!e.deltaAbsent&&!e.deltaValid;
const text=x=>typeof x==='string'&&x.length<=160?x:null;
class ForgeSupplies{
 constructor(){this.reset(0);}
 reset(generation){this.generation=generation;this.sequence=0;this.commandSequence=0;this.invalid=0;this.conflicts=0;this.inFlight=null;this.events=[];}
 sent(m,at=Date.now()){
  if(!operations.includes(m?.t))return false;
  if(this.inFlight)this.conflicts++;
  this.commandSequence++;
  if(!Number.isFinite(at)||at<0||(['gsbuy','rfbuy'].includes(m.t)&&Object.keys(m).some(k=>!(m.t==='gsbuy'?['t']:['t','via']).includes(k)))||(m.t==='rfbuy'&&!['coin','tok'].includes(m.via))){this.invalid++;return true;}
  this.inFlight={sequence:this.commandSequence,op:m.t,via:m.t==='rfbuy'?m.via:null,at};return true;
 }
 receive(m,at=Date.now()){
  if(m?.t!=='forge'||m.op==='rfq')return false;
  if(!Number.isFinite(at)||at<0){this.invalid++;return false;}
  const d=delta(m.d),c=this.inFlight;
  if(['gsbuy','rfbuy'].includes(m.op)&&Object.keys(m).some(k=>!['t','op','ok','no','res','d','rev'].includes(k)))this.invalid++;
  const event={sequence:++this.sequence,generation:this.generation,at,op:text(m.op),ok:m.ok===true||m.ok===1,no:text(m.no),rev:Number.isSafeInteger(m.rev)&&m.rev>=0?m.rev:null,name:text(m.res?.name),via:text(m.res?.via),delta:d.value,deltaValid:d.valid,deltaAbsent:m.d==null,command:c&&c.op===m.op&&at>=c.at?{...c}:null};
  if(event.command)this.inFlight=null;
  this.events.push(event);if(this.events.length>32)this.events.shift();return true;
 }
 mark(){return {generation:this.generation,sequence:this.sequence,commandSequence:this.commandSequence,invalid:this.invalid,conflicts:this.conflicts,pending:!!this.inFlight};}
 outcome(mark,supply){
  if(!mark||mark.pending||mark.generation!==this.generation||mark.invalid!==this.invalid||mark.conflicts!==this.conflicts||this.commandSequence>mark.commandSequence+1||this.sequence>mark.sequence+1)return {state:'ambiguous'};
  if(this.sequence===mark.sequence)return {state:'waiting'};
  const e=this.events.find(e=>e.sequence===mark.sequence+1),op=supply.kind==='guardian'?'gsbuy':'rfbuy';
  if(!e?.command||e.op!==op||e.command.sequence!==mark.commandSequence+1||(op==='rfbuy'&&e.command.via!=='coin')||e.ok===!!e.no)return {state:'ambiguous'};
  if(e.no){if(e.delta&&Object.keys(e.delta).length||mismatchRejection(e))return {state:'ambiguous'};return {state:'rejected',event:e};}
  const expected={coins:-supply.price,[supply.group==='materials'?'mats':'cons']:{[supply.name]:1}};
  if(!e.deltaValid||e.name!==supply.name||(op==='rfbuy'&&e.via!=='c')||!require('../runtime/isolated-storage').equal(e.delta,expected))return {state:'ambiguous'};
  return {state:'confirmed',event:e};
 }
}
async function waitOutcome(observer,mark,supply,{timeoutMs=8500,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const until=now()+timeoutMs;let result;
 do{result=observer.outcome(mark,supply);if(result.state!=='waiting')return result;if(now()>=until)break;await sleep(Math.min(100,until-now()));}while(now()<=until);
 return {state:'timeout'};
}
module.exports={ForgeSupplies,waitOutcome};
