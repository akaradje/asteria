'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const recovery=require('../src/runtime/material-budget-recovery'),{ResourceReservations}=require('../src/planning/resource-reservations');
const now=Date.now(),root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-material-budget-')),actor=n=>'actor-'+n.repeat(32),id=n=>n.repeat(8)+'-'+n.repeat(4)+'-'+n.repeat(4)+'-'+n.repeat(4)+'-'+n.repeat(12);
const cat={build:'fixture',world:{REFINE:{ORES:['Ore']}},nativeRecipes:[{verified:true,verifiedBuild:'fixture',cost:{Ore:15,Copper:200000},resultId:'crown'}]},economy=require('../src/economy'),load=economy.loadWiki;
economy.loadWiki=()=>({crafting:{recipes:[]}});
const members=['A','B','C'].map((charName,slot)=>({charName,slot,machine:'vps',enabled:true}));
fs.mkdirSync(path.join(root,'machines'));fs.writeFileSync(path.join(root,'machines/host-teams.json'),JSON.stringify({version:1,teams:{vps:{leader:'A',members:['A','B','C']}}}));
fs.writeFileSync(path.join(root,'machines/topology-v32.json'),JSON.stringify({version:1,revision:1,coordinatorHost:'vps',leader:'A',hosts:{vps:{id:'vps',enabled:true,adapter:'legacy_verified_controller'}},members}));
function instance(name,n){const state={coins:500000,materials:{Ore:40},equip:{head:'crown'},refine:{crown:10}},start=now-100000;
 return {root,machine:'vps',character:{name},credentials:{username:'fixture-'+name},actorIdentity:{actorId:actor(n)},actorOwner:{session:'owner'},registryV32:{store:{validateOwner:()=>true,pending:()=>[]}},autoChores:true,status:'playing',bagSessionStartedAt:start,socialInbox:{generation:2},lastSave:state,lastSaveAt:now,livePos:{room:'field',at:now},tradeAvailability:{at:now,clear:true},catalog:()=>cat,v2:{observations:{sessionId:'runtime-'+name},sourceCoherence:{matches:true},scheduler:{active:null,queue:[],closed:false},journal:{rows:[]}},developmentLedger:{rows:[]},serverSaveReceipt:{state,proof:{authority:'server_readback',actorId:actor(n),build:cat.build,generation:2,sessionStartedAt:start,rev:100,requestAt:now-100,at:now}}};}
