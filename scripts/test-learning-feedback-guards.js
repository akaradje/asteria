'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {ContextLearning,context}=require('../src/learning/context-learning');
const {GoalFeedback,key}=require('../src/learning/goal-feedback');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-learning-guards-'));
const state=()=>({job:'asura',lv:120,exp:0,coins:1000,equip:{weapon:'w',armor:'a'},stage:{w:0},petActive:'crab',pets:{crab:100,dragon:300},bestiary:{prey:0}});
const goal={kind:'pet-unlock',mapId:'w1',monsterId:'prey',score:1600};
async function run(){
 let now=1000000;
 const base=state(),sig=context('b1',base);
 const eligible=require('../src/learning/context-learning').farmWindowEligible;
 const terminalActor={character:{name:'Actor'},lastSave:base,lastSaveAt:now,livePos:{at:now,room:'w1'},teamTradeIntent:{phase:'UNCERTAIN',offer:{donor:'Actor',receiver:'Other'}}};
 assert(eligible(terminalActor,now),'quarantined terminal intent does not falsely hide normal farming');
 assert(!eligible({...terminalActor,tradeJournal:{phase:'UNCERTAIN',sessionId:3}},now),'unresolved local server session still prevents farm attribution');
 assert.equal(sig,context('b1',{...base,equip:{armor:'a',weapon:'w'}}),'object ordering has no mechanical meaning');
 assert.notEqual(sig,context('b1',{...base,stage:{w:5}}),'item stages isolate performance');
 assert.notEqual(sig,context('b1',{...base,petActive:'dragon'}),'active pet isolates performance');
 assert.notEqual(sig,context('b1',{...base,pets:{...base.pets,crab:300}}),'friendship bonus tier isolates performance');
 assert.equal(sig,context('b1',{...base,pets:{...base.pets,crab:299}}),'kills within a bonus tier do not fragment observations');
 assert.notEqual(sig,context('b2',base),'game build isolates performance');
 assert.notEqual(sig,context('b1',{...base,elixirT:100}),'EXP elixir cannot inflate a different route comparison');
 assert.notEqual(sig,context('b1',{...base,rested:100}),'rested EXP bonus isolates comparison');
 assert.equal(context('b1',{...base,elixirT:100}),context('b1',{...base,elixirT:99}),'timer decrement does not fragment same active buff');
 assert.notEqual(context('b1',{...base,autoTargets:['normal']}),context('b1',{...base,autoTargets:['normal','elite']}),'mixed boss/normal targets cannot support exclusive normal-route performance');
 assert.equal(context('b1',{...base,autoTargets:['a','b']}),context('b1',{...base,autoTargets:['b','a']}),'native target order has no selection meaning');
 assert.notEqual(context('b1',{...base,autoTargets:[]}),context('b1',{...base,autoTargets:null}),'unknown native filter is not verified all-target selection');
 const guards=[
  ['travel',{pendingTravel:{map:'w2'}}],['team control',{teamControl:true}],['daily gathering',{dailyTeamPending:true}],
  ['accepted activity',{dailyWorkStatus:{ownsNavigation:true}}],['guild hall',{room:'gh#12'}],['guild dungeon',{room:'gd#12'}],
  ['tower',{room:'tw#12'}],['town',{room:'town'}],['trade gather',{teamTradeIntent:{phase:'GATHERING',offer:{donor:'Actor',receiver:'Other'}}}],
  ['uncertain trade',{tradeJournal:{phase:'UNCERTAIN',sessionId:3}}],['recovery',{healthRecovery:true}],['chores',{choresBusy:true}]
 ];
 for(const[label,patch]of guards){
  const learning=new ContextLearning(root,'context-'+label,{now:()=>now}),feedback=new GoalFeedback(root,'goal-'+label,{now:()=>now});
  const i={character:{name:'Actor'},lastSave:state(),lastSaveAt:now,livePos:{at:now,room:'w1'},campaignGoal:goal};
  const sample=()=>{i.lastSaveAt=now;i.livePos.at=now;learning.observe(i,'b1');feedback.observe(i,'b1');};
  sample();now+=30000;i.lastSave.exp=10;i.lastSave.bestiary.prey=1;sample();
  const row=Object.values(learning.data.contexts)[0],feedbackRow=Object.values(feedback.rows)[0];
  const held={...i,...patch,livePos:{...i.livePos,room:patch.room||'w1',at:now+30000},lastSave:{...i.lastSave,exp:1000,bestiary:{prey:100}},lastSaveAt:now+30000};
  now+=30000;learning.observe(held,'b1');feedback.observe(held,'b1');
  assert.equal(row.exp,10,label+' cannot be attributed as farm EXP');assert.equal(feedbackRow.kills,1,label+' cannot be attributed as goal kills');
  now+=30000;i.lastSave.exp=1010;i.lastSave.bestiary.prey=101;sample();
  assert.equal(row.exp,10,label+' interruption cannot bridge its unobserved gains');assert.equal(feedbackRow.kills,1,label+' interruption cannot bridge unobserved kills');
 }
 const quiet=new GoalFeedback(root,'quiet',{now:()=>now}),i={lastSave:state(),lastSaveAt:now,livePos:{at:now,room:'w1'},campaignGoal:goal};
 const quietSample=()=>{i.lastSaveAt=now;i.livePos.at=now;quiet.observe(i,'b1');};
 quietSample();
 for(let visit=0;visit<4;visit++){
  for(let n=0;n<3;n++){now+=30000;quietSample();}
  assert.equal(quiet.rank([goal],i.lastSave,'b1').length,1,'fragmented short quiet visits must not ban route');
  i.pendingTravel={map:'town'};quiet.observe(i,'b1');delete i.pendingTravel;now+=30000;quietSample();
 }
 for(let n=0;n<4;n++){now+=30000;quietSample();}
 now+=90001;quietSample();
 assert.equal(quiet.rows[key('b1',i.lastSave,goal)].quietMs,0,'unobserved time breaks continuous quiet evidence');
 for(let n=0;n<6;n++){now+=30000;quietSample();}
 assert.equal(quiet.rank([goal],i.lastSave,'b1').length,0,'continuous three-minute stall still invokes cooldown');
 assert.equal(new GoalFeedback(root,'quiet',{now:()=>now}).rank([goal],i.lastSave,'b1').length,0,'confirmed cooldown survives restart');
 const modules={quest:require('../src/planning/main-quest'),rare:require('../src/planning/rare-pet'),growth:require('../src/planning/endgame-growth'),team:require('../src/planning/team-workboard'),eco:require('../src/economy')};
 const original={quest:modules.quest.assess,rare:modules.rare.assess,growth:modules.growth.assess,team:modules.team.candidate,wiki:modules.eco.loadWiki};
 try{
  modules.rare.assess=()=>({});modules.team.candidate=()=>null;modules.eco.loadWiki=()=>({});
  for(const kind of ['main-quest','equipment-drill']){
   const target={...goal,kind,...(kind==='main-quest'?{questKey:'q1'}:{itemId:'w'})};
   modules.quest.assess=()=>kind==='main-quest'?{key:'q1',candidate:target}:{candidate:null};modules.growth.assess=()=>({candidates:kind==='equipment-drill'?[target]:[]});
   const feedback=new GoalFeedback(root,'runtime-'+kind,{now:()=>now}),save={...state(),job:'asura',pets:{pet:0},petActive:'pet',equip:{...state().equip,wing:'baselineWing'}};feedback.rows[key('b1',save,target)]={cooldownUntil:now+600000,at:now};
   let refreshed=0;const actor={lastSave:save,goal:target,campaignGoal:target,huntMap:'w1',catalog:()=>({build:'b1',items:{baselineWing:{slot:'wing'}},world:{MAX_LV:120}}),v2:{goalFeedback:feedback},refreshGoal(){refreshed++;this.goal={kind:'fallback',mapId:'w2'};}};
   await require('../src/runtime/main-quest').tick(actor,{});
   assert.equal(actor.campaignGoal,null,kind+' cooldown releases retained campaign');assert.equal(actor.goal.kind,'fallback',kind+' cooldown selects ordinary fallback');assert.equal(refreshed,1);
   const unrelated={...target,kind:'campaign-boss'};actor.goal=unrelated;actor.campaignGoal=unrelated;refreshed=0;
   await require('../src/runtime/main-quest').tick(actor,{});
   assert.equal(actor.goal,unrelated,'feedback cannot erase unrelated campaign');assert.equal(refreshed,0);
  }
 }finally{modules.quest.assess=original.quest;modules.rare.assess=original.rare;modules.growth.assess=original.growth;modules.team.candidate=original.team;modules.eco.loadWiki=original.wiki;}
 console.log('PASS stage/pet/build context isolation, all non-farm guards, interrupted evidence reset, durable real stall cooldown and runtime retirement of cooled quest/drill goals');
}
run().finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}).catch(e=>{console.error(e);process.exitCode=1;});
