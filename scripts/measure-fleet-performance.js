'use strict';
const fs=require('fs'),path=require('path');
const output=path.resolve(__dirname,'../logs/system-audit/performance-smoke.json');
(async()=>{const startedAt=Date.now(),samples=[];for(let i=0;i<8;i++){
 try{const fleet=await(await fetch('http://127.0.0.1:4712/api/fleet',{signal:AbortSignal.timeout(25000)})).json();samples.push({at:Date.now(),complete:fleet.complete,online:fleet.online,machines:Object.fromEntries(Object.entries(fleet.machines).map(([key,m])=>[key,{build:m.build,host:m.host}])),members:fleet.members.map(m=>({name:m.charName,job:m.job,lv:m.lv,party:m.partyId,fresh:m.detailsFresh,fps:m.details?.fps,errors:m.details?.errors,bagTier:m.details?.bagTier,capacity:m.details?.bagCapacity}))});}catch(e){samples.push({at:Date.now(),error:e.message});}
 fs.writeFileSync(output,JSON.stringify({startedAt,status:i===7?'completed':'running',finishedAt:i===7?Date.now():null,samples},null,2));if(i<7)await new Promise(r=>setTimeout(r,15000));
}})().catch(e=>{console.error(e.message);process.exitCode=1;});
