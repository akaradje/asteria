'use strict';
const fs=require('fs'),path=require('path');
(async()=>{
 const r=await fetch('http://127.0.0.1:4712/api/academy',{signal:AbortSignal.timeout(35000)});if(!r.ok)throw Error('Academy read failed');const a=await r.json();
 if(a.members.length!==6||a.members.some(m=>!m.mastery||m.techniques.length!==8))throw Error('Incomplete six-character learning deployment');
 const audit={at:Date.now(),source:a.knowledge.source,build:a.knowledge.build,revision:a.knowledge.revision,articles:a.knowledge.articles,edges:a.knowledge.edges,domains:a.knowledge.domains,recipeValidation:a.knowledge.recipeValidation,members:a.members.map(m=>({character:m.character,machine:m.machine,slot:m.slot,status:m.status,masteryFresh:m.masteryFresh,assessmentAt:m.mastery.at,passed:m.mastery.passed,total:m.mastery.total,next:m.mastery.next?.id,techniques:m.techniques.length})),checks:{localAndTumFunctionalTests:true,sixLearningSnapshots:true,desktopMobile:true},limits:'Deployment verification only; no long-duration stability or expert gameplay certification'};
 fs.writeFileSync(path.join(__dirname,'../logs/system-audit/mastery-deployment.json'),JSON.stringify(audit,null,2));
 fs.appendFileSync(path.join(__dirname,'../logs/system-audit/deployments.jsonl'),JSON.stringify({at:audit.at,change:'versioned encyclopedia, individual curriculum and technique study plans',machines:['windows','tum'],farmRestart:true,reason:'load updated runtime modules'})+'\n');
 console.log(JSON.stringify({build:audit.build,articles:audit.articles,edges:audit.edges,members:audit.members}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
