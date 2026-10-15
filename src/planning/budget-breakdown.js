'use strict';
// Classification is advisory. Historical holds remain unspendable until the
// runtime writes an authenticated rebase; this projection never releases one.
function project(i,craft,now=Date.now()){
 const historical={count:0,cost:{}},active={count:0,cost:{}};
 for(const c of i.v2?.reservations?.data?.claims||[]){
  if(!['RESERVED','STARTED','UNCERTAIN'].includes(c.status))continue;
  const old=c.status==='UNCERTAIN'&&Number.isFinite(c.at)&&now-c.at>=600000&&Number.isFinite(i.bagSessionStartedAt)&&c.deadline<i.bagSessionStartedAt;
  const bucket=old?historical:active;bucket.count++;for(const [k,v]of Object.entries(c.cost||{}))if(Number.isSafeInteger(v)&&v>0)bucket.cost[k]=(bucket.cost[k]||0)+v;
 }
 const compact=o=>Object.fromEntries(Object.entries(o||{}).slice(0,8));
 let refine=[];try{refine=require('./combat-work').requirements(i,require('../economy').loadWiki(i.root),now,{includeReady:true}).filter(g=>g.purpose==='refine').slice(0,3).map(g=>({id:g.id,materials:compact(Object.fromEntries(g.missing.map(n=>[n.name,n.want])))}));}catch{}
 return {historical:{count:historical.count,cost:compact(historical.cost),action:'reconcile_current_budget_no_replay'},active:{count:active.count,cost:compact(active.cost)},durableHeld:compact(i.actorIdentity?.actorId?i.registryV32?.store?.held?.(i.actorIdentity.actorId):{}),nextCraft:craft?{id:craft.id,cost:compact(craft.cost)}:null,nextRefine:refine,supplyCopper:require('../upgrade-reserve').reserve(i.lastSave||{},i.catalog().world),historicalIsNotNewDemand:true,releaseAuthorized:false};
}
module.exports={project};
