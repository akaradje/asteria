'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const travel=require('../src/runtime/route-travel'),budget=require('../src/planning/boss-window');
const build=require('../machines/fleet-client-release.json').build,root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-native-travel-')),wiki={_source:{verifiedBuild:build},maps:{maps:[{id:'n1',levelMin:1,kind:'field',connectsTo:{next:'n2'}},{id:'n2',levelMin:20,kind:'field',connectsTo:{prev:'n1'}}]}};
let now=Date.now(),signature='a'.repeat(24);
const actor=name=>({root,page:{},credentials:{charName:name},v2:{sourceCoherence:{matches:true}},loadedSourceIdentity:()=>({build,signature,missing:[]}),livePos:{room:'n1',x:0,z:0,at:now}});
try{
 const a=actor('actor');
 for(const ms of [20000,21000,19000]){a.livePos={room:'n1',at:now};const attempt=travel.begin(a,'n2',now);assert(attempt);now+=ms;a.livePos={room:'n2',at:now};travel.finish(a,attempt,true,now);}
 let view=travel.view(a,{},now),r=view['n1>n2'];assert.equal(r.samples,3);assert.equal(r.maxMs,21000);assert.equal(r.failures,0);
 const cost=budget.travelBudget('n1','n2',wiki,view,{now});assert.equal(cost.ms,61500);assert(cost.evidence.startsWith('observed-native-route'));
 const changed=actor('actor');changed.lastSave={equip:{wing:'different'}};assert(!travel.view(changed,{},now)['n1>n2'],'changed equipped loadout cannot reuse fast-route timings');
 assert.equal(travel.view(actor('actor'),{},now)['n1>n2'].samples,3,'actual journey history survives restart');assert(!travel.view(actor('other'),{},now)['n1>n2'],'no cross-character learning');
 a.livePos={room:'n1',at:now};const bad=travel.begin(a,'n2',now);now+=5000;a.livePos={room:'town',at:now};travel.finish(a,bad,true,now);
 view=travel.view(a,{},now);assert.equal(view['n1>n2'].failures,1,'a reported success with wrong native destination is a failure');assert(budget.travelBudget('n1','n2',wiki,view,{now}).ms>=155000,'failure prevents optimistic departure budget');
 for(const patch of [{at:now-8000},{at:now+1},{dead:true},{room:'gd#1'},{room:'gh#1'}]){a.livePos={room:'n1',at:now,...patch};assert.equal(travel.begin(a,'n2',now),null);}
 a.livePos={room:'n1',at:now};assert.equal(travel.begin(a,'pv1',now),null);a.v2.sourceCoherence.matches=false;assert.equal(travel.begin(a,'n2',now),null);a.v2.sourceCoherence.matches=true;
 let attempt=travel.begin(a,'n2',now);a.page={};now+=1000;a.livePos={room:'n2',at:now};travel.finish(a,attempt,true,now);assert.equal(travel.view(a,{},now)['n1>n2'].attempts,4,'page replacement cannot certify a route');
 a.livePos={room:'n1',at:now};attempt=travel.begin(a,'n2',now);signature='b'.repeat(24);now+=1000;a.livePos={room:'n2',at:now};travel.finish(a,attempt,true,now);assert(!travel.view(a,{},now)['n1>n2'],'same-build changed source starts separate memory');assert.equal(a.nativeRouteTravel.data.history.length,1);
 signature='a'.repeat(24);assert(!travel.view(actor('actor'),{},now+3600001)['n1>n2'],'expired measurements cannot shorten budget');
 const valid={evidence:travel.EVIDENCE,build,at:now,samples:3,attempts:3,failures:0,maxMs:21000};
 for(const patch of [{at:now+1},{at:now-3600000},{build:'other'},{samples:2},{failures:1},{maxMs:NaN}])assert(budget.travelBudget('n1','n2',wiki,{'n1>n2':{...valid,...patch}},{now}).ms>=155000,'future/stale/context/insufficient/failed evidence remains conservative');
 const original=fs.readFileSync,nativeFile=path.resolve('cache',build,'asteria-online.io/asteria-online-visual-polish.html');let reads=0;
 try{fs.readFileSync=function(file,...args){if(path.resolve(String(file))===nativeFile)reads++;return original.call(fs,file,...args);};const cost=budget.makeTravelBudget(wiki,{}, {now});cost('town','n1');cost('town','n1');cost('n1','n2');assert.equal(reads,1,'one actual native source read across candidates in one decision');budget.makeTravelBudget(wiki,{}, {now})('town','n1');assert.equal(reads,2,'next decision checks actual source again');}finally{fs.readFileSync=original;}
 console.log('PASS actual navigation intervals, strict native destination, failures, restart/account/page/build/time isolation, conservative margins and one source read per decision');
}finally{fs.rmSync(root,{recursive:true,force:true});}
