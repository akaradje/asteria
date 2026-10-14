'use strict';
const crypto=require('node:crypto');
// One coordinator owns this document. Host claims are authenticated by the
// transport; expiry never authorizes stealing an account from a running host.
class Authority{
 constructor(store,{now=Date.now}={}){this.store=store;this.now=now;this.capacity=new(require('./admission').Admission)({now,store});this.id='global-assignment-v1';this.data=store.document(this.id)||{version:1,revision:0,assignments:{},operations:{}};this.revision=store.documentRevision(this.id);if(this.revision===null){this.revision=store.putDocument(this.id,this.data);}}
 admit(args){return this.capacity.reserve(args);}
 capacityLookup(args){return this.capacity.lookup(args);}
 capacityCancel(args){return this.capacity.cancel(args);}
 enrollment(){return new(require('./enrollment').Enrollment)(this.store);}
 enrollBegin(args){return this.enrollment().begin(args);}
 enrollVerified({id,proof}){return this.enrollment().verified(id,proof);}
 enrollAssigned({id,grant}){return this.enrollment().assigned(id,grant);}
 enrollLoaded({id,proof}){return this.enrollment().loaded(id,proof);}
 enrollCancel({id}){return this.enrollment().cancel(id);}
 enrollStatus({id}){return this.enrollment().status(id);}
 enrollResume({id}){return this.enrollment().resume(id);}
 capacitySettled(args){return {released:this.capacity.release(args.id,{settled:args.proof?.contextClosed===true||args.proof?.nativeLoaded===true&&args.proof?.freshCapacity===true,host:args.host,session:args.session})};}
 persist(){this.data.revision++;this.revision=this.store.putDocument(this.id,this.data,this.revision);}
 claim({accountId,actorId,host,session,pid,policyRevision}){
  if(!/^account-[a-f0-9]{32}$/.test(accountId)||!/^actor-[a-f0-9]{32}$/.test(actorId)||typeof host!=='string'||!host||typeof session!=='string'||!session||!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(policyRevision))throw Error('Invalid assignment identity');
  const old=this.data.assignments[accountId];if(old&&old.state!=='STOPPED'){
   if(old.actorId===actorId&&old.host===host&&old.session===session&&old.pid===pid&&old.state==='ACTIVE')return {...old};
   throw Error('Existing assignment has not positively drained');
  }
  if(Object.values(this.data.operations).some(o=>o.accountId===accountId&&!['COMPLETE','CANCELLED'].includes(o.state)))throw Error('Migration requires explicit matching activation');
  const row={accountId,actorId,host,session,pid,policyRevision,generation:(old?.generation||0)+1,state:'ACTIVE',at:this.now()};this.data.assignments[accountId]=row;this.persist();return {...row};
 }
 prepare({accountId,targetHost,targetActorId,operationId=crypto.randomUUID()}){const prior=this.data.operations[operationId];if(prior){if(prior.accountId!==accountId||prior.targetHost!==targetHost||prior.targetActorId!==targetActorId)throw Error('Migration id reused with different target');return {...prior};}const row=this.data.assignments[accountId];if(!row||row.state!=='ACTIVE')throw Error('Active source required');if(Object.values(this.data.operations).some(o=>o.accountId===accountId&&!['COMPLETE','CANCELLED'].includes(o.state)))throw Error('Migration already pending');if(typeof targetHost!=='string'||!targetHost||!/^actor-[a-f0-9]{32}$/.test(targetActorId))throw Error('Invalid target');const op={id:operationId,accountId,source:{...row},targetHost,targetActorId,state:'PREPARED',at:this.now()};this.data.operations[op.id]=op;this.persist();return {...op};}
 drain(id){const op=this.data.operations[id];if(['DRAINING','FENCED','ACTIVE_TARGET','COMPLETE'].includes(op?.state))return {...op};if(op?.state!=='PREPARED')throw Error('Prepared operation required');op.state='DRAINING';this.data.assignments[op.accountId].state='DRAINING';this.persist();return {...op};}
 closed({accountId,host,session,generation,proof}){const row=this.data.assignments[accountId];if(!row||row.host!==host||row.session!==session||row.generation!==generation||!['ACTIVE','DRAINING','STOPPED'].includes(row.state)||proof?.socketClosed!==true||proof?.contextClosed!==true||proof?.queueDrained!==true)throw Error('Positive exact source close proof required');if(row.state==='STOPPED')return {...row};row.state='STOPPED';row.closedAt=this.now();row.closeProof={socketClosed:true,contextClosed:true,queueDrained:true};for(const op of Object.values(this.data.operations))if(op.accountId===accountId&&op.state==='DRAINING')op.state='FENCED';this.persist();return {...row};}
 activate(id,claim){
  const op=this.data.operations[id],old=op&&this.data.assignments[op.accountId];
  if(!op||claim.host!==op.targetHost||claim.actorId!==op.targetActorId||claim.accountId!==op.accountId||typeof claim.session!=='string'||!claim.session||!Number.isSafeInteger(claim.pid)||claim.pid<1||!Number.isSafeInteger(claim.policyRevision))throw Error('Fenced matching target required');
  if(['ACTIVE_TARGET','COMPLETE'].includes(op.state)){if(old?.host===claim.host&&old.actorId===claim.actorId&&old.session===claim.session&&old.pid===claim.pid&&old.policyRevision===claim.policyRevision&&old.generation===op.targetGeneration&&old.state==='ACTIVE')return {...old};throw Error('Target activation conflicts with existing generation');}
  if(op.state!=='FENCED'||old?.state!=='STOPPED')throw Error('Fenced matching target required');
  const grant={accountId:claim.accountId,actorId:claim.actorId,host:claim.host,session:claim.session,pid:claim.pid,policyRevision:claim.policyRevision,generation:old.generation+1,state:'ACTIVE',at:this.now()};
  this.data.assignments[op.accountId]=grant;op.state='ACTIVE_TARGET';op.targetGeneration=grant.generation;this.persist();return {...grant};
 }
 complete(id,{nativeActorId,build,revision}={}){const op=this.data.operations[id];if(!op||!['ACTIVE_TARGET','COMPLETE'].includes(op.state)||nativeActorId!==op.targetActorId||typeof build!=='string'||!build||typeof revision!=='string'||!revision)throw Error('Target identity/revision acknowledgement required');if(op.state==='COMPLETE'){if(op.nativeProof.build!==build||op.nativeProof.revision!==revision)throw Error('Conflicting completed acknowledgement');return {...op};}op.state='COMPLETE';op.nativeProof={nativeActorId,build,revision,at:this.now()};this.persist();return {...op};}
 rollback(id){const op=this.data.operations[id];if(op?.state==='CANCELLED')return {...op};if(!op||!['PREPARED','FENCED'].includes(op.state))throw Error('Source/target must positively drain before rollback');op.state='CANCELLED';this.persist();return {...op};}
 status({accountId,host,session,generation}){const row=this.data.assignments[accountId];return row&&row.host===host&&row.session===session&&row.generation===generation?{...row}:null;}
 owned({accountId,host}){const row=this.data.assignments[accountId];return row?.host===host?{...row}:null;}
 public(){return {version:1,serverAt:this.now(),revision:this.data.revision,assignments:Object.values(this.data.assignments).map(({actorId,host,state,generation,at})=>({actorId,host,state,generation,at})),operations:Object.values(this.data.operations).map(({id,targetHost,targetActorId,state,at})=>({id,targetHost,targetActorId,state,at}))};}
}
module.exports={Authority};
