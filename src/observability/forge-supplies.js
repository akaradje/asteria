'use strict';
// Observation only: no request, payment, retry or historical reconciliation.
const {delta}=require('./market-state');
// Native forge replies include an inert stage:{} even for Copper supplies.
// applyDelta iterates stage entries; only the observed EMPTY map is removable.
// Nonempty/malformed stage and every unknown paid delta remain fenced.
function supplyDelta(d){
 if(d&&typeof d==='object'&&!Array.isArray(d)&&Object.hasOwn(d,'stage')){
  const stage=d.stage;if(!stage||typeof stage!=='object'||Array.isArray(stage)||![Object.prototype,null].includes(Object.getPrototypeOf(stage))||Object.keys(stage).length)return {valid:false,value:null};
  const {stage:unused,...paid}=d;return delta(paid);
 }
 return delta(d);
}
const operations=['stup','fcraft','fdis','rfore','rfbuy','gsbuy','rfup','ench','xfer'];
const mismatchRejection=e=>!e.deltaAbsent&&!e.deltaValid;
const shape=d=>d&&typeof d==='object'&&!Array.isArray(d)?Object.entries(d).slice(0,64).map(([key,value])=>({key:/^[a-zA-Z0-9_]{1,40}$/.test(key)?key:'invalid_key',type:Array.isArray(value)?'array':value===null?'null':typeof value,...(value&&typeof value==='object'?{size:Object.keys(value).length}:{} )})):null;
const text=x=>typeof x==='string'&&x.length<=160?x:null;
class ForgeSupplies{
 constructor(){this.reset(0);}
 reset(generation){this.generation=generation;this.sequence=0;this.commandSequence=0;this.invalid=0;this.conflicts=0;this.inFlight=null;this.events=[];this.unknownFields=[];}
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
  const d=supplyDelta(m.d),c=this.inFlight;
  if(['gsbuy','rfbuy'].includes(m.op)){const unknown=Object.keys(m).filter(k=>!['t','op','ok','no','res','d','rev'].includes(k));if(unknown.length)this.invalid++;for(const k of unknown)if(this.unknownFields.length<32&&/^[a-zA-Z0-9_]{1,40}$/.test(k)&&!this.unknownFields.includes(k))this.unknownFields.push(k);}
  const event={sequence:++this.sequence,generation:this.generation,at,op:text(m.op),ok:m.ok===true||m.ok===1,no:text(m.no),rev:Number.isSafeInteger(m.rev)&&m.rev>=0?m.rev:null,name:text(m.res?.name),via:text(m.res?.via),delta:d.value,deltaValid:d.valid,deltaAbsent:m.d==null,deltaShape:shape(m.d),resultShape:shape(m.res),command:c&&c.op===m.op&&at>=c.at?{...c}:null};
  if(event.command)this.inFlight=null;
  this.events.push(event);if(this.events.length>32)this.events.shift();return true;
 }
 mark(){return {generation:this.generation,sequence:this.sequence,commandSequence:this.commandSequence,invalid:this.invalid,conflicts:this.conflicts,pending:!!this.inFlight};}
 outcome(mark,supply){
  const evidence={expected:mark,observed:this.mark(),unknownFields:this.unknownFields.slice(),events:this.events.filter(e=>e.sequence>(mark?.sequence??this.sequence)).slice(-2)};
  const deny=reason=>({state:'ambiguous',reason,evidence});
  if(!mark||mark.pending)return deny('baseline_missing_or_in_flight');
  if(mark.generation!==this.generation)return deny('connection_generation_changed');
  if(mark.invalid!==this.invalid)return deny('invalid_or_unknown_frame_shape');
  if(mark.conflicts!==this.conflicts||this.commandSequence>mark.commandSequence+1)return deny('competing_native_commands');
  if(this.sequence>mark.sequence+1)return deny('multiple_forge_replies');
  if(this.sequence===mark.sequence)return {state:'waiting'};
  const e=this.events.find(e=>e.sequence===mark.sequence+1),op=supply.kind==='guardian'?'gsbuy':'rfbuy';
  if(!e?.command||e.op!==op||e.command.sequence!==mark.commandSequence+1||(op==='rfbuy'&&e.command.via!=='coin'))return deny('unmatched_native_command');
  if(e.ok===!!e.no)return deny('contradictory_or_missing_outcome');
  if(e.no){if(e.delta&&Object.keys(e.delta).length||mismatchRejection(e))return deny('rejection_has_unverified_resource_delta');return {state:'rejected',event:e};}
  const expected={coins:-supply.price,[supply.group==='materials'?'mats':'cons']:{[supply.name]:1}};
  if(!e.deltaValid||e.name!==supply.name||(op==='rfbuy'&&e.via!=='c')||!require('../runtime/isolated-storage').equal(e.delta,expected))return deny('supply_delta_or_label_mismatch');
  return {state:'confirmed',event:e};
 }
}
async function waitOutcome(observer,mark,supply,{timeoutMs=8500,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const until=now()+timeoutMs;let result;
 do{result=observer.outcome(mark,supply);if(result.state!=='waiting')return result;if(now()>=until)break;await sleep(Math.min(100,until-now()));}while(now()<=until);
 return {state:'timeout'};
}
module.exports={ForgeSupplies,waitOutcome,supplyDelta};
