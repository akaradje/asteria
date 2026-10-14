'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const map=require('../src/runtime/town-map-walk'),{cross}=require('../src/runtime/gate-walk'),loaded=require('../src/knowledge/loaded-source');
const root=path.resolve(__dirname,'..'),build=require('../machines/fleet-client-release.json').build,dir=path.join(root,'cache',build),source=fs.readFileSync(path.join(dir,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
function actor(room='n1'){
 const a={root,cache:{dir},loadedSourceIdentity:()=>loaded.capture(root,build),livePos:{room,x:-24,z:-8,at:Date.now()},keys:0,async expeditionAuto(){},async walkTo(){this.keys++;return {ok:false};}};
 const screen={hidden:true,classList:{contains:()=>room!=='town'}},rect={left:10,top:20,width:600,height:600},elements={};let nativeHandler;
 const handlerStart=source.indexOf("$('townMapCanvas').addEventListener('pointerdown'");
 const handlerEnd=source.indexOf("$('minimap').addEventListener('pointerdown'",handlerStart);
 const g=map.parseField(source);
 vm.runInNewContext(source.slice(handlerStart,handlerEnd),{$:()=>({addEventListener:(_,h)=>{nativeHandler=h;}}),clamp:(v,a,b)=>Math.max(a,Math.min(v,b)),inTown:false,bigMapTown:false,FIELD:g,FIELD_MAP:{x:g.cx,z:g.cz,span:g.span},goTo:(x,z,manual)=>{assert(manual);a.clicked={x,z};a.livePos={room:'town',x:160,z:0,at:Date.now()};},closeTownMap:()=>{screen.hidden=true;}});
 elements.minimap={getBoundingClientRect:()=>rect,dispatchEvent:()=>{screen.hidden=false;}};
 elements.townMapScreen=screen;
 elements.townMapCanvas={getBoundingClientRect:()=>rect,dispatchEvent:e=>nativeHandler({...e,currentTarget:elements.townMapCanvas,preventDefault(){},stopPropagation(){}})};
 elements.townMapClose={click:()=>{screen.hidden=true;}};
 a.eval=async code=>vm.runInNewContext(code,{document:{getElementById:id=>elements[id]},PointerEvent:class{constructor(_,p){Object.assign(this,p);}}});return a;
}
(async()=>{
 const g=map.parseField(source),p=map.point(g,0,40);assert(g&&p);assert.equal(g.span,113);
 const noIo=actor();noIo.loadedSourceIdentity=()=>assert.fail('ordinary field mismatch guard must not inspect/read cached game bytes');assert.equal(map.inconsistentTown(noIo),false);noIo.livePos.room='town';noIo.livePos.at=Date.now()-7000;assert.equal(map.inconsistentTown(noIo),false,'stale town observation also skips geometry work');
 assert.equal(map.parseField(source.replace('FIELD_MAP.x+(u-.5)*FIELD_MAP.span','differentMapper')),null);
 const a=actor();assert.equal((await cross(a,{x:0,z:40},{from:'n1',to:'town',timeoutMs:1000})).reason,'native-field-gate-confirmed');assert(Math.abs(a.clicked.x)<1e-8&&Math.abs(a.clicked.z-40)<1e-8);assert.equal(a.keys,0,'actual native field input owns collision-aware walk');
 const original=map.walk;try{
  map.walk=async(a)=>{a.livePos={room:'s1',at:Date.now()};return {ok:false,reason:'left-field'};};const wrong=actor();assert.equal((await cross(wrong,{x:0,z:40},{from:'n1',to:'town'})).ok,false);assert.equal(wrong.keys,0);
  map.walk=async(a)=>{a.livePos={room:'town',at:Date.now()-9000};return {ok:false,reason:'left-field'};};assert.equal((await cross(actor(),{x:0,z:40},{from:'n1',to:'town'})).ok,false);
  map.walk=async()=>({ok:false,reason:'native-field-map-arrival-unconfirmed'});const stalled=actor();assert.equal((await cross(stalled,{x:0,z:40},{from:'n1',to:'town'})).reason,'native-field-gate-unconfirmed');assert.equal(stalled.keys,0,'no keyboard overwrite after sent native timeout');
 }finally{map.walk=original;}
 for(const room of ['tw1','gd#1','pv1','gh#1'])assert.equal(await map.walk(actor(room),0,40,{room}),null,'protected activity room excluded');
 const stale=actor();stale.livePos.at=Date.now()-11000;assert.equal(await map.walk(stale,0,40,{room:'n1'}),null);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-field-map-')),td=path.join(temp,'cache',build,'asteria-online.io');
 try{fs.mkdirSync(td,{recursive:true});for(const f of ['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js'])fs.copyFileSync(path.join(dir,'asteria-online.io',f),path.join(td,f));const old=loaded.capture(temp,build),changed=actor();changed.root=temp;changed.cache={dir:path.dirname(td)};changed.loadedSourceIdentity=()=>old;changed.livePos={room:'town',x:33,z:-37,at:Date.now()};assert(map.inconsistentTown(changed),'populate parsed geometry cache before changing source');fs.appendFileSync(path.join(td,'asteria-online-visual-polish.html'),'\nchanged');assert.equal(map.inconsistentTown(changed),false,'cached geometry never conceals a same-build source change');changed.livePos={room:'n1',x:0,z:0,at:Date.now()};assert.equal(await map.walk(changed,0,40,{room:'n1'}),null,'same-build disk change cannot authorize old page geometry');}finally{fs.rmSync(temp,{recursive:true,force:true});}
 console.log('PASS actual native field map pointer transform, exact fresh gate destination, protected/stale/source mismatch exclusion and no keyboard replay after dispatched timeout');
 const realNow=Date.now,expired=require('../src/runtime/capped-campaign').routeExpired;let clock=realNow(),step=0,reads=0;
 try{
  Date.now=()=>clock;require('../src/runtime/capped-campaign').routeExpired=async()=>false;
  const moving=actor();moving.livePos={room:'n1',x:0,z:0,at:clock,mv:1};moving.eval=async()=>{reads++;return true;};moving.v2={scheduler:{checkpoint(){clock+=2000;moving.livePos={room:'n1',x:++step,z:0,at:clock,mv:1};}}};
  assert((await map.walk(moving,4,0,{room:'n1',timeoutMs:20000,tolerance:.1})).ok);assert.equal(reads,1,'fresh native motion requires no repeated news DOM RPCs');
  const stationary=actor();let replans=0;stationary.livePos={room:'n1',x:0,z:0,at:clock,mv:0};
  stationary.eval=async code=>{if(code.includes("getElementById('minimap')")){replans++;return true;}return false;};
  stationary.v2={scheduler:{checkpoint(){clock+=2000;stationary.livePos.at=clock;}}};
  assert.equal((await map.walk(stationary,4,0,{room:'n1',timeoutMs:40000,tolerance:.1})).reason,'native-field-map-stalled');
  assert.equal(replans,2,'one first command and only one replan after fresh stationary evidence');assert.equal(stationary.keys,0);
  require('../src/runtime/capped-campaign').routeExpired=async()=>true;const due=actor();due.eval=async()=>true;
  assert.equal((await cross(due,{x:0,z:40},{from:'n1',to:'town'})).reason,'campaign-deadline');assert.equal(due.keys,0,'expired native map path sends no second keyboard walker');
 }finally{Date.now=realNow;require('../src/runtime/capped-campaign').routeExpired=expired;}
 console.log('PASS movement-driven news checks and native map campaign deadline without keyboard replay');
 const recovery=require('../src/runtime/town-position-recovery'),rr=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-town-position-')),nativeNow=Date.now;let clockAt=nativeNow(),uses=0;
 try{
  const instanceSource=fs.readFileSync(path.join(root,'src/instance.js'),'utf8'),requestAt=instanceSource.indexOf("    this.page.on('request', r => {"),requestEnd=instanceSource.indexOf("    this.page.on('pageerror'",requestAt);let requestHandler;
  assert(requestAt>=0&&requestEnd>requestAt);const receiver={page:{on:(event,handler)=>{assert.equal(event,'request');requestHandler=handler;}}};
  vm.runInNewContext('(function(){'+instanceSource.slice(requestAt,requestEnd)+'}).call(receiver)',{receiver,loadPage:receiver.page,saveRequests:new Map(),api:{BASE:'https://asteria-online.io'},URL,Date,path,require:p=>p==='./observability/save-receipt'?{capture:()=>({})}:(()=>{throw Error('fixture stops after native save projection');})()});
  for(const value of [true,false,undefined,'true']){requestHandler({url:()=>'https://asteria-online.io/api/save',headers:()=>({}),method:()=>'PUT',postData:()=>JSON.stringify({inTown:value})});assert.equal(receiver.lastSave.inTown,typeof value==='boolean'?value:undefined,'actual PUT save receiver preserves only original boolean town evidence');}
  Date.now=()=>clockAt;const rd=path.join(rr,'cache',build,'asteria-online.io');fs.mkdirSync(rd,{recursive:true});for(const f of ['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js'])fs.copyFileSync(path.join(dir,'asteria-online.io',f),path.join(rd,f));
  const r={root:rr,cache:{dir:path.dirname(rd)},loadedSourceIdentity:()=>loaded.capture(rr,build),catalog:()=>({build}),status:'playing',character:{name:'RecoveryFixture'},v2:{sourceCoherence:{matches:true}},lastSaveAt:clockAt,lastSave:{inTown:true,consumables:{'Butterfly Wing':3}},livePos:{room:'town',x:33,z:-37,at:clockAt},canDo:()=>true,expeditionAuto:async()=>{},openGamePanel:async name=>{assert.equal(name,'bag');return {ok:true};},closeGamePanel:async()=>{},eval:async code=>{assert(code.includes("c:Butterfly Wing"));assert(code.includes('use.click()'));uses++;return true;}};
  assert(map.inconsistentTown(r));assert.match(await recovery.tick(r,{}),/second native observation/);assert.equal(uses,0,'one possibly transitional frame cannot consume a wing');
  clockAt+=3000;r.lastSaveAt=r.livePos.at=clockAt;r.pendingTravel={mapId:'n2'};assert.match(await recovery.tick(r,{}),/WAITING_CONFIRMATION/);assert.equal(uses,1);assert.equal(r.pendingTravel,null);
  clockAt+=3000;r.lastSaveAt=r.livePos.at=clockAt;assert.match(await recovery.tick({...r,townPositionMismatch:null},{}),/no repeated use/);assert.equal(uses,1,'durable unknown receipt survives actor restart without consuming again');
  r.livePos.x=160;r.livePos.z=7;assert.match(await recovery.tick(r,{}),/no repeated use/);assert.equal(uses,1,'position alone is not an item receipt');
  r.lastSave.consumables['Butterfly Wing']=2;assert.match(await recovery.tick(r,{}),/count confirmed/);assert.equal(r.townPositionRecovery.status,'CONFIRMED');assert.equal(await recovery.tick(r,{}),null);
  r.livePos.z=56;assert(!map.inconsistentTown(r),'valid town pier is not the disjoint field rectangle');r.livePos.x=33;r.livePos.z=-37;
  for(const patch of [{teamControl:true},{assistanceReservation:{}},{teamTradeStatus:{phase:'OPEN'}},{v2:{sourceCoherence:{matches:false}}},{lastSaveAt:clockAt-31000}])assert.equal(await recovery.tick({...r,...patch},{}),null,'protected/stale/mismatched facts cannot authorize a repair');
  const empty={...r,character:{name:'EmptyWing'},lastSave:{inTown:true,consumables:{}},townPositionMismatch:{positionAt:clockAt-3000,saveAt:clockAt-3000,at:clockAt-3000}};assert.match(await recovery.tick(empty,{}),/no owned return wing/);assert.equal(uses,1);
  console.log('PASS loaded spatial mismatch, two original observations, owned native wing UI, durable no replay, exact later position/count confirmation and protected/stale/pier exclusions');
 }finally{Date.now=nativeNow;fs.rmSync(rr,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
