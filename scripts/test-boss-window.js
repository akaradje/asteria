'use strict';
const assert=require('assert/strict'),p=require('../src/planning/boss-window'),campaign=require('../src/planning/capped-campaign');
const now=1000000,wiki={maps:{maps:[{id:'n1',kind:'field',levelMin:1,monsters:{normal:['normal']},connectsTo:{next:'n2'}},{id:'n2',kind:'field',levelMin:1,monsters:{normal:['normal']},connectsTo:{prev:'n1'}}]},monsters:{monsters:[{id:'normal',name:'Normal',level:1,kind:'normal',dropTable:[{item:'Feather',ratePct:50}]}]}};
const boss={monsterId:'boss',monster:'Boss',monsterKind:'boss',mapId:'n2',material:'Core',alive:false,nextAt:now+2000000};
const input={now,wiki,save:{lv:120,mapId:'n1',materials:{},bestiary:{}},room:'n1',missing:[{name:'Feather',have:0,want:10}],hunt:{boardFresh:true,sources:[boss]}};
let s=p.schedule(input);assert.equal(s.phase,'side-work');assert.equal(s.goal.mapId,'n1');assert.equal(s.goal.material,'Feather');assert.equal(s.departAt,boss.nextAt-90000-p.travelBudget('n1','n2',wiki).ms);
s=p.schedule({...input,now:s.departAt});assert.equal(s.phase,'return-to-boss','leave includes return travel, not just 90 seconds');
s=p.schedule({...input,room:'n2',now:boss.nextAt-90000});assert.equal(s.phase,'preposition');assert.equal(s.goal.kind,'campaign-wait');
s=p.schedule({...input,hunt:{boardFresh:false,sources:[boss]}});assert.equal(s.goal.mapId,'n1');assert.equal(s.spawnAt,null,'no deadline from stale board');
s=p.schedule({...input,hunt:{boardFresh:true,sources:[{...boss,alive:true,nextAt:null}]}});assert.equal(s.phase,'boss-live','live server boss preempts side work');
 s=p.schedule({...input,hunt:{boardFresh:true,sources:[{...boss,alive:true,nextAt:null,combatEligible:false,routeEligible:true,plannedSupport:true,combatBlock:'must-arrive-with-nearby-support'}]}});assert.equal(s.phase,'boss-live');assert(s.bossObservation.plannedSupport);assert.equal(s.bossObservation.combatEligible,false,'meeting route does not become combat permission in dashboard evidence');
s=p.schedule({...input,hunt:{boardFresh:true,sources:[{...boss,nextAt:now+330000}]}});assert.equal(s.phase,'return-to-boss','short gap does not authorize detour');
assert.equal(p.travelBudget('n1','unknown',wiki).ms,Infinity);assert.equal(p.sideSources(input.save,wiki,input.missing,{n1:true,n2:true}).length,0);
const townWork=p.schedule({...input,room:'town',hunt:{boardFresh:false,sources:[]}});assert.equal(townWork.phase,'side-work');assert.equal(townWork.goal.mapId,'n1','unknown boss schedule permits only a direct safe town gate, not a long detour');
assert.equal(p.schedule({...input,room:'town',blocked:{n1:true},hunt:{boardFresh:false,sources:[]}}).goal,null,'do not route through a blocked gate to a distant side job');
const old=p.schedule(input);s=p.schedule({...input,previous:old,now:now+10000});assert.equal(s.assignedAt,old.assignedAt);
s=p.schedule({...input,previous:old,now:now+10000,hunt:{boardFresh:true,sources:[{...boss,nextAt:now+330000}]}});assert.equal(s.phase,'return-to-boss','server moved spawn earlier overrides retained assignment');
const delayedBoard={_receivedAt:now,now:now-5000,list:[{id:'boss',map:'n2',up:false,next:now+100000}]};
const hunt=campaign.chooseHunt({phase:'class',missing:[{name:'Core',have:0,want:1}]},input.save,{...wiki,monsters:{monsters:[{id:'boss',name:'Boss',kind:'boss',level:1,dropTable:[{item:'Core',ratePct:100}],maps:['n2']}]},maps:{maps:wiki.maps.maps.map(m=>({...m,monsters:{normal:[],boss:m.id==='n2'?['boss']:[]}}))}},delayedBoard,now+20000);
assert.equal(hunt.next.nextAt,now+105000,'clock translation stays anchored to receipt, does not drift on every tick');
console.log('PASS boss windows: useful material work, conservative travel, 90s arrival, early spawn preemption, stale board, blocked maps, assignment retention, stable server time');

