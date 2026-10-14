'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'logs/system-audit');
(async()=>{let good=0;const deadline=Date.now()+1800000;fs.writeFileSync(path.join(dir,'fleet-soak.json'),JSON.stringify({status:'waiting_for_team',at:Date.now(),longTermVerified:false,reason:'waiting for three fresh complete fleet samples'}));
 const release=JSON.parse(fs.readFileSync(path.join(dir,'architecture-release.json')));
 while(Date.now()<deadline&&good<3){try{const r=await fetch('http://127.0.0.1:4712/api/fleet',{signal:AbortSignal.timeout(25000)}),s=await r.json();good=s.complete&&s.online===6&&['windows','tum'].every(m=>s.machines[m]?.build===release.build)&&s.members.every(m=>m.online&&m.detailsFresh)?good+1:0;}catch{good=0;}if(good<3)await new Promise(r=>setTimeout(r,15000));}
 if(good<3){fs.writeFileSync(path.join(dir,'fleet-soak.json'),JSON.stringify({status:'blocked',at:Date.now(),longTermVerified:false,reason:'fresh complete team not established within 30 minutes'}));return;}
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/soak-fleet.js','--hours=2'],{cwd:root,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('acceptance recorder exited '+code)));});
 const fleet=require('../machines/fleet.json');if(!/^[\w.@-]+$/.test(fleet.ssh.host)||!/^\/[\w/.-]+$/.test(fleet.ssh.exchange))throw Error('Invalid telemetry mirror target');const destination=fleet.ssh.host+':'+path.posix.dirname(path.posix.dirname(fleet.ssh.exchange))+'/logs/system-audit/fleet-soak.json';await new Promise((resolve,reject)=>{const child=spawn('scp',['-q',path.join(dir,'fleet-soak.json'),destination],{cwd:root,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('acceptance mirror failed')));});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
