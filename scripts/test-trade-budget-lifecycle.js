'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const budget=require('../src/runtime/trade-material-budget'),legacy=require('../src/runtime/legacy-material-reserve'),recovery=require('../src/runtime/material-budget-recovery'),runtime=require('../src/runtime/team-trade'),outcome=require('../src/runtime/trade-outcome-recovery'),work=require('../src/planning/team-workboard'),paid=require('../src/runtime/paid-actions');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-trade-budget-')),now=Date.now(),id=()=>crypto.randomUUID(),actor='actor-'+'a'.repeat(32),oldProject=work.project,oldHeld=paid.heldResources;
const state={coins:900000,materials:{Ore:13},equip:{weapon:'sword'},refine:{sword:8}},context={actorId:actor,sessionStartedAt:now-120000,generation:2,build:'fixture'},offer={kind:'material',name:'Ore',quantity:1,donor:'B',receiver:'A',goalKind:'refine',goalId:'sword'};
const intent={id:id(),offer,build:'fixture',phase:'GATHERING',at:now,startedAt:now-10000,deadline:now+120000};
const i={root,character:{name:'A'},machine:'vps',credentials:{username:'fixture-a'},status:'playing',autoChores:true,actorIdentity:{actorId:actor},actorOwner:{},registryV32:{store:{validateOwner:()=>true,pending:()=>[],held:()=>({})}},catalog:()=>({build:'fixture',items:{sword:{}},world:{REFINE:{ORES:['Ore']}}}),lastSave:state,lastSaveAt:now,bagSessionStartedAt:context.sessionStartedAt,socialInbox:{generation:2,streamAt:now},livePos:{at:now,room:'town'},v2:{sourceCoherence:{matches:true},scheduler:{active:null,queue:[],closed:false},journal:{rows:[]},observations:{sessionId:'runtime-a'}},tradeAvailability:{at:now,clear:true},developmentLedger:{rows:[]},serverSaveReceipt:{state,proof:{...context,authority:'server_readback',rev:7,at:now,requestAt:now-100}},tradeJournal:{id:intent.id,context,offer,at:now-5000,phase:'READY',sent:{}},teamTradeIntent:intent};
(async()=>{try{
 work.project=()=>({needs:[{kind:'refine',name:'Ore',want:3,goalId:'sword'}],reserved:{Ore:11},phase:'complete'});paid.heldResources=()=>({Ore:11});
 assert(budget.capture(i,intent,now));const baseline=structuredClone(i.tradeJournal.materialBaseline);
 const later=now+45000;i.tradeJournal.sessionId=5;i.teamTradeIntent={...intent,phase:'SESSION',at:later};i.livePos.at=later;i.socialInbox.streamAt=later;
 const me={stacks:[],gear:[],coins:0,locked:true},them={stacks:[['Ore',1]],gear:[],coins:0,locked:true};
 i.activityEvidence={latest:{tropen:{at:now+1000,build:'fixture',state:{id:5,with:{name:'B'}}},trstate:{at:later,build:'fixture',state:{id:5,me,them}}}};
 assert(budget.frozen(i,i.teamTradeIntent,later),'Paused save beyond30s accepts exact bounded native state');
 for(const mutate of [()=>{i.socialInbox.generation=3},()=>{i.actorIdentity.actorId='actor-'+'b'.repeat(32)},()=>{i.activityEvidence.latest.trstate.at=later-16000},()=>{i.teamTradeIntent.deadline=later},()=>{i.activityEvidence.latest.trstate.state.them.stacks=[['Ore',2]]},()=>{i.stopRequested=true},()=>{i.activityEvidence.latest.tropen.state.with.name='C'},()=>{i.activityEvidence.latest.trclosed={at:later,state:{id:5}}}]){
  const before={generation:i.socialInbox.generation,actor:i.actorIdentity.actorId,frames:structuredClone(i.activityEvidence),intent:structuredClone(i.teamTradeIntent)};mutate();assert.equal(budget.frozen(i,i.teamTradeIntent,later),null);i.socialInbox.generation=before.generation;i.actorIdentity.actorId=before.actor;i.activityEvidence=before.frames;i.teamTradeIntent=before.intent;delete i.stopRequested;
 }
 paid.heldResources=()=>({Ore:12});assert.equal(budget.frozen(i,i.teamTradeIntent,later),null);paid.heldResources=()=>({Ore:11});
 assert.deepEqual(i.tradeJournal.materialBaseline,baseline,'Frozen proof is never rewritten during session');
 // Mixed close after confirm is preserved, not recategorized as a success or sent again.
 const dir=path.join(root,'logs/trades/a');fs.mkdirSync(dir,{recursive:true});i.tradeJournalFile=path.join(dir,'original.json');
 i.tradeJournal={id:intent.id,offer,context,build:'fixture',at:now-5000,deadline:now-1,sessionId:5,phase:'CONFIRM_SENT',sent:{confirm:true},confirmAt:now-2000,before:13};fs.writeFileSync(i.tradeJournalFile,JSON.stringify(i.tradeJournal));const original=fs.readFileSync(i.tradeJournalFile);
 let receipt=null;i.socialLast=async t=>t==='trclosed'?{id:5,_receivedAt:now-500,reason:'cancel'}:t==='trdone'?receipt:null;
 const persist=a=>fs.writeFileSync(a.tradeJournalFile,JSON.stringify(a.tradeJournal));
 assert(await runtime.observeNativeOutcome(i,persist));assert.equal(i.tradeJournal.phase,'UNCERTAIN');assert.equal(i.tradeJournal.sent.confirm,true);
 assert(fs.readFileSync(path.join(root,'logs/migration-originals/trades',i.tradeJournal.readbackRecovery.originalHash+'.json')).equals(original));
 // A delayed exact receipt wins over a close but requires native inventory proof.
 receipt={id:87,rev:8,_receivedAt:now-1000,with:'B',gave:me,got:them};assert(await runtime.observeNativeOutcome(i,persist));assert.equal(i.tradeJournal.phase,'VERIFYING');assert.equal(i.tradeJournal.receipt.id,87);
 // No socialSend/eval API is supplied: outcome processing cannot dispatch.
 const {ResourceReservations}=require('../src/planning/resource-reservations');i.v2.reservations=new ResourceReservations(root,i.credentials.username);delete i.tradeJournal;delete i.teamTradeIntent;delete i.activityEvidence;i.livePos.at=now;i.socialInbox.streamAt=now;
 const orphan={id:id(),at:now-900000,deadline:now-700000,status:'UNCERTAIN',cost:{Ore:20,Copper:4900},build:'old'};
 const transaction=id(),linked={...orphan,id:id(),transactionId:transaction,cost:{Ore:4,Copper:2135}};
 const sha=crypto.createHash('sha256').update(i.credentials.username).digest('hex');i.v2.journal.file=path.join(root,'logs/actions',sha.slice(0,16)+'.json');i.v2.journal.rows=[{id:'development:'+transaction,kind:'refine',externalOwner:'development-ledger',legacyIdentityUnknown:false,status:'OBSERVED',at:now-899999,target:{id:'sword'}}];
 const journalBefore=JSON.stringify(i.v2.journal.rows);i.v2.reservations.data.claims=[structuredClone(orphan),structuredClone(linked)];i.v2.reservations.save();
 i.v2.scheduler.active={kind:'paid'};assert.equal(legacy.recover(i,now),0);i.v2.scheduler.active=null;
 assert.equal(legacy.recover(i,now),2,'Missing linked ledger accepted only through owned original journal');assert(legacy.blocked(i,transaction));assert(legacy.blocked(i,orphan.id));assert(legacy.verified(i));assert.equal(JSON.stringify(i.v2.journal.rows),journalBefore);
 for(const r of i.v2.reservations.data.claims){assert.equal(r.status,'RECONCILED');assert.equal(r.reconciliation.historicalSuccessKnown,false);assert.equal(r.reconciliation.historicalCostKnown,false);assert.equal(r.replayBlocked,true);}
 assert.equal(i.v2.reservations.reserve(orphan.id,orphan.cost,{Ore:100,Copper:1000000}).ok,false);
 assert.equal(require('../src/runtime/fresh-refine-attempt').dispatch(i,{id:transaction},{id:'sword'}),false,'Original linked transaction cannot dispatch even without freshNativeIntent');
 const archive=path.join(root,'logs/material-budget-originals',i.v2.reservations.data.claims[0].reconciliation.originalSha256+'.json');fs.writeFileSync(archive,'corrupt');assert(!legacy.verified(i));assert(legacy.blocked(i,orphan.id));assert.equal(paid.preflight(i,'refineEquipped',[]).allowed,false);
 fs.mkdirSync(path.join(root,'machines'),{recursive:true});fs.writeFileSync(path.join(root,'machines/host-teams.json'),JSON.stringify({version:1,teams:{vps:{leader:'A',members:['A','B','C']}}}));
 const members=['A','B','C'].map((charName,n)=>({charName,machine:'vps',slot:n,enabled:true,identity:{actorId:'actor-'+String.fromCharCode(97+n).repeat(32)}}));
 fs.writeFileSync(path.join(root,'machines/topology-v32.json'),JSON.stringify({version:1,revision:1,coordinatorHost:'vps',leader:'A',hosts:{vps:{id:'vps',enabled:true,adapter:'legacy_verified_controller'}},members:members.map(({identity,...m})=>m)}));
 const historical=id();for(const m of members.slice(0,2)){
  const dir=path.join(root,'logs/trades',crypto.createHash('sha256').update(m.charName).digest('hex').slice(0,24));fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,historical+'.json'),JSON.stringify({id:historical,offer,context:{actorId:m.identity.actorId},build:'fixture',at:now-900000,deadline:now-700000,phase:m.charName==='A'?'CANCELLED':'CONFIRM_SENT',sent:{confirm:m.charName==='B'}}));
 }
 const cases=outcome.discoverMixed(root,'vps',members,new Set(),now);assert.equal(cases.length,1);assert.equal(cases[0].id,historical);assert.equal(cases[0].resolution,'unresolved_no_replay');assert.equal(outcome.discoverMixed(root,'vps',members,new Set([historical]),now).length,0);
 const coordinator=new runtime.TeamTrade(root,{coordinatorHost:'vps'},'vps');coordinator.state={id:id(),offer,phase:'SESSION',build:'fixture',at:now,startedAt:now-10000,deadline:now+60000};
 const live=members.slice(0,2).map((m,n)=>({...m,lastSaveAt:now,tradeAvailability:{at:now,clear:true},teamTradeStatus:{id:coordinator.state.id,at:now,phase:n?'CONFIRM_SENT':'CANCELLED',confirmationSent:!!n}}));
 coordinator.reconcile([{machine:'vps',at:now,build:'fixture',members:live}],i.catalog(),now);assert.equal(coordinator.state.phase,'UNCERTAIN');assert(coordinator.quarantined.some(q=>q.id===coordinator.state.id));
 console.log('PASS paused trade lease, identity/offer/holds/stop guards, mixed close and late receipt without dispatch, missing ledger, immutable original UUID fences and corrupt archive fail-closed');
}finally{work.project=oldProject;paid.heldResources=oldHeld;fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
