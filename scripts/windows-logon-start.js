'use strict';
// One-shot logon intent. The resident guardian must never clear a manual stop.
const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
async function resume(io){
 const previousStop=io.readStop();
 if(previousStop!==null)io.clearStop(previousStop);
 // A new stop supersedes the logon request, including while services boot.
 if(io.readStop()!==null)return {state:'user-stopped'};
 await io.guardian();
 for(let attempt=0;attempt<12;attempt++){
  if(io.readStop()!==null)return {state:'user-stopped'};
  const health=await io.health();
  if(health&&health.service!=='asteria-panel')throw Error('Unexpected service on port 4711');
  if(health?.running)return {state:'already-running'};
  if(health){
   if(io.readStop()!==null)return {state:'user-stopped'};
   let sent=false;
   try{const result=await io.start();sent=result?.ok===true;}catch{/* Reconcile once; never send a second start after timeout. */}
   if(io.readStop()!==null)return {state:'user-stopped'};
   const observed=await io.health();
   if(observed?.service==='asteria-panel'&&observed.running)return {state:'running',startAccepted:sent};
   return {state:'start-unconfirmed',startAccepted:sent};
  }
  await io.wait();
 }
 return {state:'panel-unavailable'};
}
async function main(){
 if(process.platform!=='win32')throw Error('Windows logon launcher requires Windows');
 const root=path.resolve(__dirname,'..'),stop=path.join(root,'logs','.stop');
 const readStop=()=>{try{return fs.readFileSync(stop,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const request=async(route,body)=>{
  const r=await fetch('http://127.0.0.1:4711/api/'+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Panel HTTP '+r.status);return r.json();
 };
 const guardian=()=>new Promise((resolve,reject)=>{
  const command="$t=Get-ScheduledTask -TaskName 'Asteria External Team' -ErrorAction Stop; if($t.Actions.WorkingDirectory -ne (Get-Location).Path -or $t.Actions.Arguments -notlike '*asteria\\scripts\\external-guardian.ps1*'){throw 'Guardian identity mismatch'}; if($t.State -ne 'Running'){Start-ScheduledTask -TaskName $t.TaskName}";
  execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{cwd:root,windowsHide:true,timeout:15000},e=>e?reject(Error('Existing guardian unavailable')):resolve());
 });
 const config=require('../machines/windows/config.json').args;
 const at=new Date().toISOString();
 let result;
 try{result=await resume({readStop,clearStop:old=>{if(readStop()===old)fs.unlinkSync(stop);},guardian,
  health:async()=>{try{return await request('panel-health');}catch(e){if(e.cause?.code==='ECONNREFUSED'||e.name==='TimeoutError')return null;throw e;}},
  start:()=>request('start',{n:config.n,god:!!config.god,nodraw:true}),wait:()=>new Promise(r=>setTimeout(r,5000))});
 }catch(e){result={state:'failed',reason:e.message};}
 const file=path.join(root,'logs/system-audit/windows-logon-start.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify({at,completedAt:new Date().toISOString(),...result},null,2));
 console.log(JSON.stringify(result));
 if(['failed','panel-unavailable','start-unconfirmed'].includes(result.state))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={resume};
