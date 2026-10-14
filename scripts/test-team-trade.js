'use strict';
// Compile the public catalog before starting asynchronous simulated socket receipts.
// A slow isolated runner must not turn a fresh test event into a stale one.
require('../src/economy').loadCatalog(process.cwd(),require('../src/economy').newestBuild(process.cwd()));
require('./test-v32-trade-dispatch');
// Native currency review survives unrelated visuals only when every reviewed
// trade byte, network byte and world byte still matches the accepted protocol.
(()=>{const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),c=require('../src/planning/team-copper'),root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-copper-capability-'));try{
 const dir=path.join(root,'cache','cosmetic-fixture','asteria-online.io');fs.mkdirSync(dir,{recursive:true});
 const baseline='812355ce'; // Immutable reviewed fixture; a new live patch is not implicit approval.
 for(const file of ['asteria-online-visual-polish.html','asteria-net.js','asteria-world-system.js'])fs.copyFileSync(path.join(__dirname,'../cache',baseline,'asteria-online.io',file),path.join(dir,file));
 const file=path.join(dir,'asteria-online-visual-polish.html'),original=fs.readFileSync(file,'utf8'),actor={root,catalog:()=>({build:'cosmetic-fixture'}),v2:{sourceCoherence:{matches:true}}};
 assert.equal(c.sourceReviewed(actor),true);fs.writeFileSync(file,original+'\n<!-- unrelated visual revision -->');assert.equal(c.sourceReviewed(actor),true);
 fs.writeFileSync(file,original.replace("T.draft.coins = Math.max", "T.draft.coins = 99 + Math.max"));assert.equal(c.sourceReviewed(actor),false);
 fs.writeFileSync(file,original);fs.appendFileSync(path.join(dir,'asteria-net.js'),'\n// changed protocol');assert.equal(c.sourceReviewed(actor),false);
 fs.copyFileSync(path.join(__dirname,'../cache',baseline,'asteria-online.io/asteria-net.js'),path.join(dir,'asteria-net.js'));fs.appendFileSync(path.join(dir,'asteria-world-system.js'),'\n// changed world');assert.equal(c.sourceReviewed(actor),false);
 assert.equal(c.nativeTradeSection(original+'/* ---------- online: player trade ---------- */'),null);actor.v2.sourceCoherence.matches=false;assert.equal(c.sourceReviewed(actor),false);
 console.log('PASS currency capability exact native trade/network/world bytes; cosmetic-only reuse and changed-payment/protocol/world/stale/ambiguous rejection');
}finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}})();
require('./test-trade-server-evidence');
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),rules=require('../src/planning/team-trade'),{TeamTrade,quantity,protocolActive}=require('../src/runtime/team-trade'),e=require('../src/economy');
const root=process.cwd(),cat=e.loadCatalog(root,e.newestBuild(root)),now=Date.now();
const inv=(job,materials)=>({at:now,job,lv:120,jobLv:50,equip:{},refine:{},holes:{},sockets:{},weaponOpts:{},locks:[],offers:[],materials,bagFree:5});
const members=[{charName:'ExampleAccount4',status:'playing',teamInventory:inv('nightfang',{'Abyss Crystal':2})},{charName:'ExampleAccount8',status:'playing',teamInventory:inv('lumenoracle',{})}];
let offer=rules.choose(members,cat,now);assert.equal(offer.kind,'material');assert.equal(offer.quantity,1);assert.equal(offer.receiver,'ExampleAccount8');
members[0].teamInventory.materials['Abyss Crystal']=1;assert.equal(rules.choose(members,cat,now),null,'own promotion reserve must remain');
members[0].teamInventory.materials['Abyss Crystal']=2;members[1].teamInventory.at=now-31000;assert.equal(rules.choose(members,cat,now),null);
assert.equal(rules.blockedGear('windcutter_boots',{},cat),'class3');const wing=Object.values(cat.items).find(x=>x.slot==='wing');assert.equal(rules.blockedGear(wing.id,{},cat),'wing');
assert.equal(rules.blockedGear('void_fists',{refine:{void_fists:4}},cat),'refine');assert.equal(rules.blockedGear('void_fists',{equip:{weapon:'void_fists'},refine:{void_fists:4}},cat),null,'spare copy does not carry worn upgrades');
assert(rules.exactOffer({gear:[],stacks:[['Abyss Crystal',1]],coins:0},offer,true));assert(!rules.exactOffer({gear:[],stacks:[['Abyss Crystal',2]],coins:0},offer,true));assert(!rules.exactOffer({gear:[],stacks:[['Abyss Crystal',1]],coins:1},offer,true));assert(rules.exactOffer({gear:[],stacks:[],coins:0},offer,false));
assert.equal(quantity({materials:{'Abyss Crystal':2}},offer),2);
const wings=[{charName:'ExampleAccount6',status:'playing',teamInventory:inv('chronomagus',{'Celestial Plume':3})},{charName:'ExampleAccount8',status:'playing',teamInventory:inv('inquisitor',{})}];const plume=rules.choose(wings,{...cat,root},now);assert.equal(plume?.name,'Celestial Plume');assert.equal(plume.quantity,1,'keep donor two-plume first wing recipe');assert.equal(plume.priority,5);
{
 const prior={...plume,donor:'OtherDonor',receiver:'OtherReceiver'},before=JSON.stringify(prior);
 assert.equal(rules.choose(wings,{...cat,root},now,[prior])?.quantity,1,'disjoint inventories may trade the same material while preserving donor wing');
 for(const patch of [{donor:plume.donor},{receiver:plume.receiver},{donor:plume.receiver},{receiver:plume.donor},{donor:null}])assert.equal(rules.choose(wings,{...cat,root},now,[{...prior,...patch}]),null,'overlap or unknown participant preserves the no-replay quarantine');
 assert.equal(JSON.stringify(prior),before,'unrelated ambiguous transfer evidence remains unchanged');
}
const promotion=[{charName:'ExampleAccount8',status:'playing',teamInventory:inv('inquisitor',{'Pharaoh Gold':1})},{charName:'ExampleAccount12',status:'playing',teamInventory:{...inv('ironlotus',{}),lv:104}}];
assert.equal(rules.choose(promotion,{...cat,root},now)?.receiver,'ExampleAccount12','eligible uncapped promotion takes precedence over donor future wing');
promotion[1].teamInventory.lv=98;assert.equal(rules.choose(promotion,{...cat,root},now),null);
promotion[1].teamInventory.lv=104;promotion[1].teamInventory.jobLv=49;assert.equal(rules.choose(promotion,{...cat,root},now),null);
promotion[1].teamInventory.jobLv=50;assert.equal(rules.choose(promotion,{...cat,root,world:{...cat.world,ASCEND:{...cat.world.ASCEND,open:false}}},now),null);
promotion[0].teamInventory.job='lumenoracle';assert.equal(rules.choose(promotion,{...cat,root},now),null,'donor own promotion core stays reserved');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-trade-test-'));try{members[1].teamInventory.at=now;const c=new TeamTrade(tmp,{},'tum');c.reconcile([{build:cat.build,at:now,members}],cat,now);assert.equal(c.state.phase,'GATHERING');const id=c.state.id;
for(const m of members){m.teamTradeStatus={id,phase:'READY',at:now};m.livePos={room:'town',x:160,z:7,at:now};}c.reconcile([{build:cat.build,at:now,members}],cat,now);assert.equal(c.state.phase,'SESSION');
assert(protocolActive({catalog:()=>cat,character:{name:'ExampleAccount4'},teamTradeIntent:c.state},now));
const restart=new TeamTrade(tmp,{},'tum');assert.equal(restart.state.phase,'UNCERTAIN');restart.reconcile([{build:cat.build,at:now,members}],cat,now);assert.equal(restart.state.id,id);
for(const m of members){m.identity={actorId:m.charName};m.teamTradeStatus={id,phase:'CONFIRMED',at:now,receiptId:115};}c.reconcile([{build:cat.build,at:now,members}],cat,now);assert.notEqual(c.state.phase,'CONFIRMED','labels without native inventory proofs do not confirm coordinator');for(const m of members)m.teamTradeStatus.nativeInventoryProof={actorId:m.charName,at:now,rev:12};c.reconcile([{build:cat.build,at:now,members}],cat,now);assert.equal(c.state.phase,'CONFIRMED');assert.equal(c.state.evidence,'matching_server_trade_receipts_and_both_native_inventory_proofs');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-trade-quarantine-'));try{
 fs.mkdirSync(path.join(isolated,'logs/fleet'),{recursive:true});const original={id:'uncertain-old',build:cat.build,phase:'UNCERTAIN',offer:{donor:'ExampleAccount8',receiver:'ExampleAccount12',kind:'material',name:'Pharaoh Gold',quantity:1},reason:'receipt unavailable'};fs.writeFileSync(path.join(isolated,'logs/fleet/team-trade.json'),JSON.stringify(original));
 const actors=[{charName:'ExampleAccount8',status:'playing',lastSaveAt:now,teamInventory:inv('inquisitor',{'Pharaoh Gold':1,'Abyss Crystal':1})},{charName:'ExampleAccount12',status:'playing',lastSaveAt:now,teamInventory:{...inv('ironlotus',{}),lv:104}}];const q=new TeamTrade(isolated,{},'tum'),sources=[{build:cat.build,at:now,members:actors}];q.reconcile(sources,cat,now);assert.equal(q.state.id,original.id,'unknown session health cannot release independent work');
 for(const a of actors)a.tradeAvailability={at:now,clear:true};actors[0].tradeAvailability.clear=false;q.reconcile(sources,cat,now);assert.equal(q.state.id,original.id,'paused session cannot release independent work');actors[0].tradeAvailability.clear=true;q.reconcile(sources,cat,now);assert.notEqual(q.state.id,original.id);assert.equal(q.state.offer.name,'Abyss Crystal','uncertain material cannot be offered again');assert.equal(q.quarantined[0].phase,'UNCERTAIN');assert.equal(q.quarantined[0].resolution,'unresolved_no_replay');
 const beforeSession=new TeamTrade(isolated,{},'tum');assert.equal(beforeSession.state.phase,'CANCELLED');assert.equal(beforeSession.state.evidence,'not_dispatched_gathering_phase');
 q.state.phase='SESSION';q.save();const durable=new TeamTrade(isolated,{},'tum');assert(durable.quarantined.some(x=>x.id===original.id));assert.equal(durable.state.phase,'UNCERTAIN','active operation restart remains uncertain');
 q.state.phase='GATHERING';q.state.build='old-build';q.reconcile(sources,cat,now);assert.equal(q.state.phase,'CANCELLED');assert.equal(q.state.evidence,'not_dispatched_gathering_phase','version update cannot strand gathering');
 console.log('PASS durable per-item quarantine, independent transfers require fresh clear sessions, uncertain outcomes never reclassified');
}finally{fs.rmSync(isolated,{recursive:true,force:true});}
console.log('PASS spare core sharing, own reserve, stale peer rejection, restricted/invested gear, exact zero-coin offers, two-party evidence, restart no replay');

