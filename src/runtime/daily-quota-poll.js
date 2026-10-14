'use strict';
// Read-only work has one request in flight per actor, a bounded cadence, and
// backoff. A failed read never changes a quota or implies a successful activity.
function refreshDailyQuotas(i,build,now=Date.now,log=()=>{}){
 const at=now(),state=i.dailyQueryStatus||{failures:0};
 if(i.dailyQuotaQueryBusy||at<(state.retryAt||0)||i.recycling||i.healthRecovery)return false;
 if(typeof i.queryDailyQuotas!=='function')return false;
 const frames=(i.dailyRallyKind==='rift'?['tw','gd','dg']:['tw','gd']).map(t=>i.activityEvidence?.latest?.[t]);
 const fresh=frames.every(f=>f?.build===build&&Number.isFinite(f.at)&&at-f.at>=0&&at-f.at<20000);
 if(fresh)return false;
 i.dailyQuotaQueryBusy=true;
 i.dailyQueryStatus={...state,state:'reading',at,retryAt:at+20000};
 i.dailyQuotaQueryPromise=Promise.resolve().then(()=>i.queryDailyQuotas()).then(async results=>{
   if(!Array.isArray(results)||results.length!==2||results.some(r=>r?.ok!==true))throw Error('quota query not sent');
   if(i.dailyRallyKind==='rift'&&(await i.queryDungeons?.())?.ok!==true)throw Error('Rift query not sent');
   i.dailyQueryStatus={state:'awaiting_server',failures:0,at:now(),retryAt:now()+20000};
 },error=>{throw error;}).catch(()=>{
   const failures=Math.min(8,(state.failures||0)+1),delay=Math.min(120000,20000*2**(failures-1));
   i.dailyQueryStatus={state:'backoff',failures,at:now(),retryAt:now()+delay,reason:'อ่านโควต้าไม่สำเร็จ รอหน้าจอตอบก่อนถามใหม่'};
   log('daily quota read deferred: '+i.credentials.charName+' ('+delay+'ms)','warn');
 }).finally(()=>{i.dailyQuotaQueryBusy=false;});
 return true;
}
module.exports={refreshDailyQuotas};
