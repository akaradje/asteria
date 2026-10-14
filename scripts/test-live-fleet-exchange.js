
'use strict';
const fs=require('fs'),assert=require('assert/strict'),{sshCapture,encode,decode}=require('../src/runtime/fleet-transport');
const config=JSON.parse(fs.readFileSync('machines/fleet.json'));
function exchange(row){return new Promise((resolve,reject)=>sshCapture(['-n','-o','BatchMode=yes','-o','ConnectTimeout=5',config.ssh.host,'python3',config.ssh.exchange,encode(row)],{timeout:12000,maxBuffer:200000},(error,out)=>error?reject(error):resolve(decode(out))));}
(async()=>{const source=JSON.parse(fs.readFileSync('logs/fleet/local.json'));source.at=Date.now();const remote=await exchange(source);assert.equal(remote.machine,'tum');
for(const performance of [{fps:20,at:Date.now(),token:'fixture'},{fps:-1,at:Date.now()},{fps:'20',at:Date.now()}]){const bad=JSON.parse(JSON.stringify(source));bad.at=Date.now();bad.members[0].performance=performance;await assert.rejects(()=>exchange(bad));}
console.log('PASS real SSH exchange, explicit metric allowlist and invalid payload rejection');})().catch(e=>{console.error(e.message);process.exitCode=1;});
