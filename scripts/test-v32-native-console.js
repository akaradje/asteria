'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),n=require('../src/runtime/native-bot-console'),{ResourcePressure}=require('../src/runtime/resource-pressure');
const build=JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build,html=fs.readFileSync('cache/'+build+'/asteria-online.io/asteria-online-visual-polish.html','utf8');for(const id of ['function botStart()','function botStop()','id="botModeGo"','data-bc="exit"'])assert(html.includes(id),'reviewed current native console contract');
for(const startup of [{},{status:'init'},{nativeBotConsole:{actorId:undefined,generation:null,at:100,active:true}}])assert.equal(n.observedActive(startup,101),false,'partial startup telemetry must not crash or authenticate an unknown actor');
let active=false;const fake={body:{classList:{contains:()=>active}},getElementById:id=>id==='botCon'?(active?{}:null):id==='botModeGo'?{click:()=>{active=true;}}:null,querySelector:()=>({click:()=>{active=false;}})};
const run=want=>vm.runInNewContext('('+n.controls.toString()+')('+want+')',{document:fake});assert(run(true).ok);assert.equal(run(true).changed,false);assert(run(false).ok);
async function killSwitch(){let opens=0;const a={actorIdentity:{actorId:'native-one'},registryV32:{policy:{nativeBotConsoleCanary:['native-one']}},status:'playing',lastSaveAt:100000,v2:{sourceCoherence:{matches:true},journal:{pending:()=>null},scheduler:{context:{getStore:()=>({})}}},catalog:()=>({build}),openGamePanel:async()=>{opens++;return {ok:true};},eval:async code=>vm.runInNewContext(code,{document:fake})};
 await n.tick(a,100001);assert.equal(a.nativeBotConsole.active,true);assert.equal(opens,1);
 a.registryV32.policy.nativeBotConsoleCanary=[];a.teamControl={};await n.tick(a,100002);assert.equal(a.nativeBotConsole.active,true,'rollback does not steal a team owner');delete a.teamControl;
 await n.tick(a,100003);assert.equal(a.nativeBotConsole.active,false,'flag off exits via native UI without waiting cooldown');assert.equal(opens,1,'rollback never opens settings or another panel');assert.equal(await n.tick(a,100004),null,'native exit is not repeated');
}
killSwitch().catch(e=>{console.error(e);process.exitCode=1;});
async function nativePanelAlias(){
 const {SOCIAL}=require('../src/social');let current='other',clicks=0;
 assert(html.includes('data-p="menu"')&&!html.includes('data-p="settings"'),'fixture reflects actual shipped settings button');
 const button={click:()=>{clicks++;current='menu';}},body={dataset:{get panel(){return current;}}};
 const document={querySelector:s=>s==='#menu button[data-p="menu"]'?button:null,getElementById:id=>id==='pBody'?body:id==='panel'?{hidden:false}:null};
 const open=()=>vm.runInNewContext('(async()=>{'+SOCIAL+'return await afOpenPanel("settings");})()',{document,window:{},setTimeout:fn=>fn()});
 const first=await open();assert.equal(first.ok,true);assert.equal(first.panel,'menu');assert.equal(clicks,1);
 const second=await open();assert.equal(second.already,true);assert.equal(clicks,1,'logical alias does not toggle a native panel closed');
 button.click=()=>{clicks++;current='news';};current='other';assert.equal((await open()).ok,false,'unexpected native panel never counted as opened');
 let evaluations=0;const a={actorIdentity:{actorId:'a'},registryV32:{policy:{nativeBotConsoleCanary:['a']}},status:'playing',lastSaveAt:100000,v2:{sourceCoherence:{matches:true},journal:{pending:()=>null},scheduler:{context:{getStore:()=>({})}}},catalog:()=>({build}),openGamePanel:async()=>({ok:false}),eval:async()=>{evaluations++;}};
 await n.tick(a,100001);assert.equal(a.nativeBotConsole.reason,'native_settings_panel_unavailable');assert.equal(evaluations,0);
 await n.tick(a,100002);assert.equal(evaluations,0,'failed panel opening respects bounded retry');
 console.log('PASS actual native menu/settings mapping, exact panel identity, idempotent opening and failed-open telemetry');
}
nativePanelAlias().catch(e=>{console.error(e);process.exitCode=1;});
const i={actorIdentity:{actorId:'a'},registryV32:{policy:{nativeBotConsoleCanary:['a']}},status:'playing',lastSaveAt:1000,v2:{sourceCoherence:{matches:true},journal:{pending:()=>null}}};assert(n.eligible(i,1001));assert(!n.eligible({...i,teamControl:{}},1001));assert(!n.eligible({...i,registryV32:{policy:{nativeBotConsoleCanary:['a','b']}}},1001));assert(!n.eligible(i,31001));
 const old={kind:'refine',at:1,status:'UNCERTAIN'};i.bagSessionStartedAt=500;i.v2.journal={rows:[old],pending:()=>old};assert(n.eligible(i,1001));assert.equal(old.status,'UNCERTAIN');old.at=700;assert(!n.eligible(i,1001));old.at=1;old.kind='unknown';assert(!n.eligible(i,1001));i.v2.journal={pending:()=>null};
const oldCraft={kind:'craft',at:1,status:'OBSERVED'};i.v2.journal={rows:[oldCraft],pending:()=>oldCraft};assert(n.eligible(i,1001),'historical item crafting does not block unrelated native presentation');assert.equal(oldCraft.status,'OBSERVED');oldCraft.at=700;assert.equal(n.blocker(i,1001),'current_or_unknown_payment_scope');oldCraft.at=1;oldCraft.kind='unknown';assert.equal(n.readiness(i,1001).reason,'current_or_unknown_payment_scope');i.v2.journal={pending:()=>null};
 i.socialInbox={generation:2};i.nativeBotConsole={actorId:'a',generation:1,at:1000,active:true};i.v2.observation={at:1000,nativeBotConsole:false};assert.equal(n.observedActive(i,1001),false,'closed generation does not keep native console active');i.nativeBotConsole.generation=2;i.nativeBotConsole.at=1001;assert.equal(n.observedActive(i,1002),true,'latest native button proof precedes screen refresh');i.v2.observation={at:1003,nativeBotConsole:false};assert.equal(n.observedActive(i,1004),false,'newer native screen can disprove remembered mode');
 const pressure=new ResourcePressure();i.v2.observation={nativeBotConsole:true,at:1000};i.lastFps=0;i.lastFpsAt=1000;pressure.observe(i,1001);assert.equal(i.resourceHealth.fpsApplicable,false);assert.equal(i.adaptiveTickMs,5000);
console.log('PASS native UI enter/exit idempotency, one actor/fresh owner gate and non-drawing FPS exclusion; native performance remains unmeasured');
const {controlSafe}=require('../src/learning/experiment-governor');i.v2.observation={nativeBotConsole:true,at:1000};assert(!controlSafe(i,1001),'missing control samples do not pass');i.v2.scheduler={profiler:{view:()=>({at:1000,eventLoop:{p95Ms:25},stages:[{kind:'eval',samples:[{at:1000,wallMs:40}]}]})}};assert(controlSafe(i,1001));assert(!controlSafe(i,31001),'stale console does not disable FPS guard');i.v2.scheduler.profiler.view=()=>({at:1000,eventLoop:{p95Ms:250},stages:[{kind:'eval',samples:[{at:1000,wallMs:40}]}]});assert(!controlSafe(i,1001),'bad event-loop latency aborts');
