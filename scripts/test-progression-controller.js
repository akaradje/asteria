'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {ProgressionController,changes}=require('../src/runtime/progression-controller');
const {ActionScheduler}=require('../src/runtime/action-scheduler');
const controller=require('../src/runtime/progression-controller');
{
 const i={lastSave:{lv:120},catalog:()=>({build:'b',world:{MAX_LV:120}}),developmentProgress:{build:'b',target:{id:'shield',cost:{Copper:100,Core:1}}},goal:{kind:'card-collection',monsterId:'a'}};
 const first=controller.task(i,1000);i.goal={kind:'pet-unlock',monsterId:'b'};assert.equal(controller.task(i,2000).key,first.key,'side task switches cannot reset the equipment objective');
 const a={saveAt:1,resources:{Copper:100,Core:0}},b={saveAt:2,resources:{Copper:1000,Core:0}};
 assert.deepEqual(controller.goalChanges(first,a,b),[],'surplus Copper cannot conceal missing core');
 assert.deepEqual(controller.goalChanges(first,a,{...b,resources:{Copper:1000,Core:1}}),['target-material']);
 const irrelevantBefore={...a,lv:120,exp:1,job:'a',jobLv:70,jobExp:0,astral:{at:1,generation:1,star:5,exp:1,points:'{}'},equipmentProgress:{legendary:6,refine:0}},irrelevantAfter={...irrelevantBefore,...b,exp:2,astral:{...irrelevantBefore.astral,at:2,exp:20}};
 assert.deepEqual(controller.goalChanges(first,irrelevantBefore,irrelevantAfter),[],'secondary EXP and Astral EXP cannot reset a stalled equipment clock');
 assert.deepEqual(controller.goalChanges(first,irrelevantBefore,{...irrelevantAfter,equipmentProgress:{legendary:7,refine:0}}),['equipment-improvement'],'native equipment improvement remains primary progress');
 i.developmentProgress.build='old';assert.equal(controller.primary(i).target,'Legendary-8-refine-10','old-build recipe never selected');
}
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-progression-'));try{
 let now=2000000,calls=0;
 const i={root,status:'playing',page:{},character:{name:'A'},lastSaveAt:now,lastSave:{lv:120,job:'high',jobLv:70,exp:0,equip:{},bag:[],potions:{'Red Potion':20},bestiary:{m:10}},livePos:{at:now,room:'town'},vitals:{at:now,hp:1},catalog:()=>({build:'b1',world:{MAX_LV:120,bagCap:()=>48}}),v2:{sourceCoherence:{matches:true},scheduler:new ActionScheduler({now:()=>now})}};
 // Use native names accepted by the existing supply adapter.
 i.lastSave.potions=20;assert.equal(require('../src/runtime/survival').hpPots(i.lastSave),20);
 const sample=ms=>{now+=ms;i.lastSaveAt=i.livePos.at=i.vitals.at=now;return c.observe(i,now);};
 let c=new ProgressionController(root,'PRIVATE_ACCOUNT',{now:()=>now,adapters:{run:async(action)=>{calls++;return action;}}});
 c.observe(i,now);sample(180000);assert.equal(c.view().nextAction,'reobserve');
 await c.tick(i,{});assert.equal(calls,0,'outside tick scheduler cannot dispatch');
 const tick=()=>i.v2.scheduler.run('tick',()=>c.tick(i,{}));
 await tick();assert.equal(calls,1);assert.equal(c.view().state,'awaiting-result');
 c=new ProgressionController(root,'PRIVATE_ACCOUNT',{now:()=>now,adapters:{run:async()=>{calls++;return 'sent';}}});
 c.observe(i,now);assert.equal(c.view().state,'awaiting-result','restart retains pending step and budget');
 sample(5000);assert.equal(c.data.outcomes.length,1,'only new native save confirms reobserve');
 sample(120000);assert.equal(c.view().nextAction,'replan');await tick();sample(50000);sample(120000);await tick();sample(50000);sample(120000);
 assert.equal(c.view().recentAttempts,3);assert.equal(c.view().nextAction,null);assert.equal(c.view().state,'attention');
 i.status='stopped';sample(1000);assert.equal(c.view().state,'paused');await tick();assert.equal(calls,3,'manual stop never resumes');i.status='playing';
 sample(900000);i.teamControl=true;assert.equal(c.observe(i,now).state,'owned');await tick();assert.equal(calls,3);i.teamControl=false;
 i.lastSaveAt=now-30001;assert.equal(c.observe(i,now).state,'waiting-evidence');await tick();assert.equal(calls,3);i.lastSaveAt=now;
 i.v2.sourceCoherence.matches=false;assert.equal(c.observe(i,now).state,'waiting-evidence');i.v2.sourceCoherence.matches=true;
 // Rare-drop combat is activity, not material success and not a frozen worker.
 i.livePos.room='w1';i.goal={kind:'craft-work',material:'Ore',monsterId:'m',mapId:'w1'};i.endgameCampaign={phase:'wing',target:'wing',requirements:[{name:'Ore',want:3,have:0}]};
 sample(1000);for(let n=0;n<70;n++){i.lastSave.bestiary.m++;sample(15000);}assert.equal(c.view().state,'watching');assert.equal(c.view().nextAction,null);assert(!c.data.events.at(-1).fields?.includes('target-material'));
 // A full bag reaches a safe adapter; click alone and unrelated gear do not
 // claim campaign completion. Unknown purchases are neither cleared nor replayed.
 i.livePos.room='town';i.lastSave.bag=Array(48).fill('junk');sample(1000);assert.equal(c.view().nextAction,'inventory');
 const journal={pending:()=>({status:'UNCERTAIN',id:'original'})};i.v2.journal=journal;assert.equal(c.observe(i,now).state,'reconcile');await tick();assert.equal(calls,3);assert.equal(i.v2.journal,journal);delete i.v2.journal;
 await tick();assert.equal(calls,4);sample(5000);assert.equal(c.view().state,'awaiting-result');i.lastSave.bag.pop();sample(5000);assert.equal(c.data.outcomes.at(-1).action,'inventory');
 // New build invalidates the old expected result but retains recovery budget.
 i.catalog=()=>({build:'b2',world:{MAX_LV:120,bagCap:()=>48}});sample(1000);assert.equal(c.view().recentAttempts,1);assert.equal(c.view().quietMs,0);
 i.endgameCampaign={phase:'wing',target:'Wing',ready:true,requirements:[]};sample(1000);sample(180000);
 await tick();const count=c.data.outcomes.length;i.lastSave.equip.weapon='Other';sample(5000);assert.equal(c.data.outcomes.length,count,'unrelated equip cannot confirm wing action');i.lastSave.equip.wing='Wing';sample(5000);assert.equal(c.data.outcomes.length,count+1);
 // Ownership can change while an adapter awaits. Existing scheduler cancellation
 // interrupts the continuation and retains the durable attempt/protocol journals.
 const sch=new ActionScheduler({now:()=>now});i.v2.scheduler=sch;i.endgameCampaign=null;i.goal=null;i.lastSave.equip={};let release;
 c=new ProgressionController(root,'cancel',{now:()=>now,adapters:{run:()=>new Promise(r=>release=r)}});c.observe(i,now);sample(180000);const waiting=tick();await Promise.resolve();sch.cancel('manual stop');release('sent');await assert.rejects(waiting,/cancelled/);assert.equal(c.data.pending.action,'reobserve');
 const projected=require('../src/runtime/v3-projection').project({controller:{...c.view(),password:'hidden',history:[{kind:'safe',token:'hidden'}],learning:{file:'private'}}});assert(!JSON.stringify(projected).includes('hidden'));assert(!JSON.stringify(projected).includes('private'));
 const context={esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),fmt:x=>String(x)};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/public/fleet-layout.js'),'utf8'),context);const html=context.progressionControllerLayout({...projected.controller,target:'<img src=x>',reason:'<script>x</script>'});assert(!html.includes('<img'));assert(!html.includes('<script>'));
 assert(!fs.readFileSync(c.file,'utf8').includes('PRIVATE_ACCOUNT'));
 fs.writeFileSync(c.file,'corrupt');const bad=new ProgressionController(root,'cancel',{now:()=>now});bad.observe(i,now);assert.equal(bad.view().state,'attention');assert.equal(fs.readFileSync(c.file,'utf8'),'corrupt','corrupt history is not replaced');
 // Exercise the production watchdog adapter, not only a fake coordinator action.
 const select=require('../src/runtime/main-quest'),oldSelect=select.selectTarget;let verified=false,auto=[],marked=0;
 try{select.selectTarget=async()=>verified;const prototype={};require('../src/runtime/advanced-instance').installAdvancedRuntime({prototype});
  const actor={observeFarmGuard:()=>({action:'repair_auto',room:'w1'}),v2:{farmWatchdog:{mark:()=>marked++}},goal:{mapId:'w1',monsterId:'m'},livePos:{room:'w1'},expeditionAuto:async on=>auto.push(on),log:()=>{}};
  await prototype.farmGuardTick.call(actor,{});verified=true;await prototype.farmGuardTick.call(actor,{});actor.livePos.room='town';await prototype.farmGuardTick.call(actor,{});
  assert.deepEqual(auto,[false,true,false],'AUTO requires native exact target and matching map; never dummy town');assert.equal(marked,3);
 }finally{select.selectTarget=oldSelect;}
 // A dead renderer's pending close must not wedge stop indefinitely or permit
 // another login while an old shared context may remain alive.
 const close=require('../src/runtime/bounded-close'),normalClose=close.boundedClose;
 try{close.boundedClose=(fn)=>normalClose(fn,15);let ownedClosed=0;
  const pool=new(require('../src/browserpool').BrowserPool)({}),ctx={close:()=>new Promise(()=>{}),__ownBrowser:{close:async()=>ownedClosed++}};pool.refs=1;
  await Promise.all([pool.release(ctx),pool.release(ctx)]);assert.equal(ownedClosed,1);assert.equal(pool.refs,0);await pool.release(ctx);assert.equal(ownedClosed,1,'duplicate cleanup does not decrement refs or close again');
  const shared={close:()=>new Promise(()=>{})};pool.refs=1;await assert.rejects(pool.release(shared),/cleanup timeout/);assert.equal(pool.refs,1,'unconfirmed shared context stays owned');
  const actor={ctx:shared,page:{},pool,cdp:{detach:()=>new Promise(()=>{})}};
  await assert.rejects(require('../src/instance').GameInstance.prototype.stop.call(actor),/cleanup timeout/);assert.equal(actor.ctx,shared,'retry retains exact old context');assert.equal(actor.status,'stopping');
  const Instance=require('../src/instance').GameInstance;Instance.recyclingNow=false;Instance.lastRecycleStartAt=Date.now()-60000;let launches=0;
  actor.log=()=>{};actor.launch=async()=>launches++;await assert.rejects(Instance.prototype.recycle.call(actor,'fixture dead renderer'),/cleanup timeout/);assert.equal(launches,0,'recycle cannot create a duplicate after unconfirmed close');assert.equal(actor.ctx,shared);assert.equal(Instance.recyclingNow,false,'failed cleanup releases farm-wide recycle lease');
 }finally{close.boundedClose=normalClose;}
 assert.deepEqual(changes({saveAt:2,lv:10,exp:99},{saveAt:2,lv:11,exp:0}),[],'duplicate save cannot prove progress');
 console.log('PASS persistent task/recovery budgets, native expected proof, scheduler-only dispatch/cancellation, stop/stale/build/owner guards, random-loot activity, scoped unknown gate, corrupt-state preservation and escaped dashboard');
 }finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
