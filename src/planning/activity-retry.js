'use strict';
// A failed rally is a whole-cycle cost. Persisted run history survives farm
// restarts; only a confirmed clear of the same activity resets its backoff.
function retry(runs,{kind,build,day,now,manual=false}={}){
 const history=(runs||[]).filter(r=>r.kind===kind&&r.build===build&&r.day===day&&Number.isFinite(r.at)&&r.at<=now).sort((a,b)=>a.at-b.at);
 let failures=0,last=null;
 for(const r of history){
  if(r.cleared===true&&r.phase==='COMPLETE'){failures=0;last=null;}
  else if(['FINISHED','WITHDRAWN'].includes(r.phase)){failures++;last=r;}
 }
 const delayMs=failures?Math.min(1800000,300000*2**Math.min(failures-1,3)):0;
 const nextAt=last?last.at+delayMs:null;
 return {allowed:manual||!nextAt||now>=nextAt,failures,delayMs,nextAt,lastWorkflowId:last?.id||null,reason:nextAt&&now<nextAt?'กิจกรรมนี้ยังไม่จบตามเป้าหมาย · พัฒนาส่วนตัวหรือกิจกรรมอื่นระหว่างพักการรวมซ้ำ':null};
}
module.exports={retry};
