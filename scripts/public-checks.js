'use strict';
const cp=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..');
require('./setup-public-examples').setup();
// Explicit offline fixtures only; never enumerate arbitrary/live test scripts.
const suites=['panel-security','public-team-view','brain-dependency-time','v32-durable','v32-notices','v32-lifecycle','v32-authority-rpc','host-team-scope','trade-journal-history','native-outcome-recovery','authorized-grandmaster','purchase-rebase','telemetry-recovery','closed-gear-scope','fresh-refine-attempt','ai-advisor','material-budget-recovery','trade-budget-lifecycle','trade-no-dispatch','combat-progression-recovery'];
let failed=0;
for(const suite of suites){
 const r=cp.spawnSync(process.execPath,['scripts/test-'+suite+'.js'],{cwd:root,encoding:'utf8',timeout:90000,windowsHide:true});
 console.log((r.status===0?'PASS ':'FAIL ')+suite);
 if(r.status!==0){failed++;process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');}
}
console.log(JSON.stringify({suites:suites.length,passed:suites.length-failed,failed,liveGameActions:false}));
if(failed)process.exitCode=1;
