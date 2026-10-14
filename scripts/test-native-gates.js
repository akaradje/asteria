'use strict';
const assert=require('assert'),fs=require('fs'),{parse}=require('../src/runtime/native-gates');
const source=fs.readFileSync('cache/5391707/asteria-online.io/asteria-online-visual-polish.html','utf8'),maps=JSON.parse(fs.readFileSync('data/wiki.json')).maps.maps,gates=parse(source,maps);
assert.strictEqual(gates.w1.x,93.5);assert.strictEqual(gates.s1.z,51.5);assert.strictEqual(gates.e1.x,226.5);assert.strictEqual(gates.n1.z,-52.5);assert(gates.r1&&gates.c1);assert.strictEqual(Object.keys(gates).length,7);
assert.strictEqual(parse(source.replace('TOWN.cx - 66.5','TOWN.cx - 70'),maps).w1.x,90);
assert.deepEqual(parse(source.replace('TOWN.cx - 66.5','unknownGate()'),maps),{});assert.deepEqual(parse('missing source',maps),{});
assert(!parse(source,maps.filter(m=>m.id!=='w1')).w1);
const instance=fs.readFileSync('src/instance.js','utf8');assert(!instance.includes('x: 115.5'));assert(instance.includes('observed.loadedRoutes(this.root,identity.build,identity)'));
console.log('native-gates PASS: current7 gates, source coordinate change, unknown expression fail-closed, missing map not guessed');
const os=require('os'),path=require('path'),native=require('../src/runtime/native-gates'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-gate-content-'));
const realStat=fs.statSync;
try{
 const dir=path.join(temp,'cache/fixture/asteria-online.io');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'asteria-online-visual-polish.html');
 const valid="const TOWN={cx:0,cz:0};\n{id:'gate',kind:'worldMap',targetMap:'n1',x:1,z:2}";
 fs.statSync=function(target,...args){if(target===file)return {mtimeNs:1n,ctimeNs:1n,size:BigInt(valid.length)};return realStat.call(fs,target,...args);};
 fs.writeFileSync(file,valid);assert(native.forBuild(temp,'fixture',[{id:'n1',levelMin:1}]).n1);
 fs.writeFileSync(file,valid.replace('x:1','x:q'));assert.deepEqual(native.forBuild(temp,'fixture',[{id:'n1',levelMin:1}]),{},'same metadata and length cannot retain changed unsafe gate');
}finally{fs.statSync=realStat;fs.rmSync(temp,{recursive:true,force:true});}
console.log('native-gates PASS: identical metadata/content replacement invalidates route cache');
(async()=>{
 const loaded=require('../src/runtime/observed-routes'),walk=require('../src/runtime/gate-walk'),{GameInstance}=require('../src/instance');
 const build=JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build,wiki=require('../src/economy').loadWiki(process.cwd()),graph=native.graphForBuild(process.cwd(),build,wiki.maps.maps);
 assert.deepEqual(require('../src/planning/gate-route').route('r1','d4',wiki,graph),['town','c1','d4']);
 const html=fs.readFileSync(path.join('cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
 assert.deepEqual(native.parseGraph(html.replace("r1:{prev:null,next:'r2'}","r1:{prev:unknown(),next:'r2'}"),wiki.maps.maps).links,{},'unknown expression cannot leave a partly trusted field graph');
 assert.deepEqual(native.parseGraph(html.replace('Object.assign(MAP_LINKS, R_MAP_LINKS)','Object.assign(MAP_LINKS, UNKNOWN)'),wiki.maps.maps).links,{},'unapplied extension cannot become a gate');
 const oldLoad=loaded.loadedRoutes,oldCross=walk.cross;let auto=0,arrived=0,calls=[];
 const actor=()=>({root:process.cwd(),v2:{loadedSourceIdentity:{build},sourceCoherence:{matches:true}},livePos:{room:'r1',at:Date.now()},log:()=>{},brain:{arrived:()=>arrived++},enableAuto:async()=>auto++});
 try{
  loaded.loadedRoutes=()=>graph;
  walk.cross=async(a,g,opts)=>{calls.push({to:opts.to,x:g.x,z:g.z});a.livePos={room:opts.to,at:Date.now()};return {ok:true};};
  assert.equal(await GameInstance.prototype.chainWalkTo.call(actor(),'d4'),true);
  assert.deepEqual(calls,[{to:'town',x:0,z:40},{to:'c1',x:108,z:28},{to:'d4',x:-38,z:-2}]);assert.equal(auto,1);assert.equal(arrived,1);
  calls=[];walk.cross=async(a,g,opts)=>{calls.push(opts.to);return {ok:true};};
  assert.equal(await GameInstance.prototype.chainWalkTo.call(actor(),'d4'),false,'method success without destination is not arrival');assert.equal(calls.length,1);assert.equal(auto,1);
  const stale=actor();stale.livePos.at=Date.now()-9000;assert.equal(await GameInstance.prototype.chainWalkTo.call(stale,'d4'),false);assert.equal(calls.length,1,'stale origin sends no walking input');
  walk.cross=async(a,g,opts)=>{a.livePos={room:opts.to,at:Date.now()};a.v2.loadedSourceIdentity={build};return {ok:true};};
  assert.equal(await GameInstance.prototype.chainWalkTo.call(actor(),'d4'),false,'page generation change aborts remaining hops');assert.equal(auto,1);
  const transit=require('../src/runtime/assistance-transit'),oldHealth=transit.check;transit.check=async()=>true;const reservations=require('../src/runtime/assistance-reservation'),originalState=reservations.state;try{let valid=true,waiting=false;reservations.state=()=>valid?{assignment:{key:'group'},waiting}:null;const grouped=actor();grouped.assistanceReservation={assignment:{key:'group'}};calls=[];walk.cross=async(a,g,opts)=>{calls.push(opts.to);a.livePos={room:opts.to,at:Date.now()};valid=false;return {ok:true};};assert.equal(await GameInstance.prototype.chainWalkTo.call(grouped,'d4'),false);assert.deepEqual(calls,['town'],'released class ownership stops remaining gates');assert.equal(auto,1);
   valid=true;waiting=true;const waitingActor=actor();waitingActor.livePos.room='c1';waitingActor.assistanceReservation={assignment:{key:'group'}};calls=[];assert.equal(await GameInstance.prototype.chainWalkTo.call(waitingActor,'d4'),false);assert.equal(calls.length,0,'missing group evidence cannot cross final boss gate');
   valid=false;const releasedBeforeCall=actor();calls=[];assert.equal(await GameInstance.prototype.chainWalkTo.call(releasedBeforeCall,'d4',{assistanceKey:'group'}),false);assert.equal(calls.length,0,'caller retains expected ownership across asynchronous AUTO stop even if reservation disappeared before walking');
   releasedBeforeCall.assistanceReservation={assignment:{key:'group'}};releasedBeforeCall.expeditionAuto=async()=>{delete releasedBeforeCall.assistanceReservation;};releasedBeforeCall.chainWalkTo=(...args)=>GameInstance.prototype.chainWalkTo.apply(releasedBeforeCall,args);assert.match(await require('../src/runtime/campaign-route').travel(releasedBeforeCall,{kind:'milestone-assist',key:'group',mapId:'d4'}),/unconfirmed/);assert.equal(calls.length,0,'actual route adapter propagates key across owner disappearance');assert.equal(releasedBeforeCall.pendingTravel,null);
  }finally{reservations.state=originalState;transit.check=oldHealth;}
 }finally{loaded.loadedRoutes=oldLoad;walk.cross=oldCross;}
 console.log('native-gates PASS: actual VPS chain home/c1/d4, fake Wiki ignored, unknown syntax/stale origin/unconfirmed arrival/page changes rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
