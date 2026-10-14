'use strict';
// One controller-owned restart lane. After a burst of failures, probe the
// ordinary HTTPS health endpoint before attempting another farm launch.
class ControllerRecovery{
 constructor({allowed,revision,probe,start,report=()=>{},now=Date.now,schedule=setTimeout,cancel=clearTimeout}){Object.assign(this,{allowed,revision,probe,start,report,now,schedule,cancel});this.attempts=0;this.timer=null;this.epoch=0;this.state={state:'idle'};}
 reset(){this.epoch++;if(this.timer)this.cancel(this.timer);this.timer=null;this.attempts=0;this.state={state:'idle',at:this.now()};}
 request(reason){
  if(!this.allowed()||this.timer||this.busy)return;
  const attempt=++this.attempts,halfOpen=attempt>20,delay=halfOpen?300000:Math.min(60000,5000*attempt),epoch=this.epoch,revision=this.revision();
  const valid=()=>this.epoch===epoch&&this.revision()===revision&&this.allowed();
  this.state={state:halfOpen?'cooldown':'retry_wait',at:this.now(),attempt,nextAt:this.now()+delay,reason};this.report(this.state);
  this.timer=this.schedule(async()=>{
   this.timer=null;if(!valid())return;this.busy=true;let retry=null;
   try{
    if(halfOpen){this.state={...this.state,state:'probing',at:this.now()};this.report(this.state);const healthy=await this.probe();if(!valid())return;if(!healthy){retry='server_health_unavailable';return;}}
    if(!valid())return;
    const result=this.start();if(result?.ok===false){retry='start_refused';return;}
    this.state={state:'start_requested',at:this.now(),attempt,confirmed:false};this.report(this.state);
   }catch{retry='readiness_or_start_failed';}finally{this.busy=false;if(retry&&valid())this.request(retry);}
  },delay);this.timer?.unref?.();
 }
 view(){return {...this.state};}
}
module.exports={ControllerRecovery};