const fs=require('fs'),path=require('path'),os=require('os'),root=process.cwd(),build=JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build,liveWiki=require('../src/economy').loadWiki(root);
assert.equal(p.travelBudget('town','c1',liveWiki).ms,155000,'native skyGate is one town hop, not nine historical graph hops');
assert.equal(p.travelBudget('d3','c1',liveWiki).ms,310000,'return home plus the actual skyGate');
assert.equal(p.travelBudget('town','c2',liveWiki).ms,310000);
assert.equal(p.travelBudget('town','r1',liveWiki).ms,155000);
assert.equal(p.travelBudget('r1','d4',liveWiki).ms,465000,'native r1 has no previous d4 gate; must return home and use c1');
const nativeGraph=require('../src/runtime/native-gates').graphForBuild(root,build,liveWiki.maps.maps);
assert.equal(nativeGraph.links.r1.prev,null);assert.equal(nativeGraph.links.d4.next,'c1');
assert.deepEqual(require('../src/planning/gate-route').route('r1','d4',liveWiki,nativeGraph),['town','c1','d4'],'wrong Wiki edges cannot override loaded native links');
assert.equal(p.travelBudget('town','c1',liveWiki,{}, {build:'missing-build'}).ms,Infinity,'no fallback from missing pinned native source');
const cat=require('../src/economy').loadCatalog(root,build),newRows=require('../src/planning/level-training').candidates({lv:110,mapId:'d3',bestiary:{}},liveWiki,cat,{maxTravelMs:620000});
assert(newRows.some(g=>g.mapId==='c1'&&g.travelMs===310000),'new native fields must survive the travel filter');
assert(!newRows.some(g=>g.mapId==='c4'),'boss-room safety stays intact');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-route-gate-'));
try{
 const dir=path.join(temp,'cache/fixture/asteria-online.io');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'asteria-online-visual-polish.html');
 const futureWiki={_source:{verifiedBuild:'fixture'},maps:{maps:[{id:'future',levelMin:1},{id:'c1',levelMin:100}]}};
 fs.writeFileSync(file,"const TOWN={cx:160,cz:0};\n{id:'newGate',kind:'worldMap',targetMap:'future',x:TOWN.cx+1,z:2}");
 assert.equal(p.travelBudget('town','future',futureWiki,{}, {root:temp}).ms,155000,'discover future native gates without another hardcoded list');
 assert.equal(p.travelBudget('town','c1',futureWiki,{}, {root:temp}).ms,Infinity,'removed native gate is not guessed');
 fs.writeFileSync(file,"const TOWN={cx:160,cz:0};\n{id:'newGate',kind:'worldMap',targetMap:'future',x:unknown(),z:2}");
 assert.equal(p.travelBudget('town','future',futureWiki,{}, {root:temp}).ms,Infinity,'changed unparsed gate must fail closed');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('PASS native gate regression: sky/relic direct routes, eligible high-level fields, missing/removed/unknown gates and future gate discovery');
{
 const exp=(mapId,rate)=>({kind:'exp',monsterKind:'normal',monsterId:mapId,mapId,priority:1,score:1700,reason:'measured',farmEvidence:{confidence:'observational',at:now,samples:12,minutes:10,expPerHour:rate,deaths:0}});
 const select=extraCandidates=>p.schedule({...input,hunt:{boardFresh:true,sources:[boss]},sideSourcesAllowed:false,extraCandidates});
 assert.equal(select([exp('n1',100),exp('n2',1000)]).goal.mapId,'n2','large measured EXP gain beats arbitrary same-map score bonus');
 assert.equal(select([exp('n1',100),exp('n2',120)]).goal.mapId,'n1','small gain does not repay the actual transfer');
 const measured=p.workValue({goal:exp('n2',1000),out:{ms:155000},workMs:200000},now);assert.equal(measured.expectedExp,1000*200000/3600000);assert(measured.estimate);
 assert.equal(p.workValue({goal:{...exp('n1',1000),farmEvidence:{...exp('n1',1000).farmEvidence,at:now+1}},out:{ms:0},workMs:Infinity},now),null,'future yield cannot rank a transfer');
 const urgent={kind:'campaign-side',monsterKind:'normal',monsterId:'normal',mapId:'n1',priority:0,score:1,reason:'primary material'};assert.equal(select([urgent,exp('n2',10000)]).goal,urgent,'material objective priority preserved');
}
