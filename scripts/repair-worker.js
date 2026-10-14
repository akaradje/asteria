'use strict';
// Dedicated process: slow model/container work never blocks the farm event loop.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),{RepairCoordinator}=require('../src/learning/repair-coordinator'),{RepairHost}=require('../src/learning/repair-host'),pipeline=require('../src/learning/repair-pipeline');
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const file='logs/ai-repair/worker.json';let busy=false;
function publish(row){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file)+'.tmp',JSON.stringify(row));fs.renameSync(path.join(root,file)+'.tmp',path.join(root,file));}
async function tick(){if(busy)return;busy=true;try{
 const policy=read('logs/ai-repair/policy.json');if(policy.enabled!==true){publish({at:Date.now(),state:'disabled'});return;}
 const host=new RepairHost(root,policy),c=new RepairCoordinator(root,host),status=fs.existsSync(path.join(root,file))?read(file):{};
 const active=c.data.jobs.some(j=>!['COMPLETE','REJECTED','ROLLED_BACK','SUPERSEDED'].includes(j.stage));
 if(!active&&Date.now()-(status.lastScanAt||0)>=1800000){
  const version=require('../src/knowledge/system-version').inventory(root),build=read('machines/fleet-client-release.json').build,checks=[];
  const incidents=require('../src/learning/progression-incidents').pending(root);const scan=incidents.length?incidents.map(r=>[r.file,pipeline.scopes[r.file]]):Object.entries(pipeline.scopes).filter(([f])=>require('../src/learning/repair-scope').pure.includes(f));
  for(const [target,tests]of scan){
   const packet=pipeline.packet(root,{id:'scoped-self-check',build,sourceRevision:version.revision,file:target,reproduction:incidents.find(r=>r.file===target)?{...incidents.find(r=>r.file===target),observed:'FAIL'}:{fixtureHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,tests[0]))).digest('hex'),observed:'FAIL'}});
   const id=crypto.createHash('sha256').update(JSON.stringify([build,version.revision,target,packet.beforeHash,packet.testHashes])).digest('hex');
   packet.reproduction.observed='UNTESTED';const result=await host.reproduce({id,file:target,packet});if(result.baselineFailed)packet.reproduction.observed='FAIL';checks.push({file:target,...result});if(result.baselineFailed)c.enqueue(packet);
  }
  status.lastScanAt=Date.now();status.checks=checks;
 }
 await c.tick();publish({...status,at:Date.now(),state:'running',host:policy.host,automaticDeploy:policy.automaticDeploy===true,scope:Object.keys(pipeline.scopes),repairs:c.view(),combatBenefitVerified:false});
}catch(e){publish({at:Date.now(),state:'blocked',reason:'repair_worker_step_failed',errorHash:crypto.createHash('sha256').update(String(e.message)).digest('hex')});}finally{busy=false;}}
tick();if(!process.argv.includes('--once'))setInterval(tick,15000);
