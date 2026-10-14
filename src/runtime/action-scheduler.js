'use strict';
const {AsyncLocalStorage}=require('async_hooks');
const crypto=require('crypto');
class ActionScheduler {
  constructor({now=Date.now,maxQueued=64}={}){this.now=now;this.monotonic=now===Date.now?()=>performance.now():now;this.maxQueued=maxQueued;this.context=new AsyncLocalStorage();this.queue=[];this.active=null;this.closed=false;this.rejected=0;this.timings=new Map();}
  record(kind,startedAt,queueMs,ok){const name=/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(kind||'')?kind:'other';let r=this.timings.get(name);if(!r){if(this.timings.size>=16)this.timings.delete(this.timings.keys().next().value);r={kind:name,count:0,failed:0,rows:[]};this.timings.set(name,r);}r.count++;r.failed+=Number(!ok);r.at=this.now();r.lastMs=Math.max(0,r.at-startedAt);r.queueMs=Math.max(0,queueMs);r.rows.push(r.lastMs);if(r.rows.length>64)r.rows.shift();}
  validate(contract){if(!contract)return;const now=this.now();if(contract.deadline<=now)throw Error('action contract expired');const verdict=contract.validate?.(now);if(verdict===false||verdict?.allowed===false){const e=Error('action contract rejected: '+(verdict?.reason||'preconditions changed'));if(['fresh_save_required','fresh_position_required'].includes(verdict?.reason)){e.code='ASTERIA_STALE_PRECONDITION';e.reason=verdict.reason;}throw e;}}
  run(kind,fn,{priority=5,leaseMs=180000,maxDurationMs=900000,maxQueueAgeMs=180000,contract}={}){
    const owner=this.context.getStore();
    if(owner&&(owner===this.active||owner.job===this.active)){if(owner.controller.signal.aborted)return Promise.reject(Error('action cancelled'));return Promise.resolve().then(()=>{this.validate(contract);return this.context.run({...owner,job:owner.job||owner,parent:owner,contract},async()=>{const start=this.now(),metrics=this.profiler?.begin();let ok=false;try{const result=await fn(owner.controller.signal);ok=true;return result;}finally{this.record(kind,start,0,ok);if(metrics)this.profiler.end(kind,metrics);}});});}
    if(this.closed)return Promise.reject(Error('scheduler stopped'));
    if(this.queue.length>=this.maxQueued){this.rejected++;return Promise.reject(Error('action queue capacity exceeded'));}
    return new Promise((resolve,reject)=>{this.queue.push({id:crypto.randomUUID(),kind,fn,priority,leaseMs,maxDurationMs,maxQueueAgeMs,contract,queuedAt:this.now(),queuedMono:this.monotonic(),resolve,reject});this.queue.sort((a,b)=>a.priority-b.priority||a.queuedAt-b.queuedAt);this.drain();});
  }
  async drain(){
    if(this.active||this.closed)return;
    const job=this.queue.shift();if(!job)return;
    job.startedAt=this.now();job.startedMono=this.monotonic();job.hardMono=job.startedMono+job.maxDurationMs;job.leaseMono=Math.min(job.startedMono+job.leaseMs,job.hardMono);job.hardDeadline=job.startedAt+job.maxDurationMs;job.deadline=Math.min(job.startedAt+job.leaseMs,job.hardDeadline);job.controller=new AbortController();this.active=job;
    const metrics=this.profiler?.begin();let ok=false;try{if(this.monotonic()-job.queuedMono>=job.maxQueueAgeMs)throw Error('queued action expired');this.validate(job.contract);const result=await this.context.run(job,()=>job.fn(job.controller.signal));ok=true;job.resolve(result);}catch(e){this.rejected++;job.reject(e);}finally{this.record(job.kind,job.startedAt,job.startedAt-job.queuedAt,ok);if(metrics)this.profiler.end(job.kind,metrics);this.active=null;this.drain();}
  }
  cancel(reason='stopped'){this.closed=true;this.active?.controller.abort(reason);for(const j of this.queue.splice(0))j.reject(Error(reason));this.profiler?.close();}
  checkpoint(){const owner=this.context.getStore();if(owner?.controller.signal.aborted)throw Error('action cancelled');if(owner&&this.monotonic()>=(owner.job||owner).hardMono){owner.controller.abort('action duration exceeded');throw Error('action duration exceeded: '+owner.kind);}for(let frame=owner;frame;frame=frame.parent)this.validate(frame.contract);if(owner){const job=owner.job||owner;job.leaseMono=Math.min(this.monotonic()+job.leaseMs,job.hardMono);job.deadline=Math.min(this.now()+job.leaseMs,job.hardDeadline);}}
  yieldOptionalNavigation(){const owner=this.context.getStore();if(owner?.kind==='tick'&&this.queue.some(j=>j.kind.startsWith('fleet-')&&j.priority<owner.priority)){owner.controller.abort('mandatory team navigation');throw Error('optional navigation yielded to mandatory team activity');}}
  view(){const a=this.active;return {state:a?'busy':this.closed?'stopped':'idle',active:a?{id:a.id,kind:a.kind,startedAt:a.startedAt,ageMs:Math.max(0,this.now()-a.startedAt),deadline:a.deadline,overdue:this.now()>a.deadline}:null,queued:this.queue.map(j=>({kind:j.kind,queuedAt:j.queuedAt})),timings:[...this.timings.values()].map(r=>{const sorted=[...r.rows].sort((a,b)=>a-b);return {kind:r.kind,count:r.count,failed:r.failed,at:r.at,lastMs:r.lastMs,queueMs:r.queueMs,p95Ms:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)],samples:sorted.length};}),scope:'wall_time_inclusive_nested_actions_not_cpu_time'};}
}
module.exports={ActionScheduler};
