'use strict';
const {sshCapture}=require('../src/runtime/fleet-transport');
const fleet=require('../machines/fleet.json');
const code=`const fs=require('fs'),crypto=require('crypto');const r=JSON.parse(fs.readFileSync('logs/system-audit/architecture-release.json'));const mismatches=Object.entries(r.hashes).filter(([p,h])=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h).map(([p])=>p);console.log(JSON.stringify({build:r.build,files:Object.keys(r.hashes).length,mismatches}));if(mismatches.length)process.exitCode=1;`;
const encoded=Buffer.from(code).toString('base64');
sshCapture(['-n','-o','BatchMode=yes',fleet.ssh.host,`cd /opt/asteria-node-a/asteria && node -e 'eval(Buffer.from("${encoded}","base64").toString())'`],{timeout:20000},(error,result)=>{if(error){console.error(error.message);process.exitCode=1;}else console.log(result.trim());});
