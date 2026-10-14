'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),file=path.join(root,'logs/system-audit/fleet-soak.json');
try{const old=JSON.parse(fs.readFileSync(file));if(['running','waiting_for_team'].includes(old.status)&&Date.now()-(old.lastSample?.at||old.startedAt)<60000){console.log('Soak test already running or preparing');process.exit(0);}}catch{}
const out=fs.openSync(path.join(root,'logs/fleet-soak.out.log'),'a'),err=fs.openSync(path.join(root,'logs/fleet-soak.err.log'),'a');
const child=spawn(process.execPath,['scripts/prepare-fleet-soak.js'],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',out,err]});child.unref();fs.closeSync(out);fs.closeSync(err);console.log('External soak test waits for the complete team, then measures three hours');
