'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'logs/system-audit');
(async()=>{
 const release=JSON.parse(fs.readFileSync(path.join(dir,'architecture-release.json')));
 const mismatches=Object.entries(release.hashes).filter(([f,h])=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')!==h).map(([f])=>f);
 if(mismatches.length)throw Error('Release source changed: '+mismatches.join(', '));
 const read=async route=>{const r=await fetch('http://127.0.0.1:4712/api/'+route,{signal:AbortSignal.timeout(35000)});if(!r.ok)throw Error(route+' unavailable');return r.json();};
 const [fleet,academy]=await Promise.all([read('fleet'),read('academy')]);
 const members=academy.members.map(m=>({character:m.character,machine:m.machine,status:m.status,masteryFresh:m.masteryFresh,stages:m.mastery?.stages?.length||0,techniques:m.techniques?.length||0,loadoutPlans:m.operations?.loadouts?.activities?.length||0,freshnessObserver:!!m.operations?.stateFreshness,trialObserver:!!m.operations?.trial,resourceReservations:!!m.operations?.reservations,objectiveError:m.operations?.objectiveError||null,observationError:m.operations?.observationError||null,automaticTrialAllowed:m.operations?.release?.allowed===true}));
 if(!fleet.complete||fleet.online!==6||members.length!==6||members.some(m=>m.status!=='playing'||m.stages!==9||m.techniques!==8||m.loadoutPlans!==4||!m.freshnessObserver||!m.trialObserver||!m.resourceReservations||m.objectiveError||m.observationError))throw Error('Six-character architecture deployment not ready');
 if(['windows','tum'].some(m=>fleet.machines?.[m]?.build!==release.build))throw Error('Fleet build mismatch');
 const soak=JSON.parse(fs.readFileSync(path.join(dir,'fleet-soak.json')));
 const audit={at:Date.now(),build:release.build,releaseDeployedAt:release.deployedAt,localSourceHashesMatched:Object.keys(release.hashes).length,members,fleet: fleet.members.map(m=>({character:m.charName,machine:m.machine,online:m.online,detailsFresh:m.detailsFresh,fps:m.details?.fps,fpsFresh:m.details?.fpsFresh})),acceptance:{status:soak.status,startedAt:soak.startedAt,targetEndAt:soak.targetEndAt,samples:soak.samples,longTermVerified:soak.longTermVerified},limits:'Current deployment evidence only; two-hour acceptance and limited gameplay probes remain separate.'};
 fs.writeFileSync(path.join(dir,'architecture-deployment.json'),JSON.stringify(audit,null,2));
 fs.appendFileSync(path.join(dir,'deployments.jsonl'),JSON.stringify({at:audit.at,change:'architecture observations, activity results, trial, reservations, role loadouts, team workflow and release gates',build:audit.build,machines:['windows','tum'],farmRestart:true})+'\n');
 console.log(JSON.stringify({build:audit.build,sourceFiles:audit.localSourceHashesMatched,members:members.length,acceptance:audit.acceptance}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
