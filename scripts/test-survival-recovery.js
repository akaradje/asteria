'use strict';
const assert=require('assert/strict'),work=require('../src/planning/progression-work'),survival=require('../src/runtime/survival');
const wiki={maps:{maps:[{id:'w1',kind:'field',name:'Starter',levelMin:1,levelMax:8,bossRoom:false,monsters:{normal:['leaf','bee'],miniboss:['tusk'],boss:[]},connectsTo:{next:'w2'}},{id:'w2',kind:'field',levelMin:6,levelMax:14,bossRoom:false,monsters:{normal:['wolf'],boss:[]},connectsTo:{prev:'w1',next:'w3'}},{id:'w3',kind:'field',levelMin:14,levelMax:20,bossRoom:true,monsters:{normal:['bat'],boss:['root']},connectsTo:{prev:'w2'}}]},monsters:{monsters:[{id:'leaf',name:'Leaf',kind:'normal',level:3},{id:'bee',name:'Bee',kind:'normal',level:6},{id:'wolf',kind:'normal',level:8},{id:'bat',kind:'normal',level:15},{id:'tusk',kind:'miniboss',level:6}]}};
async function main(){const now=Date.now(),i={lastSave:{lv:21,bestiary:{leaf:17,wolf:45,tusk:100},potions:20},catalog:()=>({build:'test',world:{MAX_LV:120}}),livePos:{room:'town'},brain:{data:{deaths:{w3:[now-1000]}},blocked:()=>({})}};
 const fragile={lastSaveAt:now,lastSave:{lv:21,potions:50},vitals:{at:now,hp:.45,currentHp:450,maxHp:1000},livePos:{room:'w1',at:now},goal:{monsterId:'wolf',mapId:'w1'},v2:{sourceCoherence:{matches:true}},catalog:()=>({build:'test',world:{MAX_LV:120,MONSTERS:[{id:'wolf',kind:'normal',atk:250}]}}),brain:{data:{deaths:{}},blocked:()=>({})},canDo:()=>false,expeditionAuto:async()=>{}};
 assert.equal(survival.criticalHpRatio(fragile,now),.5,'withdraw before fewer than two raw native normal hits remain');assert.equal(survival.criticalHpRatio({...fragile,vitals:{...fragile.vitals,at:now-16000}},now),.35,'stale maxHP does not fabricate a damage-derived floor');
 const survivalEconomy=require('../src/economy'),savedWiki=survivalEconomy.loadWiki;survivalEconomy.loadWiki=()=>wiki;
 try{assert.match(await survival.tick(fragile,{hp:'450 / 1000'}),/recovering HP/);assert(fragile.survivalRecovery,'new damage budget retreats at45 percent rather than waiting for old35 percent');assert.equal(fragile.goal.mapId,'town');assert.equal(fragile.survivalStatus.criticalHpRatio,.5);}finally{survivalEconomy.loadWiki=savedWiki;}
 assert.equal(work.fallback(i.lastSave,wiki,'town',{},1),null,'endgame fallback unchanged');
 let state=survival.goal(i,wiki,now);assert.equal(state.goal.mapId,'w1');assert.equal(state.goal.monsterId,'leaf');assert.equal(state.goal.monsterKind,'normal');assert.equal(state.until,now-1000+1800000);
 const row=(id,rate,travelMs=0)=>({kind:'exp',monsterKind:'normal',mapId:'w1',monsterId:id,travelMs,routeEvidence:{at:now,samples:30,ms:600000,coveragePct:100,confidence:'observational',deaths:0,expLossEvents:0,expPerHour:rate}});
 const safer=row('leaf',100),better=row('bee',500);i.v2={sourceCoherence:{matches:true},expRouteEvidence:{decorate:r=>r}};assert.equal(survival.selectRecoveryTraining(i,[safer,better],now).monsterId,'bee','within safe candidates actual whole-route EXP wins');
 i.goal=safer;assert.equal(survival.selectRecoveryTraining(i,[safer,{...better,travelMs:99999999}],now).monsterId,'leaf','safe recovery still requires travel payback');
 assert.equal(survival.selectRecoveryTraining(i,[safer,{...better,routeEvidence:{...better.routeEvidence,expLossEvents:1}}],now).monsterId,'leaf','EXP-loss route cannot defeat a safe measured route');
 let cancelled; i.v2.trial={active:()=>({phase:'treatment',candidateGoal:{...better,mapId:'blocked'}}),finish:(status,reason)=>{cancelled={status,reason};},view:()=>({version:0})};
 assert.equal(survival.selectRecoveryTraining(i,[safer],now).monsterId,'leaf','a retained trial cannot reintroduce a route excluded by recovery safety');assert.equal(cancelled.status,'safety_abort');
 delete i.v2;i.goal=null;
 assert.equal(work.recoveryFallback({...i.lastSave,bestiary:{}},wiki,'town',{},9),null,'requires personal kill proof');
 assert.equal(work.recoveryFallback(i.lastSave,wiki,'town',{w1:{}},9),null,'never returns to blocked map');
 assert.equal(work.recoveryFallback(i.lastSave,wiki,'town',{},2),null,'level margin retained');
 assert.equal(work.recoveryFallback({...i.lastSave,lv:120},wiki,'town',{},100),null,'cannot loosen capped safety');
 i.lastSave.bestiary.bee=2;assert.equal(survival.goal(i,wiki,now).goal.monsterId,'bee');
 i.brain.data.deaths.w1=[now-1];assert.equal(survival.goal(i,wiki,now).goal.mapId,'town','starter death stays in town');delete i.brain.data.deaths.w1;
 const oldDeaths=i.brain.data.deaths,oldLevel=i.lastSave.lv,oldCatalog=i.catalog;
 wiki.maps.maps.push({id:'d3',kind:'dungeon',levelMin:90,levelMax:99,bossRoom:false});i.catalog=()=>({build:'test',world:{MAX_LV:120,MAPS:[{id:'d3',kind:'dungeon'}]}});i.lastSave.lv=99;i.brain.data.deaths={d3:[now-1000]};
 const abyss=survival.goal(i,wiki,now);assert.equal(abyss.deaths[0].map,'d3');assert.equal(abyss.goal.kind,'survival');assert.notEqual(abyss.goal.mapId,'d3','Abyss death creates a safe recovery goal rather than leaving AUTO globally disabled without a recovery plan');
 i.brain.data.deaths={'dx#1':[now-1000],'tw#1':[now-1000],'gd#1':[now-1000],'pv#1':[now-1000]};assert.equal(survival.goal(i,wiki,now),null,'quota/arena death must not poison later normal-field AUTO');assert.deepEqual(survival.recentDeaths(i,now),[]);
 i.brain.data.deaths={unreviewed:[now-1000]};assert.equal(survival.goal(i,wiki,now).goal.mapId,'town','unknown death map remains conservatively held');
 wiki.maps.maps.pop();i.brain.data.deaths=oldDeaths;i.lastSave.lv=oldLevel;i.catalog=oldCatalog;
 const economy=require('../src/economy'),original=economy.loadWiki;economy.loadWiki=()=>wiki;let auto=[];
 try{i.lastSaveAt=now;i.expeditionAuto=async x=>auto.push(x);i.canDo=()=>false;const out=await survival.tick(i,{hp:'20 / 100',panelOpen:false});assert.match(out,/recovering HP/);assert.equal(i.goal.mapId,'town');assert.deepEqual(auto,[false],'critical HP never starts recovery farm');
  i.survivalRecovery=false;auto.length=0;assert.match(await survival.tick(i,{hp:'78 / 100',panelOpen:false}),/recovering HP/);assert.equal(i.survivalRecovery,true,'town recovery entry below 85 percent must not wait indefinitely for passive regeneration');assert.deepEqual(auto,[false]);
  i.livePos.at=Date.now();i.lastSaveAt=Date.now();i.lastSave.autoOpt={potPct:70,ph:false};i.potPct=70;let configured=[];i.configureAutomation=async p=>configured.push(p||{});i.canDo=()=>true;
  assert.match(await survival.tick(i,{hp:'20 / 100',panelOpen:false}),/native town potion/);assert.deepEqual(configured,[{recovery:true}]);assert(i.recoveryPotionSettings);
  i.lastSave.autoOpt={potPct:90,ph:true};assert.match(await survival.tick(i,{hp:'90 / 100',panelOpen:false}),/waiting for native field/);assert.deepEqual(configured,[{recovery:true},{}]);assert(i.survivalRecovery,'do not leave on settings click alone');
  i.canDo=()=>false;const n=configured.length;await survival.tick(i,{hp:'90 / 100',panelOpen:false});assert.equal(configured.length,n,'restoration does not flood native settings');
  i.lastSave.autoOpt={potPct:70,ph:true};await survival.tick(i,{hp:'90 / 100',panelOpen:false});assert.equal(i.survivalRecovery,false);assert.equal(i.recoveryPotionSettings,false);
  i.survivalRecovery=true;i.lastSave.autoOpt={potPct:70,ph:false};i.v2={sourceCoherence:{matches:false}};i.canDo=()=>true;await survival.tick(i,{hp:'20 / 100',panelOpen:false});assert.equal(configured.length,n,'mismatched source cannot configure recovery');
 }
 finally{economy.loadWiki=original;}
 {
  const root=process.cwd(),cat=economy.loadCatalog(root,JSON.parse(require('fs').readFileSync('machines/fleet-client-release.json')).build),now=Date.now();let bought,closed=0,auto=[];
  const actor={root,lastSave:{lv:112,job:'asura',coins:4498,potions:0,autoOpt:{ph:false,potPct:70}},lastSaveAt:now,livePos:{room:'town',at:now},vitals:{at:now,hp:.2,maxHp:1000},catalog:()=>cat,brain:{data:{deaths:{}},blocked:()=>({})},v2:{sourceCoherence:{matches:true},journal:{pending:()=>false},reservations:{totals:()=>({Copper:2100})}},canDo:()=>true,expeditionAuto:async x=>auto.push(x),restockPotions:async(...args)=>{bought=args;return {ok:true,status:'CONFIRMED'};},closeGamePanel:async()=>closed++};
  economy.loadWiki=()=>wiki;
  try{
   assert.match(await survival.tick(actor,{hp:'20 / 100',panelOpen:false}),/withdrawn town refill/,'low HP and empty stock reach native refill before waiting for impossible potion healing');
   assert.equal(bought[1],10);assert.equal(bought[2].reserveCoins,3100,'actual2100 held plus1000 essential reserve remain protected');assert.equal(bought[2].essential,true);assert.equal(closed,1);assert.equal(actor.goal.mapId,'town');assert.deepEqual(auto,[false],'refill cannot enable field AUTO');
   bought=null;actor.v2.sourceCoherence.matches=false;await survival.tick(actor,{hp:'20 / 100',panelOpen:false});assert.equal(bought,null,'unreviewed source cannot buy during recovery');
   actor.v2.sourceCoherence.matches=true;actor.lastSave.coins=3100;await survival.tick(actor,{hp:'20 / 100',panelOpen:false});assert.equal(bought,null,'withdrawn refill cannot spend held or essential reserve');
  }finally{economy.loadWiki=original;}
 }
 {
  const development=require('../src/runtime/development-progress'),savedTick=development.tick,savedOpportunity=development.refineOpportunity,originalWiki=economy.loadWiki;
  let walks=0,commands=[];
  const actor={lastSave:{lv:21,potions:10,bestiary:{leaf:17},autoOpt:{potPct:70,heal:true,basic:true}},lastSaveAt:Date.now(),vitals:{at:Date.now(),hp:1,maxHp:1000},livePos:{room:'town',at:Date.now()},v2:{sourceCoherence:{matches:true}},catalog:()=>({build:'test',world:{MAX_LV:120}}),brain:{data:{deaths:{w3:[Date.now()-1000]}},blocked:()=>({})},autoChores:true,canDo:k=>k==='survivalRoute',expeditionAuto:async v=>commands.push(v),chainWalkTo:async()=>{walks++;return true;}};
  economy.loadWiki=()=>wiki;development.tick=async()=>null;development.refineOpportunity=()=>({prepareBoss:true});
  try{
   assert.match(await survival.tick(actor,{hp:'100 / 100',panelOpen:false},{supply:null}),/safe farming route w1/,'an idle refine cooldown does not strand a supplied actor in town');
   assert.equal(walks,1);assert.equal(actor.pendingTravel.mapId,'w1');assert(actor.survivalStatus.equipmentPreparationDeferred);assert(commands.length>0&&commands.every(v=>v===false),'only safe travel; no paid/refine or field AUTO request');
   actor.pendingTravel=null;actor.developmentLedger={rows:[{status:'unresolved'}],blocking:()=>true};
   assert.match(await survival.tick(actor,{hp:'100 / 100',panelOpen:false},{supply:null}),/payment outcome/);assert.equal(walks,1,'unresolved upgrade payment retains navigation protection');
   delete actor.developmentLedger;actor.vitals.at=Date.now()-16000;
   assert.match(await survival.tick(actor,{hp:'100 / 100',panelOpen:false},{supply:null}),/fresh HP/);assert.equal(walks,1,'stale native HP cannot grant fallback navigation');
   actor.vitals.at=Date.now();development.tick=async()=> 'equipment readiness: awaiting_outcome';
   assert.match(await survival.tick(actor,{hp:'100 / 100',panelOpen:false},{supply:null}),/awaiting_outcome/);assert.equal(walks,1,'a dispatched upgrade still owns the action');
  }finally{development.tick=savedTick;development.refineOpportunity=savedOpportunity;economy.loadWiki=originalWiki;}
 }
 console.log('PASS proven starter normal recovery, death/level/route/HP gates, idle upgrade cooldown yield and unchanged endgame fallback');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
