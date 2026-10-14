'use strict';
const assert=require('node:assert/strict'),fallback=require('../src/learning/ai-recovery-fallback');
const now=Date.now(),actorId='actor-'+'a'.repeat(32);
const member={slot:0,actorId,build:'b',status:'playing',saveAgeSeconds:2,noProgressSeconds:400,busy:false,
 recovery:{needsDiagnosis:true,suppressedActions:[],blockedNodes:[]},development:{campaign:{phase:'complete',ready:true}}};
const result={at:new Date(now).toISOString(),snapshotAt:new Date(now).toISOString(),plannerProvider:'meta',
 providers:{meta:{ok:false},typesafe:{ok:true,model:'jev-latest',choices:[{slot:0,action:'review_route',confidence:.95}]}},plan:null};
const state={members:[member]},out=fallback.select(result,state,now);
assert.equal(out.plannerProvider,'typesafe');assert.equal(out.plan.members[0].proposal.maxSpend,0);
assert(fallback.route(out,out.plan.members[0],state).allowed);assert(!fallback.route(out,out.plan.members[0],{members:[{...member,actorId:'actor-'+'b'.repeat(32)}]}).allowed,'replacement actor cannot receive prior advice');assert.equal(result.plan,null,'preserve original provider evidence');
for(const patch of [{actorId:null},{busy:true},{saveAgeSeconds:31},{noProgressSeconds:299},
 {recovery:{needsDiagnosis:true,suppressedActions:['replan']}},
 {recovery:{needsDiagnosis:true,blockedNodes:['execute']}},
 {development:{campaign:{phase:'wing',ready:true}}}]){
 const changed={members:[{...member,...patch}]};assert.equal(fallback.select(result,changed,now),result);
 assert(!fallback.route(out,out.plan.members[0],changed).allowed,'changed evidence blocks dispatch');
}
assert.equal(fallback.select(result,state,now+90001),result);
assert.equal(fallback.select({...result,providers:{...result.providers,meta:{ok:true}}},state,now).fallback,undefined,'never turn model disagreement into outage fallback');
for(const action of ['focus_refine','recover','sell','observe']){
 const changed={...result,providers:{...result.providers,typesafe:{...result.providers.typesafe,choices:[{slot:0,action,confidence:1}]}}};
 assert.equal(fallback.select(changed,state,now),changed,'fallback cannot invent an unavailable strategic focus or direct payment/AUTO action');
}
{
 const strategic={...member,busy:true,noProgressSeconds:2,personalBrain:{lowFunds:false,availableFocuses:['focus_gear','focus_refine']},executionGates:{refine:{kind:'refine',status:'pending'}}},choice={slot:0,action:'focus_gear',confidence:.95};
 const request={...result,providers:{...result.providers,typesafe:{ok:true,model:'jev-latest',choices:[choice]}}},snapshot={members:[strategic]},plan=fallback.select(request,snapshot,now);
 assert.equal(plan.fallback.mode,'bounded_zero_spend_strategy');assert.equal(plan.plan.members[0].action,'focus_gear');assert.equal(plan.plan.members[0].proposal.maxSpend,0);assert(fallback.route(plan,plan.plan.members[0],snapshot).allowed,'busy owner may keep work while a zero-spend intent is queued');
 assert.equal(request.plan,null);assert(!request.providers.meta.ok,'primary outage evidence remains unchanged');
 for(const patch of [{status:'stopped'},{saveAgeSeconds:31},{system:{sourceMatches:false}},{recovery:{blockedNodes:['health']}},{recovery:{suppressedActions:['replan']}},{development:{campaign:{phase:'wing',ready:true}}}])assert.equal(fallback.select(request,{members:[{...strategic,...patch}]},now),request);
 for(const action of ['focus_refine','sell','recover'])assert.equal(fallback.select({...request,providers:{...request.providers,typesafe:{...request.providers.typesafe,choices:[{...choice,action}]}}},snapshot,now).plan,null);
 const low={...request,providers:{...request.providers,typesafe:{...request.providers.typesafe,choices:[{...choice,confidence:.89}]}}};assert.equal(fallback.select(low,snapshot,now),low,'confidence below the fixed fallback bound is not dispatched');
 assert(!fallback.route(plan,plan.plan.members[0],{members:[{...strategic,personalBrain:{availableFocuses:[]}}]}).allowed);
}
console.log('PASS bounded Jev outage recovery, current actor/evidence binding, no payment/ready-goal override, no disagreement bypass');
