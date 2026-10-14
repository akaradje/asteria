'use strict';
const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const root=path.resolve(__dirname,'..'),file=path.join(root,'logs/system-audit/windows-farm-recovery.json');
function decision(health,status,{stopMarker=false,processes=[],now=Date.now(),attempts=[]}={}){
 if(health?.service!=='asteria-panel'||health.running||status?.running)return 'no-action';
 if(stopMarker)return 'stop-marker-present';
 if(!/^process cleanup failed:/.test(status?.error||''))return 'no-action';
 if(processes.length)return 'existing-farm-process';
 if(attempts.filter(at=>now>=at&&now-at<900000).length>=3)return 'recovery-limit';
 return 'start';
}
async function managedProcesses(){return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts[/\\\\]run\\.js' } | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress"],{windowsHide:true,timeout:10000},(e,out)=>{if(e)return reject(e);try{const v=out.trim()?JSON.parse(out):[];resolve(Array.isArray(v)?v:[v]);}catch{reject(Error('Cannot verify existing farm processes'));}}));}
async function request(route,body){const response=await fetch('http://127.0.0.1:4711/api/'+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Local panel request rejected');return response.json();}
async function main(){let data;try{data=JSON.parse(fs.readFileSync(file));}catch{data={attempts:[],history:[]};}
 const save=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);};
 for(;;){try{
  const health=await request('panel-health');let state='no-action';
  if(health.service==='asteria-panel'&&!health.running){const status=await request('status');state=decision(health,status,{stopMarker:fs.existsSync(path.join(root,'logs/.stop')),attempts:data.attempts});if(state==='start')state=decision(await request('panel-health'),status,{stopMarker:fs.existsSync(path.join(root,'logs/.stop')),processes:await managedProcesses(),attempts:data.attempts});
   if(state==='start'){data.attempts=[Date.now(),...data.attempts].slice(0,20);save();const result=await request('start',{n:3,god:true,nodraw:true,autoBuild:true});state=result.ok?'start-requested':'start-rejected';data.history.unshift({at:Date.now(),action:state,reason:'cleanup failure with no surviving farm process',pid:result.ok?result.pid:null});data.history=data.history.slice(0,60);}
  }
  data.status=state;data.checkedAt=Date.now();delete data.error;save();
 }catch(e){data.status='check-failed';data.error=String(e.message).slice(0,120);data.checkedAt=Date.now();save();}
 await new Promise(r=>setTimeout(r,15000));}
}
if(require.main===module)main().catch(()=>{process.exitCode=1;});
module.exports={decision,managedProcesses};
