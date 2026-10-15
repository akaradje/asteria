'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const fresh=require('../src/runtime/fresh-refine-attempt'),scope=require('../src/runtime/refine-scope'),{ResultLedger}=require('../src/result-ledger'),{ResourceReservations}=require('../src/planning/resource-reservations'),{ActionScheduler}=require('../src/runtime/action-scheduler');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-new-refine-')),now=Date.now(),actor='actor-'+'a'.repeat(32);
(async()=>{try{
 const cat={build:'current',world:{MAX_LV:120,REFINE:{max:10,chance:[100,100,100,70,60,50,40,30,20,10],cost:()=>175,ore:()=>'Ore',need:()=>1}},items:{w:{id:'w',name:'Weapon',slot:'weapon',rarity:'legendary',tier:6,stats:{atk:100}},wing:{id:'wing',slot:'wing',stats:{}}},equipmentGoal:{enabled:true,rarity:'legendary',refine:10,freshRefineAfterClosedOutcome:true}};
 const state={lv:120,job:'asura',coins:100000,materials:{Ore:20},bag:[],pets:{pet:0},petActive:'pet',equip:{weapon:'w',wing:'wing'},refine:{w:0}},proof={authority:'server_readback',actorId:actor,build:'current',sessionStartedAt:now-100000,generation:2,rev:12,requestAt:now-500,at:now-100};
 const ledger=new ResultLedger(root,'fresh'),original={id:'archived-roll',kind:'refine',target:{id:'w'},at:now-300000,status:'reconciled_refine_state',evidence:'native_current_refine_after_closed_session',context:{actorId:actor,build:'current',sessionStartedAt:now-500000,baselineRev:10},before:structuredClone(state),reconciliation:{...proof,targetId:'w',beforeRefine:0,currentRefine:0,replayBlocked:true,budgetRebased:true,historicalSuccessKnown:false,costKnown:false}};ledger.rows=[original];ledger.save();
 const i={root,slot:0,catalog:()=>cat,lastSave:structuredClone(state),lastSaveAt:now,livePos:{room:'town',at:now},vitals:{hp:1,at:now},status:'playing',autoChores:true,actorIdentity:{actorId:actor},actorOwner:{session:'current-owner'},bagSessionStartedAt:proof.sessionStartedAt,socialInbox:{generation:2},registryV32:{store:{validateOwner:()=>true,pending:()=>[],held:()=>({})}},serverSaveReceipt:{state:structuredClone(state),proof},developmentLedger:ledger,endgameCampaign:{phase:'complete'},v2:{sourceCoherence:{matches:true},journal:{rows:[]},scheduler:new ActionScheduler(),reservations:new ResourceReservations(root,'fresh')},canDo:()=>true};
 const orphan={id:'development:12345678-1234-1234-1234-123456789abc',kind:'refine',target:{id:'w'},at:now-400000,status:'OBSERVED',externalOwner:'development-ledger'};
 const before=JSON.stringify(original);assert(fresh.allowed(i,'w',now));assert(!scope.blocks(i,'w',now));const intent=fresh.evidence(i,'w',now);assert.deepEqual(intent.originalTransactionIds,['archived-roll']);assert.equal(intent.historicalSuccessKnown,false);assert.equal(JSON.stringify(original),before);
 for(const patch of [{status:'stopping'},{autoChores:false},{teamControl:true},{pendingTravel:{}},{recycling:true},{dailyWorkStatus:{ownsNavigation:true}},{actorOwner:null},{socialInbox:{generation:3}},{serverSaveReceipt:{...i.serverSaveReceipt,proof:{...proof,actorId:'actor-'+'b'.repeat(32)}}},{serverSaveReceipt:{...i.serverSaveReceipt,proof:{...proof,at:now-60001,requestAt:now-60002}}},{serverSaveReceipt:{...i.serverSaveReceipt,state:{...state,refine:{w:1}}}},{v2:{...i.v2,sourceCoherence:{matches:false}}}])assert(!fresh.allowed({...i,...patch},'w',now),'active/proof/source/owner mismatches cannot authorize a new roll');
 cat.equipmentGoal.freshRefineAfterClosedOutcome=false;assert(scope.blocks(i,'w',now));cat.equipmentGoal.freshRefineAfterClosedOutcome=true;
 ledger.rows.unshift({id:'active-unknown',kind:'refine',target:{id:'w'},at:now-1000,status:'unresolved'});assert(!fresh.allowed(i,'w',now));ledger.rows.shift();
 // Missing old before-state is UNKNOWN, never invented as zero. Planning
 // stays read-only; preparation archives retained evidence before payment.
 i.v2.journal.rows=[orphan];const orphanBytes=JSON.stringify(orphan);
 assert(!scope.blocks(i,'w',now));
 const archived=fresh.evidence(i,'w',now),archive=archived.historyArchives[0],archiveFile=path.join(root,'logs/refine-history-originals',archive.sha256+'.json');
 const archiveBytes=fs.readFileSync(archiveFile),payload=JSON.parse(archiveBytes);
 assert.equal(JSON.stringify(payload.journal),orphanBytes);assert.equal(payload.ledger,null);assert.equal(payload.historicalCostKnown,false);
 assert.equal(archive.ledgerOriginalAvailable,false);assert(require('../src/runtime/refine-history-archive').verified(i,archived));
 assert.deepEqual(fresh.evidence(i,'w',now).historyArchives,archived.historyArchives);
 const fake={id:'fresh-uuid',target:{id:'w'},freshNativeIntent:archived,context:{...proof}};
 assert(fresh.dispatch(i,fake,{id:'w',from:0},now));
 assert(!fresh.dispatch(i,{...fake,id:archive.originalTransactionId},{id:'w',from:0},now));
 assert(!fresh.dispatch(i,{...fake,id:archive.transactionId},{id:'w',from:0},now));
 fs.writeFileSync(archiveFile,'corrupt');assert(!fresh.dispatch(i,fake,{id:'w',from:0},now));assert.throws(()=>fresh.evidence(i,'w',now),/archive differs/);fs.writeFileSync(archiveFile,archiveBytes);
 const newBusy={...orphan,id:'development:active',at:now-1000,status:'WAITING_CONFIRMATION'};i.v2.journal.rows.push(newBusy);assert(scope.blocks(i,'w',now));i.v2.journal.rows.pop();
 cat.equipmentGoal.freshRefineAfterClosedOutcome=false;assert(scope.blocks(i,'w',now));cat.equipmentGoal.freshRefineAfterClosedOutcome=true;
 assert(!require('../src/runtime/closed-gear-scope').independent(i,{...orphan,legacyIdentityUnknown:true,originalSha256:'f'.repeat(64)},'w','refine',now));
 const gates=require('../src/runtime/refinement-gates');assert(gates.check(i,'w').allowed);i.v2.journal.rows.push(newBusy);assert.equal(gates.check(i,'w').reason,'unknown refinement step or journal outcome; no replay');i.v2.journal.rows.pop();
 cat.world.MONSTERS=[{id:'pet',kind:'normal',level:1,element:'ไม่มีธาตุ'}];
 const choose=require('../src/investment-plan').choose;
 const plan=choose(state,cat,{}, {campaignComplete:true,refineGate:()=>({allowed:false,target:'w',kind:'refine',reason:'test exact native blocker'})});
 assert(plan.blocked.some(r=>r.reason==='test exact native blocker'));assert(!plan.candidates.some(r=>r.kind==='refine'));
 // Exercise the actual native ledger wrapper and dispatch boundary, not just
 // the policy predicate. The original transaction remains byte-for-byte.
 class Native{}Native.prototype.refineEquipped=require('../src/instance').GameInstance.prototype.refineEquipped;require('../src/runtime/paid-actions').installPaidActions(Native);Object.setPrototypeOf(i,Native.prototype);i.openTownService=async()=>({ok:true});let sends=0;
 i.eval=async()=>{sends++;const row=ledger.rows[0];assert.notEqual(row.id,original.id);assert.equal(row.freshNativeIntent.kind,'new_budgeted_refine_intent');assert(require('../src/runtime/refine-history-archive').verified(i,row.freshNativeIntent));assert.equal(JSON.stringify(i.v2.journal.rows[0]),orphanBytes);assert.equal(row.dispatchTracking.state,'possible');assert(row.freshNativeIntent.originalTransactionIds.includes(original.id));assert.equal(JSON.stringify(original),before);assert.equal(JSON.parse(fs.readFileSync(ledger.file)).rows[0].freshNativeIntent.kind,'new_budgeted_refine_intent');throw Error('native result lost');};
 await assert.rejects(()=>i.refineEquipped({targetId:'w',guaranteedOnly:true}),/result lost/);assert.equal(sends,1);assert.equal(i.v2.reservations.data.claims[0].status,'UNCERTAIN');assert.equal((await i.refineEquipped({targetId:'w',guaranteedOnly:true})).refined,0);assert.equal(sends,1);assert.equal(JSON.stringify(original),before);
 const restored=new ResultLedger(root,'fresh');assert.equal(restored.rows[0].freshNativeIntent.replayed,false);assert(restored.rows.some(r=>r.id===original.id&&JSON.stringify(r)===before));
 // Verified immutable legacy history may permit a new intent; changing its
 // archived bytes, identity or before-level never supplies permission.
 const raw={id:'legacy',kind:'refine',target:{id:'w'},at:now-300000,before:state},bytes=Buffer.from(JSON.stringify({rows:[raw]})),hash=crypto.createHash('sha256').update(bytes).digest('hex');fs.mkdirSync(path.join(root,'logs/migration-originals'),{recursive:true});fs.writeFileSync(path.join(root,'logs/migration-originals',hash+'.json'),bytes);
 const old={id:'development:legacy',kind:'refine',target:{id:'w'},at:raw.at,status:'OBSERVED',externalOwner:'development-ledger',legacyIdentityUnknown:true,originalSha256:hash},legacy={...i,developmentLedger:{rows:[]},v2:{...i.v2,journal:{rows:[old]}}};assert(require('../src/runtime/closed-gear-scope').independent(legacy,old,'w','refine',now));assert(!require('../src/runtime/closed-gear-scope').independent(legacy,{...old,id:'development:other'},'w','refine',now));
 console.log('PASS explicitly budgeted NEW native refine intent, immutable unknown originals, no original/ambiguous replay, real dispatch durability, restart and authority/owner/session negatives');
}finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
