'use strict';
const assert=require('assert/strict'),vm=require('vm');
const {dailyWorkPolicy}=require('../src/planning/daily-work-policy');
const {refreshDailyQuotas}=require('../src/runtime/daily-quota-poll');
const {GameInstance}=require('../src/instance');
const {Federation}=require('../src/federation');
async function main(){
 let now=1000000,build='fixture';const view={at:now,build,reason:'waiting for six',quotas:[{guild:{known:true,left:1}}]};
 for(const intent of [null,{phase:'IDLE'},{phase:'FINISHED'}])assert.equal(dailyWorkPolicy(view,intent,build,now).mode,'interim','remaining personal quota cannot reserve all progress');
 const intent={id:'six',kind:'guild',phase:'GATHERING',build,at:now,deadline:now+600000};
 assert(dailyWorkPolicy(view,intent,build,now).reserve);
 for(const patch of [{build:'other'},{at:now-15000},{at:now+10000},{deadline:now},{phase:'unrecognized'}])assert.equal(dailyWorkPolicy(view,{...intent,...patch},build,now).ownsNavigation,false);
 assert.equal(dailyWorkPolicy(view,{...intent,phase:'UNCERTAIN'},build,now).mode,'reconcile');
 let calls=0,finish;const actor={credentials:{charName:'fixture'},queryDailyQuotas:()=>{calls++;return new Promise(r=>{finish=r;});}};
 assert(refreshDailyQuotas(actor,build,()=>now));assert.equal(refreshDailyQuotas(actor,build,()=>now),false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 finish([{ok:true},{ok:true}]);await actor.dailyQuotaQueryPromise;assert.equal(actor.dailyQueryStatus.state,'awaiting_server','sending a read is not quota evidence');
 now+=20001;actor.queryDailyQuotas=async()=>{calls++;return [{ok:true},{ok:false}];};assert(refreshDailyQuotas(actor,build,()=>now));await actor.dailyQuotaQueryPromise;
 assert.equal(actor.dailyQueryStatus.state,'backoff');assert.equal(actor.dailyQueryStatus.retryAt-now,20000);
 now+=19999;assert.equal(refreshDailyQuotas(actor,build,()=>now),false);now+=1;refreshDailyQuotas(actor,build,()=>now);await actor.dailyQuotaQueryPromise;assert.equal(actor.dailyQueryStatus.retryAt-now,40000);
 now+=40000;actor.activityEvidence={latest:{tw:{build,at:now},gd:{build,at:now}}};assert.equal(refreshDailyQuotas(actor,build,()=>now),false,'fresh received quotas skip work');
 actor.activityEvidence.latest.gd.build='old';actor.queryDailyQuotas=async()=>[{ok:true},{ok:true}];refreshDailyQuotas(actor,build,()=>now);await actor.dailyQuotaQueryPromise;assert.equal(actor.dailyQueryStatus.failures,0);
 const sent=[];let evaluations=0;const client={AsteriaNet:{handlers:{},isConnected:()=>true,social:(t,p)=>sent.push([t,p])}};
 const query={eval:async code=>{evaluations++;return vm.runInNewContext(code,{window:client,Date,document:{}});}};
 const response=await GameInstance.prototype.queryDailyQuotas.call(query);assert.equal(evaluations,1);assert.deepEqual(sent.map(x=>x[0]),['twq','gdq']);assert(response.every(x=>x.ok),'only existing read commands, never start/spend');
 // Exercise the real federation entry point: an idle coordinator and one
 // member's remaining quota must leave that member's navigation available.
 const member={credentials:{charName:'fixture'},status:'playing'},f={machine:'tum',now:()=>now,root:'.',local:{build},daily:{policy:{enabled:true},gate:()=>({allowed:true}),view},activity:{view:()=>({phase:'IDLE'}),act:async()=>{}},log(){}};
 Federation.prototype.refreshTeamActivities.call(f,{instances:[member]});await new Promise(r=>setImmediate(r));assert.equal(member.dailyTeamPending,false);assert.equal(member.dailyWorkStatus.mode,'interim');
 f.activity.view=()=>({...intent,at:now,deadline:now+100000});Federation.prototype.refreshTeamActivities.call(f,{instances:[member]});assert.equal(member.dailyTeamPending,true);
 console.log('PASS daily ownership/current-build expiry, interim progress, single query evaluation, coalescing/freshness/backoff and no quota-success inference');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