try{
 const a=instance('A','a');a.v2.reservations=new ResourceReservations(root,a.credentials.username);
 const claim={id:id('1'),build:'old',at:now-900000,deadline:now-700000,cost:{Ore:15,Copper:200000},status:'UNCERTAIN'};
 a.v2.reservations.data.claims.push(structuredClone(claim));a.v2.reservations.save();assert(recovery.gate(a,now));
 for(const changed of [{tickBusy:true},{activeResourceClaim:{}},{teamControl:{}},{autoChores:false},{pendingTravel:{}},{nativeFreshSaveFlight:true},{tradeAvailability:{at:now,clear:false}},{livePos:{at:now,room:'tw#1'}}])assert(!recovery.gate({...a,...changed},now));
 const proof=a.serverSaveReceipt.proof;
 for(const change of [{at:now-31000},{actorId:actor('b')},{generation:3},{build:'other'},{sessionStartedAt:now-90000}])assert(!recovery.gate({...a,serverSaveReceipt:{...a.serverSaveReceipt,proof:{...proof,...change}}},now));
 a.v2.scheduler.active={kind:'tick'};assert.equal(recovery.reserve(a,now),0);a.v2.scheduler.active=null;
 a.v2.reservations.data.claims[0].transactionId=id('9');assert.equal(recovery.reserve(a,now),0);delete a.v2.reservations.data.claims[0].transactionId;
 a.bagSessionStartedAt=now-950000;a.serverSaveReceipt.proof.sessionStartedAt=a.bagSessionStartedAt;assert.equal(recovery.reserve(a,now),0);a.bagSessionStartedAt=now-100000;a.serverSaveReceipt.proof.sessionStartedAt=a.bagSessionStartedAt;
 assert.equal(recovery.reserve(a,now),1);const done=a.v2.reservations.data.claims[0];assert.equal(done.status,'RECONCILED');assert.equal(done.replayBlocked,true);assert.deepEqual(recovery.original(root,done.reconciliation.originalSha256).original,claim);assert.deepEqual(a.v2.reservations.totals(),{});assert.equal(recovery.reserve(a,now),0);
 assert.equal(a.v2.reservations.reserve(claim.id,claim.cost,{Ore:100,Copper:1000000}).ok,false,'Original claim UUID remains unusable');
 const reloaded=new ResourceReservations(root,a.credentials.username);assert.equal(reloaded.data.claims[0].status,'RECONCILED');assert.equal(reloaded.data.claims[0].replayBlocked,true);
 const b=instance('B','b'),offer={kind:'material',name:'Ore',quantity:1,donor:'A',receiver:'B'},qid=id('2'),q={id:qid,offer,phase:'UNCERTAIN',resolution:'unresolved_no_replay',at:now-900000};
 const originals=[];
 for(const i of [a,b]){const r={id:qid,offer,at:now-900000,deadline:now-700000,phase:'UNCERTAIN',build:'old',context:{actorId:i.actorIdentity.actorId,build:'old',generation:1,sessionStartedAt:now-1000000},before:7,sent:{confirm:true},receipt:{id:4,rev:5,at:now-800000}};
  const file=path.join(root,'logs/trades',crypto.createHash('sha256').update(i.character.name).digest('hex').slice(0,24),qid+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(r));originals.push({file,bytes:fs.readFileSync(file)});i.teamTradeIntent={phase:'CONFIRMED',quarantined:[q]};assert.equal(recovery.trade(i,now),1);assert(recovery.replayBlocked(i,qid));}
 assert(originals.every(x=>fs.readFileSync(x.file).equals(x.bytes)),'Original actor trade journals unchanged');
 const live=[a,b].map(i=>({charName:i.character.name,machine:'vps',runtimeGeneration:i.v2.observations.sessionId,identity:i.actorIdentity,status:'playing',lastSaveAt:now,tradeAvailability:{at:now,clear:true}}));
 assert.equal(recovery.resolve(root,structuredClone(q),live,'vps','other',now),false);
 assert.equal(recovery.resolve(root,structuredClone(q),live.map(m=>({...m,runtimeGeneration:'old'})),'vps',cat.build,now),false);
 assert.equal(recovery.resolve(root,structuredClone(q),live.slice(0,1),'vps',cat.build,now),false);
 assert.equal(recovery.resolve(root,structuredClone(q),live.map((m,n)=>n?{...m,actionOwner:{}}:m),'vps',cat.build,now),false);
 assert.equal(recovery.resolve(root,structuredClone(q),live,'vps',cat.build,now+31000),false);
 assert(recovery.resolve(root,q,live,'vps',cat.build,now));assert.equal(q.resolution,'rebased_current_material_budget');assert.equal(q.replayBlocked,true);assert.equal(q.budgetRebase.historicalSuccessKnown,false);
 assert.equal(recovery.original(root,q.budgetRebase.originalSha256).original.resolution,'unresolved_no_replay');
 const cert=recovery.readCert(root,actor('a'),qid);fs.writeFileSync(path.join(root,'logs/material-budget-originals',cert.originalSha256+'.json'),'corrupt');
 assert(!recovery.validCertificate(root,cert,{...q,resolution:'unresolved_no_replay'},live[0],'vps',cat.build,now));assert(recovery.replayBlocked(a,qid),'Corrupt evidence must not reopen original UUID');
 const rules=require('../src/planning/team-trade'),prior=q.offer;assert(rules.conflicts({kind:'material',name:'Ore',donor:'B',receiver:'C',quantity:3},prior),'Unrebased material ambiguity remains blocking');
 const work=require('../src/planning/team-workboard');const needs=[{name:'Ore',want:30,priority:30,kind:'craft',goalId:'staff'}];
 work.appendCombatNeeds(needs,[{id:'hammer',purpose:'refine',missing:[{name:'Ore',want:3,have:0}]},{id:'boots',purpose:'refine',missing:[{name:'Ore',want:4,have:0}]}],a,now);
 assert.equal(needs.length,3);assert.equal(needs.find(n=>n.goalId==='hammer').want,3);assert.equal(needs.find(n=>n.goalId==='staff').want,30);
 const inventory=ore=>({at:now,job:'advanced',lv:120,materials:{Ore:ore},locks:[],offers:[],equip:{},refine:{},holes:{},sockets:{},weaponOpts:{}});
 const team=[{charName:'A',status:'playing',teamInventory:inventory(0),teamWork:{needs,reserved:{}}},{charName:'B',status:'playing',teamInventory:inventory(12),teamWork:{needs:[{name:'Ore',want:4,kind:'refine',priority:25}],reserved:{Ore:4}}}];
 const chosen=rules.choose(team,{build:'fixture',world:{MAX_LV:120},items:{}},now);assert.equal(chosen.quantity,3);assert.equal(chosen.receiver,'A');assert.equal(chosen.priority,25);
 assert.equal(work.ownKeep(team[1],'Ore'),8,'Donor retains own next roll AND active payment hold');
 assert.equal(rules.choose(team,{build:'fixture',world:{MAX_LV:120},items:{}},now,[{kind:'material',name:'Ore',donor:'B',receiver:'C'}]),null,'New UUID alone cannot bypass unresolved quarantine');
 const runtime=require('../src/runtime/team-trade'),project=work.project;cat.items={hammer:{}};
 try{work.project=()=>({needs:[{name:'Ore',want:4,kind:'refine',goalId:'hammer'}],reserved:{Ore:4}});const intent={offer:{kind:'material',name:'Ore',quantity:3,donor:'A',receiver:'B',goalKind:'refine',goalId:'hammer'}};
 a.lastSave.materials.Ore=10;assert(!runtime.refineMaterialBudget(a,intent),'Donor cannot send into own reserved next attempt');a.lastSave.materials.Ore=11;assert(runtime.refineMaterialBudget(a,intent));a.lastSave.locks=['Ore'];assert(!runtime.refineMaterialBudget(a,intent));delete a.lastSave.locks;
 b.lastSave.materials.Ore=5;assert(runtime.refineMaterialBudget(b,intent));b.lastSave.materials.Ore=8;assert(!runtime.refineMaterialBudget(b,intent),'Receiver already funded must cancel before confirmation');
 }finally{work.project=project;}
 console.log('PASS orphan craft archive/reload/duplicate UUID, active/foreign/stale guards, both closed material owners, immutable original trade and corrupt-proof no-replay');
}finally{economy.loadWiki=load;fs.rmSync(root,{recursive:true,force:true});}
