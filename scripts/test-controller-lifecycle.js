 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-controller-lifecycle-')),intent=require('../src/runtime/host-intent');
const panel=fs.readFileSync(path.join(__dirname,'../src/panel.js'),'utf8');
let clock=1000000,spawned=0,kills=0,failKill=false,manualDuringDrain=false;
const timers=[];
const context={ROOT:root,LOG_DIR:path.join(root,'logs'),STOP_FILE:path.join(root,'logs/.stop'),STATUS_FILE:path.join(root,'logs/status.json'),fs,path,console:{error(){}},process:{execPath:process.execPath},argv:{federation:true,n:3},child:null,startedAt:0,lastOptions:null,lastError:null,stopping:false,controlRevision:0,stopTask:null,watchdogBusy:false,autoRestart:true,HUNG_AFTER_MS:240000,
 Date:class extends Date{static now(){return clock;}},buildArgs:o=>['--n='+o.n],consoleName:()=> 'test-console.log',
 require:id=>id==='./runtime/controller-recovery'?{ControllerRecovery:class extends require('../src/runtime/controller-recovery').ControllerRecovery{constructor(o){super({...o,now:()=>clock,schedule:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},cancel:()=>{}});}}}:require(path.resolve(__dirname,'../src',id)),
 spawn:()=>{spawned++;const p=new EventEmitter();p.pid=12345;return p;},
 sleep:async ms=>{clock+=ms;if(manualDuringDrain){manualDuringDrain=false;context.controlRevision++;intent.record(root,'operator_stopped',clock);context.child.emit('exit',0);}},
 terminateTree:async()=>{kills++;if(failKill)throw Error('fixture cleanup denied');context.child.emit('exit',0);},
 api:{health:async()=>({ok:true,build:'abcdef12'})},setTimeout:(fn,ms)=>{const t={fn,ms,unref(){}};timers.push(t);return t;},clearTimeout:()=>{},
};
vm.createContext(context);vm.runInContext(panel.slice(panel.indexOf('function start(o)'),panel.indexOf('// ---------------------------------------------------------------- status')),context);
(async()=>{try{
 intent.record(root,'operator_stopped',clock);
 assert.equal(context.start({n:2}).ok,false);assert.equal(intent.view(root,false,clock).operatorStopped,true,'invalid start cannot erase stop');
 assert.equal(context.start({n:3}).ok,true);assert.equal(intent.view(root,false,clock).operatorStopped,false,'direct autostart clears old deployment stop');
 context.child.emit('exit',1);assert.equal(timers.length,1,'crash after direct start schedules recovery');
 assert.equal((await context.start({n:3})).ok,true);clock+=250000;failKill=true;
 await context.watchdogTick();assert(context.child,'failed cleanup retains child ownership');assert.equal(context.stopping,false);assert.equal(context.stopTask,null);assert.equal(context.start({n:3}).ok,false,'no duplicate while old child survives');
 failKill=false;manualDuringDrain=true;await context.watchdogTick();assert.equal(context.child,null);assert.equal(intent.view(root,false,clock).operatorStopped,true,'manual stop during watchdog preserved');
 const count=spawned;await timers[0].fn();assert.equal(spawned,count,'old recovery timer cannot undo manual stop');
 intent.record(root,'operator_stopped',clock);context.start({n:3});assert.equal(intent.view(root,false,clock).operatorStopped,false);
 const a=context.stop(),b=context.stop();assert.equal(a,b,'single-flight stop');assert.equal(context.start({n:3}).ok,false);await a;assert.equal(context.child,null);
 context.spawn=()=>{throw Error('fixture spawn failure');};assert.throws(()=>context.start({n:3}),/spawn failure/);assert.equal(intent.view(root,false,clock).operatorStopped,false,'launch failure retains requested run intent for retry');
 // Exercise actual refresh callback with a null health response, not just inspect().
 let inspected=false;const c={...context,systemRecovery:{busy:false},child:{pid:1},stopping:false,clientRefreshBusy:false,controlRevision:0,startedAt:1,argv:{federation:true,machine:'tum'},api:{health:async()=>null},clientRefresh:{state:{},inspect:h=>{inspected=true;assert.equal(h.ok,false);return {action:'wait'};},record:()=>{throw Error('unexpected refresh exception');}},saveClientRefresh(){}};
 vm.createContext(c);vm.runInContext(panel.slice(panel.indexOf('async function clientRefreshTick()'),panel.indexOf('const { AutoBrain }')),c);await c.clientRefreshTick();assert(inspected);assert.equal(c.clientRefreshBusy,false);
 inspected=false;c.systemRecovery.busy=true;await c.clientRefreshTick();assert(!inspected,'game refresh waits for source reviewer to complete public promotion');
 // Execute dashboard schedule renderer in isolation; no game/browser needed.
 const ui=fs.readFileSync(path.join(__dirname,'../src/public/fleet-layout.js'),'utf8'),u={Date};vm.createContext(u);vm.runInContext(ui.slice(ui.indexOf('function rankingScheduleText'),ui.indexOf('function renderServerRankings')),u);
 assert.match(u.rankingScheduleText({nextUpdateAt:1},{online:false},100),/รอเชื่อมต่อ/);assert.match(u.rankingScheduleText({nextUpdateAt:1},{online:true,detailsFresh:true},100),/เลยกำหนด/);assert.match(u.rankingScheduleText({nextUpdateAt:200},{online:true,detailsFresh:true},100),/รอบถัดไป/);
 console.log('PASS actual panel launch intent, crash retry, failed cleanup ownership, manual-stop fence, single-flight drain, null health and ranking schedule');
 }finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
