'use strict';
const fs=require('fs'),path=require('path');
const base=path.join(__dirname,'../logs/personal-history'),rows=[];
if(fs.existsSync(base))for(const id of fs.readdirSync(base)){const dir=path.join(base,id);if(!fs.statSync(dir).isDirectory())continue;for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))){const d=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')),last=d.snapshots.at(-1);rows.push({character:d.character,machine:d.machine,day:d.day,recordedAt:d.recordedAt,snapshots:d.snapshots.length,events:d.events.length,minutes:Object.keys(d.minutes).length,lastSnapshotAt:last?.at||null,build:last?.build||null});}}
console.log(JSON.stringify(rows));
