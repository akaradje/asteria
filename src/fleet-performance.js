'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
function cpu(){return os.cpus().reduce((a,c)=>{a.idle+=c.times.idle;a.total+=Object.values(c.times).reduce((n,x)=>n+x,0);return a;},{idle:0,total:0});}
class FleetPerformance{
 constructor(root){this.file=path.join(root,'logs/fleet-performance.json');try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={samples:[],allReadyMs:0,observedMs:0};}this.prev=null;this.cpu=cpu();this.pressure=0;}
 sample(instances,count,freeMb,now=Date.now()){
  if(this.prev&&now-this.prev<5000)return this.data.current;
  const c=cpu(),delta=c.total-this.cpu.total,usage=delta>0?100*(1-(c.idle-this.cpu.idle)/delta):null;this.cpu=c;
  const rows=instances.filter(Boolean),ready=rows.filter(i=>i.status==='playing'&&!i.recycling&&now-i.lastSaveAt>=0&&now-i.lastSaveAt<30000),fps=ready.filter(i=>i.v2?.observation?.nativeBotConsole!==true&&(!i.runtimeV2||(Number.isFinite(i.lastFpsAt)&&now-i.lastFpsAt>=0&&now-i.lastFpsAt<15000))).map(i=>i.lastFps).filter(n=>Number.isFinite(n)&&n>=0),dt=this.prev?now-this.prev:0;this.prev=now;
  if(dt>0&&dt<90000){this.data.observedMs+=dt;if(this.previousAll&&ready.length===count)this.data.allReadyMs+=dt;}this.previousAll=ready.length===count;
  const loopSamples=rows.map(i=>i.v2?.scheduler?.profiler?.view?.()).filter(p=>Number.isFinite(p?.at)&&now>=p.at&&now-p.at<15000).map(p=>p.eventLoop?.p95Ms).filter(Number.isFinite);
  const eventLoopP95Ms=loopSamples.length?Math.max(...loopSamples):null;
  const stressed=freeMb<1500||usage>85||eventLoopP95Ms>=200||(fps.length&&Math.min(...fps)<20);this.pressure=stressed?Math.min(5,this.pressure+1):Math.max(0,this.pressure-1);
  const tickMs=this.pressure>=2?8000:5000;
  for(const i of rows){
   i.resourcePressure ||= new(require('./runtime/resource-pressure').ResourcePressure)();
   const profile=i.resourcePressure.observe(i,now,this.pressure);
   if(profile&&i.noDraw)i.pendingResourceProfile=profile;
  }
  const s={at:now,freeMb,cpuPct:usage,eventLoopP95Ms,pressure:this.pressure,playing:ready.length,count,minFps:fps.length?Math.min(...fps):null,fpsSamples:fps.length,heapMB:rows.reduce((n,i)=>n+(i.lastHeapMB||0),0),recycles:rows.reduce((n,i)=>n+(i.recycles||0),0),tickMs};
  this.data.samples.push(s);this.data.samples=this.data.samples.slice(-2880);this.data.current=s;
  fs.mkdirSync(path.dirname(this.file),{recursive:true});this.persistence=require('./runtime/telemetry-file').writeTelemetry(this.file,this.data);return s;
 }
}
module.exports={FleetPerformance};