const gearPair=[{charName:'ExampleAccount8',status:'playing',teamInventory:{...inv('inquisitor',{}),offers:[{id:'starless_slippers',index:0}]}},{charName:'ExampleAccount6',status:'playing',teamInventory:{...inv('chronomagus',{}),bagFree:0}}];
const copper=(coins,reserve=12000)=>({coins,reserve,target:reserve+50000,spare:Math.max(0,coins-reserve-50000),need:coins<reserve+10000?Math.max(0,reserve+50000-coins):0});
const cashPair=[{machine:'tum',charName:'Rich',status:'playing',teamInventory:{...inv('inquisitor',{}),copper:copper(4000000)}},{machine:'tum',charName:'Tank',status:'playing',teamInventory:{...inv('dragonknight',{}),copper:copper(15000)}}];
const cashOffer=rules.choose(cashPair,cat,now);assert.equal(cashOffer.kind,'currency');assert.equal(cashOffer.quantity,47000);assert.equal(cashOffer.donor,'Rich');
assert.equal(quantity({coins:15000},cashOffer),15000);
assert(rules.exactOffer({coins:47000,gear:[],stacks:[]},cashOffer,true));assert(rules.exactOffer({coins:0,gear:[],stacks:[]},cashOffer,false));
for(const bad of [{coins:46999,gear:[],stacks:[]},{coins:47000,gear:['extra'],stacks:[]},{coins:47000,gear:[],stacks:[['Silk',1]]}])assert(!rules.exactOffer(bad,cashOffer,true));
assert.equal(rules.choose(cashPair,cat,now,[{...cashOffer,receiver:'Other'}]),null,'unknown donor Copper outcome blocks a different recipient too');
assert.equal(rules.choose(cashPair,cat,now,[{...cashOffer,donor:'Other'}]),null,'unknown recipient Copper outcome blocks another donor');
cashPair[0].teamInventory.copper=copper(65000);assert.equal(rules.choose(cashPair,cat,now),null,'sub-refill cash must not own two actors and the fleet queue');
cashPair[0].teamInventory.copper=copper(72000);assert.equal(rules.choose(cashPair,cat,now).quantity,10000,'bounded partial refill funding preserves donor reserve');
cashPair[0].teamInventory.copper.spare++;assert.equal(rules.choose(cashPair,cat,now),null,'inconsistent budget cannot authorize donation');
cashPair[0].teamInventory.copper=copper(4000000);cashPair[1].teamInventory.copper=copper(80000);assert.equal(rules.choose(cashPair,cat,now),null,'no gratuitous wallet equalization');
cashPair[1].teamInventory.copper=copper(15000);cashPair[1].teamInventory.at=now-30001;assert.equal(rules.choose(cashPair,cat,now),null,'cash also rejects stale inventory');
console.log('PASS exact Copper need, donor reserve, no uncertain-wallet replay, bounded partial funding and stale/invalid budget rejection');
{
 const donor=structuredClone(cashPair[0]);donor.teamInventory.copper=copper(4000000);donor.machine='vps';
 const leveler=structuredClone(cashPair[1]);leveler.charName='Punch';leveler.machine='windows';leveler.teamInventory.at=now;leveler.teamInventory.lv=112;leveler.teamInventory.copper=copper(4993,13300);
 const ordinary=structuredClone(cashPair[1]);ordinary.charName='Capped';ordinary.machine='vps';ordinary.teamInventory.copper=copper(15000);ordinary.teamInventory.at=now;
 const urgent=rules.choose([donor,ordinary,leveler],cat,now);assert.equal(urgent.receiver,'Punch','uncapped upkeep shortage precedes same-host ordinary cash balancing');assert.equal(urgent.priority,.25);assert.equal(urgent.quantity,58307);
 assert.equal(rules.choose([donor,leveler],cat,now,[{...urgent,receiver:'Other'}]),null,'urgent refill cannot replay a donor with unknown Copper exposure');
 donor.teamInventory.copper=copper(62297);assert.equal(rules.choose([donor,leveler],cat,now),null,'observed297 Copper queue starvation is rejected');
 console.log('PASS uncapped upkeep first, actual Punch budget, tiny297 rejection and original unknown wallet protection');
}
{
 const c=require('../src/planning/team-copper'),at=Date.now(),materials=Object.fromEntries(Object.entries(cat.world.ASCEND.items).map(([k,n])=>[k,n]));materials['Abyss Crystal']=0;
 const a={character:{name:'NeedClass'},catalog:()=>cat,lastSave:{job:'nightfang',lv:120,jobLv:50,materials},promotionPriorityStatus:{build:cat.build,status:'no_affordable_listing',item:'Abyss Crystal',marketNow:at,receivedAt:at,offers:[{kind:'stack',item:'Abyss Crystal',id:999,n:1,price:3000000,mine:0,expires:at+3600000}]}};
 const funding=c.classFunding(a,at,false);assert.equal(funding.price,3000000);assert(c.validClassFunding(funding,at));
 a.promotionPriorityStatus.build='other';assert.equal(c.classFunding(a,at,false),null,'different game quote cannot authorize class funding');a.promotionPriorityStatus.build=cat.build;
 a.promotionPriorityStatus.receivedAt=at-10000;assert(c.classFunding(a,at,false),'bounded original verified price remains useful for funding while peers travel, not purchasing');
 a.promotionPriorityStatus.receivedAt=at-600001;assert.equal(c.classFunding(a,at,false),null,'expired price cannot start funding');
 a.promotionPriorityStatus.receivedAt=at-10000;
 a.teamTradeIntent={deadline:at+600000,offer:{kind:'currency',receiver:a.character.name,classFunding:funding}};assert.equal(c.classFunding(a,at,true),funding,'registered native quote remains bounded through owned gathering');
 assert.equal(c.classFunding(a,funding.validUntil,true),null,'expired funding never authorizes another transfer');
 a.teamTradeIntent.offer.receiver='WrongActor';assert.equal(c.classFunding(a,at,true),null);a.teamTradeIntent.offer.receiver=a.character.name;
 a.lastSave.materials['Abyss Crystal']=1;assert.equal(c.classFunding(a,at,true),null,'actual class core cancels funding');a.lastSave.materials['Abyss Crystal']=0;
 a.promotionPriorityStatus.receivedAt=at;a.promotionPriorityStatus.offers[0].mine=1;assert.equal(c.classFunding(a,at,false),null,'own listing cannot demand team cash');a.promotionPriorityStatus.offers[0].mine=0;
 a.promotionPriorityStatus.offers[0].price=3000001;assert.equal(c.classFunding(a,at,false),null,'bounded class quote rejects inflated price');
 const funded={coins:1300000,reserve:112000,target:3162000,spare:0,need:1862000,classFunding:funding};assert(c.valid(funded));
 const pair=[{machine:'tum',charName:'Rich',status:'playing',teamInventory:{...inv('inquisitor',{}),copper:copper(4000000)}},{machine:'windows',charName:'NeedClass',status:'playing',teamInventory:{...inv('nightfang',{}),copper:funded}}];
 const offer=rules.choose(pair,cat,at);assert.equal(offer.quantity,1000000);assert.deepEqual(offer.classFunding,funding);assert(rules.exactOffer({coins:1000000,gear:[],stacks:[]},offer,true));
 const partial=structuredClone(pair);partial[0].teamInventory.copper=copper(400000);assert.equal(rules.choose(partial,cat,at).quantity,partial[0].teamInventory.copper.spare-28000,'class donor keeps one additional full potion replacement during its trip');
 partial[0].teamInventory.copper=copper(90000);assert.equal(rules.choose(partial,cat,at),null,'tiny class cash does not consume another gathering cycle');
 const upkeep=structuredClone(cashPair[1]);upkeep.charName='Upkeep';upkeep.machine=pair[0].machine;upkeep.teamInventory.at=at;upkeep.teamInventory.copper=copper(15000);const priorities=rules.choose([...pair,upkeep],cat,at);assert.equal(priorities.receiver,pair[1].charName,'verified class fund precedes same-host ordinary wallet padding');
 pair[0].teamInventory.job='nightfang';assert.equal(rules.choose(pair,cat,at),null,'an unpromoted character cannot donate a partial class fund to another class receiver');pair[0].teamInventory.job='inquisitor';
 assert(!rules.exactOffer({coins:1000001,gear:[],stacks:[]},{...offer,quantity:1000001},true));assert(!rules.exactOffer({coins:1000000,gear:[],stacks:[]},{...offer,classFunding:undefined},true),'ordinary transfer cap unchanged');
 assert.equal(rules.choose(pair,cat,at,[{...offer,receiver:'Other'}]),null,'unknown Copper exposure still blocks all new donor cash');
 const idle={lastSaveAt:at,tradeAvailability:{clear:true,at},teamTradeStatus:{phase:'UNCERTAIN',navigationReleased:true,confirmationSent:false,receiptId:null,idleAfter:at-10000,idleNavigationEvidence:{kind:'fresh_native_idle_after_deadline_no_confirmation',outcome:'unknown',replayBlocked:true,at:at-1000,saveAt:at-2000},offer:{kind:'material',name:'Warden Core',quantity:3}}};
 assert(c.independentMaterialWallet(idle,at));idle.teamTradeStatus.offer.kind='currency';assert(!c.independentMaterialWallet(idle,at));idle.teamTradeStatus.offer.kind='material';idle.teamTradeStatus.confirmationSent=true;assert(!c.independentMaterialWallet(idle,at));idle.teamTradeStatus.confirmationSent=false;idle.tradeAvailability.clear=false;assert(!c.independentMaterialWallet(idle,at));assert.equal(idle.teamTradeStatus.phase,'UNCERTAIN','original material outcome is never settled or resent');
 console.log('PASS fresh exact class-market funding, bounded retained quote, million-Copper class-only cap, donor reserve, actual-core cancellation and independent idle noncurrency wallet guards');
}
{
 const optional=[{charName:'Donor',status:'playing',teamInventory:inv('inquisitor',{'Tyrant Ember':99}),teamWork:{needs:[],reserved:{}}},{charName:'Wing',status:'playing',teamInventory:inv('phantomsniper',{}),teamWork:{needs:[{kind:'craft',name:'Tyrant Ember',want:1,priority:5}]}}];
 const before=rules.choose(optional,cat,now);assert(before,'baseline optional development offer exists');
 optional[1].classSupport={reservation:{expiresAt:now+60000}};assert.equal(rules.choose(optional,cat,now),null,'a held actual class group cannot be pulled into even an optional transfer');optional[1].classSupport=null;
 const unfinished={charName:'Class',status:'playing',teamInventory:inv('nightfang',{})};assert.equal(rules.choose([...optional,unfinished],cat,now)?.priority,0,'available class core wins over optional wing/craft');
 optional[0].teamInventory.materials={};assert.equal(rules.choose([...optional,unfinished],cat,now),null,'missing class waits instead of opening another optional development trade');
 unfinished.status='offline';optional[0].teamInventory.materials={'Tyrant Ember':99};assert(rules.choose([...optional,unfinished],cat,now),'optional work resumes without a fresh online unfinished class');
 console.log('PASS new optional trade scheduling waits for fresh eligible class deficit; dispatched journal remains unchanged');
}
const cashRecovery=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-cash-unsent-'));
try{
 const fast=new TeamTrade(cashRecovery,{},'tum');fast.state={phase:'CONFIRMED',receiptId:42,finishedAt:now-15001,evidence:'matching_server_trade_receipts_and_both_outgoing_saves'};
 const ready=structuredClone(cashPair);for(const m of ready){m.lastSaveAt=m.teamInventory.at=now;m.tradeAvailability={at:now,clear:true};}fast.reconcile([{build:cat.build,at:now,members:ready}],cat,now);assert.equal(fast.state.phase,'GATHERING','both real receipts and native saves permit a new plan after15s');
 fast.state={phase:'CONFIRMED',finishedAt:now-15001};fast.reconcile([{build:cat.build,at:now,members:ready}],cat,now);assert.equal(fast.state.phase,'CONFIRMED','a label without matching receipts does not shorten cooldown');fast.state={phase:'CANCELLED',finishedAt:now-15001};fast.reconcile([{build:cat.build,at:now,members:ready}],cat,now);assert.equal(fast.state.phase,'CANCELLED','cancelled original plans keep the full backoff');
 const {noDispatch}=require('../src/runtime/team-trade');assert(noDispatch({sent:{}}));
 for(const row of [{},{sent:[]},{sent:{request:true}},{sent:{unknown:false}},{sent:{offer:0}},{sent:{},sessionId:0},{sent:{},receipt:0}])assert(!noDispatch(row));
 const c=new TeamTrade(cashRecovery,{},'tum');c.state={id:'cash-never-sent',phase:'UNCERTAIN',build:cat.build,offer:cashOffer,at:now,finishedAt:now-130000};c.save();
 cashPair[1].teamInventory.at=now;
 for(const m of cashPair){m.lastSaveAt=now;m.tradeAvailability={at:now,clear:true};m.teamTradeStatus={id:c.state.id,phase:'CANCELLED',at:now,noDispatch:true};}
 const sources=[{machine:'tum',build:cat.build,at:now,members:cashPair}];cashPair[1].teamTradeStatus.noDispatch=false;c.reconcile(sources,cat,now);assert.equal(c.state.phase,'UNCERTAIN','one no-command proof cannot release another wallet');
 cashPair[1].teamTradeStatus.noDispatch=true;cashPair[1].tradeAvailability.clear=false;c.reconcile(sources,cat,now);assert.equal(c.state.phase,'UNCERTAIN','native session must also be clear');
 cashPair[1].tradeAvailability.clear=true;c.reconcile(sources,cat,now);assert.equal(c.state.phase,'CANCELLED');assert.equal(c.quarantined[0].phase,'UNCERTAIN','original uncertainty history retained');assert.equal(c.quarantined[0].resolution,'resolved_not_dispatched');
 const later=now+120001;for(const m of cashPair){m.lastSaveAt=m.teamInventory.at=m.tradeAvailability.at=later;}c.reconcile([{...sources[0],at:later}],cat,later);assert.equal(c.state.phase,'GATHERING','new plan allowed only for proven zero-command wallets');assert.notEqual(c.state.id,'cash-never-sent');
 console.log('PASS both durable zero-command proofs plus native clear sessions, original uncertainty preserved, bounded replan and malformed/sent evidence rejected');
}finally{fs.rmSync(cashRecovery,{recursive:true,force:true});}
const legacyHeadroomCat={...cat,equipmentGoal:{enabled:false}}; // Test bag mechanics independently of the persistent Legendary-only goal.
assert.equal(rules.choose(gearPair,legacyHeadroomCat,now),null,'gear transfer waits for receiver bag headroom before gathering');gearPair[1].teamInventory.bagFree=2;assert.equal(rules.choose(gearPair,legacyHeadroomCat,now)?.kind,'gear','available headroom releases verified gear transfer');

