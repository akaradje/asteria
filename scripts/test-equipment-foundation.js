'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const runtime=require('../src/runtime/development-progress'),{GameInstance}=require('../src/instance');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-foundation-'));
const cat={build:'fixture',world:{MAX_LV:120,REFINE:{max:10,chance:[100,100,100,60,45,32,20,12,6,3],cost:()=>175,ore:()=>'Abyss Steel',need:()=>1}},items:{epic:{id:'epic',name:'Equipped Epic',slot:'armor',tier:5,rarity:'epic',stats:{def:30,hp:300}},old:{id:'old',slot:'head',tier:1,rarity:'uncommon',stats:{def:1}}}};
cat.items.baselineWing={id:'baselineWing',slot:'wing',reqLv:1,stats:{}};
function actor(){const now=Date.now();return {root,catalog:()=>cat,lastSaveAt:now,lastSave:{lv:120,job:'asura',coins:1000000,materials:{'Abyss Steel':15},pets:{pet:0},petActive:'pet',equip:{wing:'baselineWing',armor:'epic',head:'old'},refine:{epic:0}},livePos:{room:'town',at:now},endgameCampaign:{phase:'complete'}};}
async function main(){
 let i=actor();assert.equal(runtime.refineOpportunity(i).id,'epic','usable Epic can improve despite future Legendary targets');
 i.lastSave.refine.epic=3;assert.equal(runtime.refineOpportunity(i),null,'native +4 is risky and cannot enter guaranteed queue');
 i=actor();i.endgameCampaign={phase:'wing',ready:false,wing:{recipeVerified:true,coinsNeeded:500000,needs:{'Abyss Steel':15}}};i.goal={kind:'survival'};i.survivalStatus={until:Date.now()+60000,deaths:[{map:'n3',at:Date.now()}]};
 assert.equal(runtime.refineOpportunity(i),null,'wing ore cannot be consumed by refinement');i.lastSave.materials['Abyss Steel']=16;
 let next=runtime.refineOpportunity(i);assert(next&&next.reserve===512000,'recovery can improve equipment without waiting for wing completion');
 assert.equal(next.reservedMaterials['Abyss Steel'],15);i.lastSave.coins=512100;assert.equal(runtime.refineOpportunity(i),null,'full wing cash plus upkeep preserved');i.lastSave.coins=1000000;
 i.endgameCampaign.ready=true;assert.equal(runtime.refineOpportunity(i),null,'ready wing keeps payment ownership');i.endgameCampaign.ready=false;i.survivalStatus.until=Date.now()-1;
 assert(runtime.refineOpportunity(i)?.prepareBoss,'a +0 body piece gets one basic guaranteed step before solo boss');i.lastSave.refine.epic=1;assert.equal(runtime.refineOpportunity(i),null,'expired recovery cannot authorize ongoing idle upgrades after basic preparation');
 i.lastSave.refine.epic=0;i.goal={monsterKind:'boss',mapId:'town'};i.autoChores=true;i.vitals={hp:1,at:Date.now()};i.canDo=()=>true;i.expeditionAuto=async()=>{};i.closeGamePanel=async()=>{};i.screen=async()=>({hp:'100 / 100'});let prepared=0;i.refineEquipped=async opts=>{assert(opts.guaranteedOnly);assert.equal(opts.extraReserveCoins,500000);assert.equal(opts.reservedMaterials['Abyss Steel'],15);prepared++;return {refined:0}};
 await runtime.tick(i,{});assert.equal(prepared,1,'boss goal cannot starve guarded basic preparation');i.dailyTeamPending=true;await runtime.tick(i,{});assert.equal(prepared,1,'team daily owner still blocks even basic preparation');
 const planner=require('../src/planning/capped-campaign'),originalPlan=planner.plan,feed=require('../src/runtime/boss-feed'),originalPoll=feed.poll,originalOpportunity=runtime.refineOpportunity;
 try{const reached=Error('continued to boss/side-work scheduler');feed.poll=async()=>{throw reached;};runtime.refineOpportunity=()=>({prepareBoss:true});
  for(const phase of ['class','wing'])for(const reason of ['cooldown','new development source requires review']){
   planner.plan=()=>({active:true,phase,ready:false,missing:[],requirements:[]});i.dailyTeamPending=false;i.canDo=()=>false;i.equipmentMaintenanceStatus={status:'not_sent',result:{reason}};
   await assert.rejects(()=>require('../src/runtime/capped-campaign').tick(i,{}),e=>e===reached,'blocked preparation releases navigation for '+phase+' / '+reason);
  }assert.equal(prepared,1,'no repeated payment while blocked');
 }finally{planner.plan=originalPlan;feed.poll=originalPoll;runtime.refineOpportunity=originalOpportunity;}
 // Native class ingredients and promotion coins are isolated even while
 // preparing currently equipped armor for the first boss clear.
 {const a=actor();a.lastSave.job='prior';a.endgameCampaign={phase:'class',active:true,ready:false};a.v2={sourceCoherence:{matches:true}};
  const classCat={...cat,world:{...cat.world,HIGH_CLASSES:{next:{from:'prior'}},ASCEND:{lv:99,coins:100000,items:{'Abyss Steel':14}}}};a.catalog=()=>classCat;
  const step=runtime.refineOpportunity(a);assert(step?.classPreparation);assert(step.guaranteed);assert.equal(step.to,1);assert.equal(step.reservedMaterials['Abyss Steel'],14);assert.equal(step.reserve,112000);
  a.lastSave.materials['Abyss Steel']=14;assert.equal(runtime.refineOpportunity(a),null,'never consume last promotion ingredient');a.lastSave.materials['Abyss Steel']=15;a.lastSave.refine.epic=1;assert.equal(runtime.refineOpportunity(a),null,'finite foundation must release town after one armor step');a.lastSave.refine.epic=0;a.endgameCampaign.ready=true;assert.equal(runtime.refineOpportunity(a),null,'ready class owns progression ahead of refine');
 }
 // Exercise the actual blacksmith adapter, including a save/owner change while
 // Actual first-wing actors do not already have a dummy baseline wing. The
 // previous test fixture concealed an unreachable milestone preparation path.
 {const a=actor();delete a.lastSave.equip.wing;a.v2={sourceCoherence:{matches:true}};a.endgameCampaign={phase:'wing',active:true,ready:false,wing:{recipeVerified:true,coinsNeeded:500000,needs:{'Abyss Steel':14}}};
  const step=runtime.refineOpportunity(a);assert(step?.wingPreparation&&step.prepareBoss&&step.guaranteed);assert.equal(step.id,'epic');assert.equal(step.to,1);assert.equal(step.reserve,512000);assert.equal(step.reservedMaterials['Abyss Steel'],14);
  a.lastSave.lv=119;assert(runtime.refineOpportunity(a)?.wingPreparation,'first wing readiness is not artificially deferred to level cap');a.lastSave.lv=120;
  for(const mutate of [x=>x.v2.sourceCoherence.matches=false,x=>x.endgameCampaign.wing.recipeVerified=false,x=>x.endgameCampaign.ready=true,x=>x.lastSave.materials['Abyss Steel']=14,x=>x.lastSave.coins=512100,x=>x.lastSave.refine.epic=1]){const x={...a,lastSave:{...a.lastSave,materials:{...a.lastSave.materials},refine:{...a.lastSave.refine}},endgameCampaign:JSON.parse(JSON.stringify(a.endgameCampaign)),v2:{sourceCoherence:{matches:true}}};mutate(x);assert.equal(runtime.refineOpportunity(x),null,'changed recipe/source/reserve/finite step must release preparation');}
  a.slot=7;a.openTownService=async()=>({ok:true});let paid=0;a.eval=async()=>{paid++;a.lastSave.refine.epic=1;a.lastSave.materials['Abyss Steel']--;a.lastSave.coins-=175;a.lastSaveAt=Date.now()+1;return true;};
  const options={targetId:'epic',maxAttempts:1,guaranteedOnly:true,extraReserveCoins:500000,reservedMaterials:{'Abyss Steel':14}};
  assert.equal((await GameInstance.prototype.refineEquipped.call(a,{...options,extraReserveCoins:0})).refined,0);assert.equal(paid,0,'wrapper rejects a caller that fails to reserve wing Copper');
  assert.equal((await GameInstance.prototype.refineEquipped.call(a,{...options,reservedMaterials:{}})).refined,0);assert.equal(paid,0,'wrapper rejects missing wing-material reservations');
  assert.equal((await GameInstance.prototype.refineEquipped.call(a,options)).refined,1);assert.equal(paid,1,'actual journaled wrapper admits exactly one guaranteed first-wing preparation step');assert.equal(a.developmentLedger.rows[0].status,'change_observed');assert.equal(a.lastSave.materials['Abyss Steel'],14);
 }
 // opening the NPC. No browser or real payment is involved in these tests.
 let clicks=0;
 async function attempt(change,opts={}){const a=actor();a.openTownService=async()=>{change?.(a);return {ok:true}};a.eval=async()=>{clicks++;return true};return GameInstance.prototype.refineEquipped.call(a,{targetId:'epic',maxAttempts:1,guaranteedOnly:true,extraReserveCoins:500000,reservedMaterials:{'Abyss Steel':12},...opts});}
 assert.equal((await attempt()).refined,1);assert.equal(clicks,1);
 for(const change of [a=>{a.lastSave.coins=512100},a=>{a.lastSave.materials['Abyss Steel']=12},a=>{a.lastSave.equip.armor='old'},a=>{a.lastSave.refine.epic=3},a=>{a.lastSaveAt=Date.now()-40000},a=>{a.livePos.room='n3'},a=>{a.dailyTeamPending=true},a=>{a.teamTradeStatus={phase:'OPEN'}},a=>{a.v2={sourceCoherence:{matches:false}}}]){const before=clicks;assert.equal((await attempt(change)).refined,0);assert.equal(clicks,before,'changed state must not send native payment');}
 assert.equal((await attempt(null,{reservedMaterials:{'Abyss Steel':-1}})).refined,0);assert.equal(clicks,1,'invalid reserve sends nothing');
 // Current native checkbox can survive across NPC visits. A base-odds plan
 // clears it, checks the replacement DOM, and never sends while it stays on.
 for(const mode of ['on','disabled','stuck','absent']){
  const a=actor();let paid=0,toggled=0;
  const stone={checked:true,disabled:mode==='disabled',click(){toggled++;if(mode!=='stuck')this.checked=false;}};
  const document={querySelector(s){if(s.includes('data-ref-stone'))return mode==='absent'?null:stone;if(s.includes('data-refine='))return {disabled:false,click(){paid++;}};return null;}};
  a.openTownService=async()=>({ok:true});a.eval=async code=>vm.runInNewContext(code,{document});
  const out=await GameInstance.prototype.refineEquipped.call(a,{targetId:'epic',maxAttempts:1,guaranteedOnly:true});
  assert.equal(paid,mode==='on'||mode==='absent'?1:0);assert.equal(out.refined,paid);
  assert.equal(toggled,mode==='on'||mode==='stuck'?1:0,'only the reviewed option is cleared before payment');
 }
 console.log('PASS Epic guaranteed foundation, wing coin/material isolation, recovery ownership, native risk cutoff and exact pre-payment resource/equipment/owner/freshness checks');
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1});
