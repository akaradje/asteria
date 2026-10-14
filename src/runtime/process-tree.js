'use strict';
const fs=require('fs'),{execFile}=require('child_process');
function descendants(pid,platform=process.platform){
 if(platform==='win32')return [];
 const parents=new Map();
 try{for(const entry of fs.readdirSync('/proc'))if(/^\d+$/.test(entry)){try{const stat=fs.readFileSync(`/proc/${entry}/stat`,'utf8');parents.set(+entry,+stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]);}catch{}}}catch{}
 const out=[],seen=new Set([pid]);let changed=true;while(changed){changed=false;for(const[p,parent]of parents)if(seen.has(parent)&&!seen.has(p)){seen.add(p);out.push(p);changed=true;}}
 return out.reverse();
}
async function terminateTree(pid,{platform=process.platform,kill=(p,s)=>process.kill(p,s),list=descendants,exec=execFile}={}){
 if(!Number.isInteger(pid)||pid<=1||pid===process.pid)throw Error('invalid child pid');
 if(platform==='win32')return new Promise((resolve,reject)=>exec('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true},e=>{
  // A child may exit between taskkill's enumeration and termination. Check the root,
  // rather than interpreting localized child errors as a failed root cleanup.
  try{kill(pid,0);}catch(probe){if(probe.code==='ESRCH'){resolve({terminated:true,alreadyExited:!!e});return;}reject(e||probe);return;}
  reject(e||Error('process root still running after taskkill'));
 }));
 const tree=[...list(pid,platform),pid];
 for(const p of tree){try{kill(p,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
 await new Promise(r=>setTimeout(r,500));
 for(const p of tree){try{kill(p,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
}
module.exports={terminateTree,descendants};