const unsentRoot=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-unsent-trade-'));
try{
 const {reconcileUnsentCancellation}=require('../src/runtime/team-trade');
 const actor=phase=>({teamTradeIntent:{id:'never-sent',phase:'UNCERTAIN',reason:'peer unavailable'},tradeJournal:{id:'never-sent',phase,sent:{}},tradeJournalFile:path.join(unsentRoot,'actor.json')});
 for(const phase of ['READY','GATHERING','UNCERTAIN']){
  const i=actor(phase);assert(reconcileUnsentCancellation(i));assert.equal(i.teamTradeStatus.phase,'CANCELLED');assert.equal(i.teamTradeIntent.phase,'UNCERTAIN','global uncertainty must stay quarantined');assert.equal(JSON.parse(fs.readFileSync(i.tradeJournalFile)).evidence,'no_server_trade_command_dispatched');assert(!reconcileUnsentCancellation(i),'release is idempotent');
 }
 for(const extra of [{sent:{request:true}},{sent:{confirm:true}},{sessionId:42},{receipt:{id:42}},{sent:null},{id:'another-intent'}]){
  const i=actor('READY');Object.assign(i.tradeJournal,extra);assert(!reconcileUnsentCancellation(i),'dispatched/session/missing journal evidence cannot be reclassified');assert.equal(i.tradeJournal.phase,'READY');
 }
 console.log('PASS stale READY/uncertain zero-command release, durable local cancellation, preserved coordinator uncertainty and dispatched no-replay guards');
}finally{fs.rmSync(unsentRoot,{recursive:true,force:true});}

