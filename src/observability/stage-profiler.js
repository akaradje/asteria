'use strict';
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
class StageProfiler{
 constructor(){this.rows=new Map();this.loop=monitorEventLoopDelay({resolution:20});this.loop.enable();this.previous={at:performance.now(),cpu:process.cpuUsage()};}
 begin(){return {at:performance.now(),cpu:process.cpuUsage(),rss:process.memoryUsage().rss,io:process.resourceUsage()};}
 end(kind,before){const wallMs=performance.now()-before.at,cpu=process.cpuUsage(before.cpu),io=process.resourceUsage();let r=this.rows.get(kind);if(!r){if(this.rows.size>=32)this.rows.delete(this.rows.keys().next().value);r={kind,count:0,samples:[]};this.rows.set(kind,r);}r.count++;r.samples.push({at:Date.now(),wallMs,cpuMs:(cpu.user+cpu.system)/1000,rssDeltaMb:(process.memoryUsage().rss-before.rss)/1048576,blockIn:io.fsRead-before.io.fsRead,blockOut:io.fsWrite-before.io.fsWrite});r.samples=r.samples.slice(-32);}
 view(){if(this.cached&&Date.now()-this.cached.at>=0&&Date.now()-this.cached.at<10000)return this.cached;const now=performance.now(),cpu=process.cpuUsage(this.previous.cpu),elapsed=now-this.previous.at;const processCpuPct=elapsed>0?(cpu.user+cpu.system)/1000/elapsed*100:null;this.previous={at:now,cpu:process.cpuUsage()};const finite=n=>Number.isFinite(n)?n:null;const memory=process.memoryUsage();const out={at:Date.now(),processCpuPct,rssMb:memory.rss/1048576,heapMb:memory.heapUsed/1048576,eventLoop:{p95Ms:finite(this.loop.percentile(95)/1e6),maxMs:finite(this.loop.max/1e6)},stages:[...this.rows.values()].map(r=>({...r,samples:[...r.samples]})),scope:'controller_process_cpu_rss_io_inclusive_concurrent_stages_not_isolated_actor_cpu'};this.loop.reset();this.cached=out;return out;}
 close(){this.loop.disable();}
}
module.exports={StageProfiler};
