'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const training=require('../src/planning/level-training'),runtime=require('../src/runtime/level-training'),{LevelProgress,delta}=require('../src/observability/level-progress');
async function main(){
 const vm=require('vm'),targetRuntime=require('../src/runtime/main-quest');
 const picker=({missing=false,broken=false}={})=>{let open=false,selected=new Set(['elite','old_other_map']),clicks=[];const buttons=['all','elite',...(missing?[]:['normal'])].map(id=>({dataset:{huntTarget:id},disabled:false,getAttribute:()=>String(id==='all'?selected.size===0:selected.has(id)),click(){clicks.push(id);if(broken)return;if(id==='all')selected.clear();else if(selected.has(id))selected.delete(id);else selected.add(id);}}));return {document:{getElementById:()=>({getAttribute:()=>String(open),click(){open=!open;}}),querySelectorAll:()=>buttons},get selected(){return [...selected];},get open(){return open;},clicks};};
 for(const scenario of [{},{missing:true},{broken:true}]){const ui=picker(scenario),actor={catalog:()=>({build:'test'}),livePos:{room:'field'},eval:async code=>vm.runInNewContext(code,{document:ui.document})};const ok=await targetRuntime.selectTarget(actor,{mapId:'field',monsterId:'normal'});assert.equal(ok,!scenario.missing&&!scenario.broken);assert.equal(ui.open,false,'always close native picker');if(ok){assert.deepEqual(ui.selected,['normal'],'clear even targets hidden in the previous map roster');assert.deepEqual(ui.clicks,['all','normal']);}else if(scenario.missing)assert.deepEqual(ui.clicks,[],'unavailable target does not alter native selection');}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-level-'));
 try{
  const economy=require('../src/economy'),cat=economy.loadCatalog(process.cwd(),'5391707'),wiki=economy.loadWiki(process.cwd());
  const save={lv:35,job:'mage',mapId:'w1',bestiary:{honeybuzz:20,bramble_bandit:4,sand_scorpion:3,cactling:2},exp:50,jobLv:20,jobExp:20,coins:2000};
  let rows=training.candidates(save,wiki,cat,{blocked:{s2:{}},recovery:true,provenOnly:true,ceiling:25});
  assert(rows.length);assert(rows.every(r=>r.monsterKind==='normal'&&r.level<=25&&r.kills>0&&r.mapId!=='s2'));
  assert.notEqual(rows[0].mapId,'w1','recovery is not trapped forever on the first field');
  assert.equal(training.candidates({...save,lv:cat.world.MAX_LV},wiki,cat).length,0,'cap never EXP farms');
  assert.equal(training.candidates({...save,bestiary:{}},wiki,cat,{recovery:true,provenOnly:true}).length,0,'recovery requires personal kill proof');
  assert.equal(training.candidates(save,wiki,{world:{MAX_LV:120,MONSTERS:cat.world.MONSTERS}}).length,0,'unknown native multiplier not guessed');
  assert.equal(training.candidates(save,wiki,cat,{maxHp:1}).length,0,'native HP budget rejects lethal normal routes despite attractive EXP and prior kills');
  const hpBudgetRows=training.candidates(save,wiki,cat,{maxHp:10000});assert(hpBudgetRows.length);assert(hpBudgetRows.every(r=>cat.world.MONSTERS.find(m=>m.id===r.monsterId).atk*4<=10000));
  const selected=rows[0],now=Date.now(),i={catalog:()=>cat,lastSave:save,lastSaveAt:now,livePos:{room:selected.mapId,at:now},goal:selected,v2:{sourceCoherence:{matches:true}},canDo:()=>true,expeditionAuto:async x=>calls.push(x)},calls=[];
  const target=require('../src/runtime/main-quest'),original=target.selectTarget;
  try{target.selectTarget=async()=>false;assert.match(await runtime.tick(i,{}),/unavailable/);assert.deepEqual(calls,[false]);calls.length=0;target.selectTarget=async()=>true;assert.match(await runtime.tick(i,{}),/verified target/);assert.deepEqual(calls,[false,true]);calls.length=0;i.lastSaveAt=now-31000;assert.equal(await runtime.tick(i,{}),null);assert.equal(calls.length,0);i.lastSaveAt=now;i.teamControl=true;assert.equal(await runtime.tick(i,{}),null);i.teamControl=false;i.pendingTravel={};assert.equal(await runtime.tick(i,{}),null);i.pendingTravel=null;i.v2.sourceCoherence.matches=false;assert.equal(await runtime.tick(i,{}),null);}finally{target.selectTarget=original;}
  assert.equal(delta({lv:2,exp:80},{lv:3,exp:10},()=>100),30);
  assert.equal(delta({lv:3,exp:80},{lv:3,exp:10},()=>100),-70,'death EXP loss stays net negative');
  assert.equal(delta({lv:3,exp:80},{lv:2,exp:10},()=>100),null,'reset not reward');
  let clock=1000000;const observer=new LevelProgress(root,'PUBLIC_CHARACTER');const actor={catalog:()=>({build:'b1',world:{MAX_LV:120,expToNext:()=>100,jobToNext:()=>100}}),lastSave:{...save,lv:2,exp:80,jobLv:2,jobExp:80},lastSaveAt:clock,livePos:{room:'w1',at:clock},status:'playing'};
  observer.observe(actor,clock);clock+=30000;actor.lastSaveAt=clock;actor.livePos.at=clock;actor.lastSave={...actor.lastSave,lv:3,exp:10,jobLv:3,jobExp:10};let v=observer.observe(actor,clock);assert.equal(v.netExp,30);assert.equal(v.expPerHour,null,'no rate before five minutes');
  observer.observe(actor,clock);assert.equal(observer.samples.length,1,'duplicate save excluded');
  for(let n=0;n<9;n++){clock+=30000;actor.lastSaveAt=clock;actor.livePos.at=clock;actor.lastSave.exp+=5;actor.lastSave.jobExp+=4;if(n===0)actor.livePos.room='town';else actor.livePos.room='w1';v=observer.observe(actor,clock);}
  assert.equal(v.expPerHour,900);assert(v.fieldPct<100,'town/travel does not count as farming');assert.equal(v.jobExpPerHour,792);
  const persisted=JSON.parse(fs.readFileSync(observer.file));assert.equal(persisted.samples.length,10);assert(!JSON.stringify(persisted).includes('coins'),'record only requested public progress');
  actor.lastSaveAt=clock+1;assert.equal(observer.observe(actor,clock).status,'waiting','future save excluded');
  actor.lastSaveAt=clock;actor.livePos.at=clock;actor.catalog=()=>({build:'b2',world:{MAX_LV:120,expToNext:()=>100,jobToNext:()=>100}});assert.equal(observer.observe(actor,clock).samples,0,'build memories isolated');
  const director=require('../src/director');const options=director.goalCandidates({...save,materials:{}},{wiki,catalog:cat});assert(options.filter(g=>g.kind==='exp').length>1,'measured planning can see alternative safe normal targets');
  const assigned=director.teamAssign([{slot:0,lv:35,candidates:[selected]},{slot:1,lv:40,candidates:[{...selected,mapId:'w2',monsterId:'bramble_bandit'}]}],wiki);assert.equal(assigned.get(0).monsterId,selected.monsterId);assert.equal(assigned.get(0).mapId,selected.mapId,'shared frontier cannot move validated target');
  const survival=require('../src/runtime/survival'),loadWiki=economy.loadWiki;economy.loadWiki=()=>wiki;
  try{
   const recovered={root,lastSave:{...save,potions:30},lastSaveAt:now,livePos:{room:selected.mapId,at:now},catalog:()=>cat,brain:{data:{deaths:{s2:[now-1000]}},blocked:()=>({})},canDo:()=>false,expeditionAuto:async x=>calls.push(x),returnToTown:async()=>{throw Error('unnecessary retreat');}};
   const recovery=survival.goal(recovered,wiki,now);recovered.livePos.room=recovery.goal.mapId;recovered.survivalHuntReady=[cat.build,recovery.goal.mapId,recovery.goal.monsterId].join(':');calls.length=0;
   assert.equal(await survival.tick(recovered,{hp:'70 / 100',autoOn:'true',panelOpen:false}),null,'normal damage must not interrupt an established recovery hunt');assert.equal(calls.length,0);
   const gate=require('../src/instance').GameInstance.prototype.huntAutoAllowed;
   recovered.goal=recovery.goal;recovered.vitals={hp:.70,at:Date.now()};recovered.livePos.at=Date.now();recovered.lastSaveAt=Date.now();
   assert.equal(gate.call(recovered),true,'AUTO control shares established recovery hunt hysteresis instead of disabling at 85 percent');
   recovered.vitals.hp=.34;assert.equal(gate.call(recovered),false,'critical HP cannot keep AUTO on');recovered.vitals.hp=.70;
   recovered.survivalRecovery=true;assert.equal(gate.call(recovered),false,'active recovery owns combat');recovered.survivalRecovery=false;
   recovered.vitals.at=Date.now()-16000;assert.equal(gate.call(recovered),false,'stale HP cannot keep AUTO on');recovered.vitals.at=Date.now();
   recovered.survivalHuntReady=null;assert.match(await survival.tick(recovered,{hp:'70 / 100',autoOn:'true',panelOpen:false}),/waiting for HP/);assert.deepEqual(calls,[false],'unverified low HP hunt stays off');
  }finally{economy.loadWiki=loadWiki;}
  console.log('PASS native normal targets, useful proven recovery, cap/source gates, unavailable target AUTO-off, freshness/ownership, level rollover/net loss, duplicate/future/build isolation and measured field time');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