(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-closed-trade-'));try{
 fs.mkdirSync(path.join(root,'machines'),{recursive:true});fs.writeFileSync(path.join(root,'machines/fleet.json'),JSON.stringify({members:[{charName:'A'},{charName:'B'}]}));
 const t=Date.now(),intent={id:'closed-old',build:cat.build,phase:'SESSION',at:t,startedAt:t-10000,deadline:t+60000,offer:{donor:'A',receiver:'B',kind:'material',name:'Silk',quantity:1}};
 let sends=0;const i={root,character:{name:'A'},catalog:()=>cat,lastSave:{materials:{Silk:3}},teamTradeIntent:intent,tradeJournal:{id:intent.id,phase:'UNCERTAIN',sessionId:7,sent:{confirm:true,cancel:true}},tradeJournalFile:path.join(root,'journal.json'),socialLast:async()=>null,socialSend:async()=>{sends++;}};
 const {tick}=require('../src/runtime/team-trade');assert.equal(await tick(i,{}),null,'closed uncertain journal yields back to personal farm');assert.equal(i.tradeJournal.phase,'UNCERTAIN');assert.equal(sends,0,'uncertain transaction never replayed');
 i.socialLast=async type=>type==='tropen'?{id:7,with:{name:'B'},_receivedAt:t}:null;assert.match(await tick(i,{}),/waiting for owned session close/);assert.equal(sends,0);console.log('PASS terminal local trade returns to farming only after owned server session is absent, preserving uncertainty without replay');
 }finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
