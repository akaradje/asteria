'use strict';
// Explicit whitelist: status/roster files may expand, so never export them wholesale.
const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..');
const read=p=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));}catch{return null;}};
const s=read('logs/status.json'),rawFleet=read('logs/fleet/view.json'),now=Date.now();
const f=rawFleet&&now-rawFleet.at>=-5000&&now-rawFleet.at<15000?rawFleet:null;
const report={checkedAt:new Date(now).toISOString(),statusAt:s?.at,statusAgeMs:s?.at?now-new Date(s.at).getTime():null,machine:s?.machine,freeMb:s?.freeMb,online:f?.online,complete:f?.complete,party:f?.party?{id:f.party.id,leader:f.party.leader,members:f.party.members,checkedAt:f.party.checkedAt}:null,members:f?.members?.map(m=>({machine:m.machine,slot:m.slot,charName:m.charName,baseJob:m.baseJob,status:m.status,online:m.online,partyId:m.partyId,map:m.map})),instances:s?.instances?.map(i=>({slot:i.slot,status:i.status,fps:i.fps,lastSaveAgo:i.lastSaveAgo,errors:i.errors,recycles:i.recycles,phase:i.runtimeV2?.phase,contextCount:i.runtimeV2?.contexts?.length})),longTermVerified:false};
const dir=path.join(root,'logs/system-audit');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'seamless-learning-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
