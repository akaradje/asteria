'use strict';
// Bound NPC acquisition, not the result of a payment. Never race a detached
// mutation against a timeout: check before the next attempt instead.
function townServiceBudget(i,key,svc,{now=Date.now,durationMs=60000,maxClicks=8}={}){
 const startedAt=now(),deadline=startedAt+durationMs;
 let clicks=0;
 const fail=(reason,backoff=false)=>{
  if(backoff){i.townServiceBackoff ||= {};i.townServiceBackoff[key]=now()+60000;}
  i.townServiceStatus={key,state:'deferred',reason,startedAt,at:now(),deadline,clicks,retryAt:i.townServiceBackoff?.[key]||null};
  return {ok:false,reason};
 };
 const check=({position=true,click=false}={})=>{
  const at=now();
  if(at<(i.townServiceBackoff?.[key]||0))return fail('NPC acquisition cooldown');
  if(at>=deadline)return fail('NPC acquisition time budget exceeded',true);
  if(position){const p=i.livePos,age=at-p?.at,distance=Math.hypot(p?.x-svc.x,p?.z-svc.z);
   if(p?.room!=='town'||!Number.isFinite(age)||age<0||age>10000||!Number.isFinite(distance)||distance>50)return fail('fresh town NPC position required');
  }
  if(click&&clicks>=maxClicks)return fail('NPC acquisition click budget exceeded',true);
  if(click)clicks++;
  i.townServiceStatus={key,state:'locating',startedAt,at,deadline,clicks};
  return {ok:true};
 };
 const opened=()=>{i.townServiceStatus={key,state:'opened',startedAt,at:now(),deadline,clicks};};
 return {check,fail,opened};
}
module.exports={townServiceBudget};
