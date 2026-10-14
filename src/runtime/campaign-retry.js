'use strict';
// Only explicit pre-dispatch failures may release the ready character to side work.
const safeReasons=new Set(['knowledge unavailable','exchange-not-open','panel never opened','fresh town NPC position required','game update pending; loaded build differs','new development source requires review','personal-storage-max-tier','storage-upgrade-reserve-required']);
function failed(previous,target,result,now=Date.now()){
 if(result?.reason==='game update pending; loaded build differs'&&!result.ok&&!result.sent&&!result.transactionId&&!result.id){
  const old=previous?.target===target?previous:null;
  return {target,state:'waiting-build',failures:old?.reason===result.reason?0:old?.failures||0,blockedChecks:(old?.blockedChecks||(old?.reason===result.reason?old.failures:0)||0)+1,safeSideWork:true,reason:result.reason,at:now,nextAt:now+600000};
 }
 const safe=!!result&&!result.ok&&!result.sent&&!result.transactionId&&!result.id&&safeReasons.has(result.reason);
 const failures=previous?.target===target?(previous.failures||0)+1:1;
 return {target,failures,safeSideWork:safe&&failures>=3,reason:safe?result.reason:'waiting for verified outcome or reviewed action',at:now,nextAt:now+(safe&&failures>=3?600000:120000)};
}
function updateBlock(instance,now=Date.now()){
 try{const k=JSON.parse(require('fs').readFileSync(require('path').join(instance.root,'logs/game-knowledge/state.json'),'utf8')),loaded=instance.catalog().build;
  if(k.updatePending&&k.liveBuild&&k.liveBuild!==loaded&&Number.isFinite(k.checkedAt)&&now-k.checkedAt>=0&&now-k.checkedAt<600000)return {ok:false,sent:false,reason:'game update pending; loaded build differs',loadedBuild:loaded,liveBuild:k.liveBuild};
  if(k.liveBuild===loaded&&Number.isFinite(k.checkedAt)&&now-k.checkedAt>=0&&now-k.checkedAt<600000)return {ok:true,loadedBuild:loaded,liveBuild:k.liveBuild};
 }catch{}
 return null;
}
function sideGoal(retry,target,save,wiki,room,blocked,now=Date.now(),quest=null){
 if(!retry?.safeSideWork||retry.target!==target||now>=retry.nextAt)return null;
 const planner=require('../planning/boss-window');
 const candidates=[...(quest?[quest]:[]),...planner.sideSources(save,wiki,[],blocked)].map(goal=>({goal,out:planner.travelBudget(room,goal.mapId,wiki)}))
  .filter(c=>c.goal.mapId===room||room==='town'&&c.out.ms<=155000);
 // Both a town round trip and at least two minutes of useful work must fit.
 const pick=candidates.filter(c=>c.goal.mapId===room||now+c.out.ms*2+120000<retry.nextAt)
  .sort((a,b)=>(b.goal.score+(b.goal.mapId===room?500:0))-(a.goal.score+(a.goal.mapId===room?500:0)))[0];
 return pick?{...pick.goal,campaign:true,sideWork:true,retryAt:retry.nextAt,label:'รอแก้คราฟ · '+pick.goal.label}:null;
}
module.exports={failed,sideGoal,updateBlock};
