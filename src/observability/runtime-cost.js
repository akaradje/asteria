'use strict';
// DevTools cumulative main-thread task time, not OS/process/GPU CPU or total RAM.
function measure(before,after,at){
 const seconds=after.Timestamp-before.Timestamp;
 if(!(seconds>0&&seconds<=60))return null;
 const task=after.TaskDuration-before.TaskDuration;
 if(!Number.isFinite(task)||task<0)return null;
 const pct=key=>{const n=after[key]-before[key];return Number.isFinite(n)&&n>=0?Math.round(n/seconds*1000)/10:null;};
 return {at,windowMs:Math.round(seconds*1000),mainThreadBusyPct:pct('TaskDuration'),scriptPct:pct('ScriptDuration'),layoutPct:pct('LayoutDuration'),stylePct:pct('RecalcStyleDuration'),jsHeapMb:Number.isFinite(after.JSHeapUsedSize)?Math.round(after.JSHeapUsedSize/1048576):null,scope:'renderer_main_thread_task_time_and_js_heap_not_process_cpu_or_total_ram'};
}
class RuntimeCost{
 constructor({timeoutMs=2500,detachTimeoutMs=500}={}){this.page=null;this.session=null;this.previous=null;this.lastAttempt=0;this.busy=false;this.value=null;this.epoch=0;this.timeoutMs=timeoutMs;this.detachTimeoutMs=detachTimeoutMs;this.probe={state:'waiting',at:Date.now(),reason:'awaiting_first_probe'};}
 async detach(session){if(!session)return;let timer;try{await Promise.race([Promise.resolve().then(()=>session.detach()).catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,this.detachTimeoutMs);})]);}finally{clearTimeout(timer);}}
 async close(){this.epoch++;const session=this.session;this.session=null;this.page=null;this.previous=null;this.value=null;this.probe={state:'closed',at:Date.now(),reason:'page_session_closed'};await this.detach(session);}
 async sample(i,now=Date.now()){
  if(this.busy||!i.page||!i.ctx||i.status!=='playing'||i.recycling||now-this.lastAttempt<(i.resourceHealth?.mode==='reduced'?30000:15000))return;
  this.busy=true;this.lastAttempt=now;let timer;const started=Date.now();this.probe={state:'sampling',at:started,reason:'read_only_metrics'};
  try{
   if(this.page!==i.page)await this.close();
   const epoch=++this.epoch,page=i.page;
   await Promise.race([(async()=>{
    if(!this.session){const session=await i.ctx.newCDPSession(page);if(epoch!==this.epoch||page!==i.page){await this.detach(session);return;}this.page=page;this.session=session;await session.send('Performance.enable');}
    if(epoch!==this.epoch||page!==i.page||!this.session)return;
    const reply=await this.session.send('Performance.getMetrics');
    if(epoch!==this.epoch||page!==i.page||i.recycling)return;
    const after=Object.fromEntries(reply.metrics.map(m=>[m.name,m.value]));
    const prior=this.previous;this.value=prior?measure(prior,after,Date.now()):null;this.previous=after;
    this.probe={state:this.value?'measured':prior?'unavailable':'baseline',at:Date.now(),roundTripMs:Date.now()-started,reason:this.value?'actual_renderer_metrics':prior?'invalid_or_overlong_metric_window':'awaiting_second_probe'};
   })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('runtime cost probe timeout')),this.timeoutMs);})]);
  }catch(e){await this.close();this.probe={state:'unavailable',at:Date.now(),roundTripMs:Date.now()-started,reason:e?.message==='runtime cost probe timeout'?'probe_timeout':'protocol_unavailable'};}finally{clearTimeout(timer);this.busy=false;}
 }
 view(now=Date.now()){return this.value&&now>=this.value.at&&now-this.value.at<45000?this.value:null;}
 status(){return {...this.probe,busy:this.busy,scope:'read_only_renderer_probe_not_process_cpu'};}
}
module.exports={measure,RuntimeCost};
