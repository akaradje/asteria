'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const groups={trials:['v3-contracts','v3-governor','training-route','system-version','mastery-system','v2-integration','knowledge-coherence'],'team-activities':['daily-team-activities','daily-dispatch','mechanics-flow','tower-team','activity-control'],'paid-actions':['v3-contracts','v3-progression','craft-review','wing-recipes','legendary-goal','equipment-ceiling','equipment-foundation'],cards:['v2-integration','equipment-ceiling'],'guild-war':['v2-integration'],boss:['boss-window','wing-team-helper','v2-integration']};
groups.boss.push('campaign-side-work','boss-feed');
function buildRelease(root,build,evidence,{now=Date.now}={}){
 const inventory=require('../src/knowledge/system-version').inventory(root),identity=require('../src/knowledge/loaded-source').capture(root,build);
 if(!identity.signature||identity.missing.length)throw Error('Current game sources incomplete');
 if(evidence?.kind==='V3.2_offline_checks_not_118_native_acceptance'&&(evidence.offlinePassed!==true||evidence.fullSourceChanged!==false||evidence.fullSourceRevision!==inventory.fullRevision||evidence.currentFullSourceRevision!==inventory.fullRevision||evidence.gameSourceChanged!==false||evidence.buildChanged!==false||evidence.gameSourceSignature!==identity.signature))throw Error('Current frozen farm/controller/web/AI and native source checks required');
 if(evidence?.build!==build||evidence.sourceRevision!==inventory.revision||!Array.isArray(evidence.rows)||!Number.isFinite(evidence.at)||now()-evidence.at<0||now()-evidence.at>3600000)throw Error('Current-build/current-code test evidence required');
 const rows=new Map(evidence.rows.map(r=>[r.suite,r]));
 function passed(names){return names.every(name=>{const r=rows.get(name),file=path.join(root,'scripts','test-'+name+'.js');return r?.exit===0&&!r.error&&fs.existsSync(file)&&r.testSha256===crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');});}
 const checks=Object.fromEntries(['cards','war','boss','activity','daily-activity','guild'].map(k=>[k,require('../src/knowledge/adapter-source').inspect(root,build,k)]));
 const economy=require('../src/economy'),cat=economy.loadCatalog(root,build),wiki=economy.loadWiki(root),development=require('../src/knowledge/development-source');
 const refine=cat.nativeSemanticContracts?.refine||{allowed:false,reason:'semantic contract unavailable'},enchant=development.check(root,build,'enchant',[],cat,wiki);let craft=false;try{craft=development.source(root,build,cat,'craft').recipes.length>0;}catch{}
 const features=Object.fromEntries(Object.entries(groups).map(([feature,names])=>{
  const marker=checks[feature==='guild-war'?'war':feature==='cards'?'cards':feature==='boss'?'boss':'activity'];
  // Exact paid-action handlers have separate review gates; token presence never
  // clears an unknown enchant/card/boss implementation or a gameplay probe.
  const sourceValidated=feature==='paid-actions'?refine.allowed&&craft:feature==='cards'||feature==='boss'?false:marker.allowed;
  return [feature,{sourceValidated,fixturePassed:passed(names),limitedProbePassed:false,requiredSuites:names,sourceEvidence:feature==='paid-actions'?'AST_structural_native_refine_and_craft; independent_cost_risk_receipt_gates':sourceValidated?'loaded_call_sites_and_guard_fixtures':'requires_current_handler_review',serverVerified:false}];
 }));
 const version=require('../src/knowledge/system-version').inspect(root,build);
 const release={version:2,build,deployedAt:now(),sourceRevision:inventory.revision,gameSourceHashes:identity.sourceHashes,features,checks,developmentChecks:{refine,enchant,craft},hashes:inventory.hashes,testEvidence:{at:evidence.at,machine:evidence.machine,sourceRevision:evidence.sourceRevision,suites:evidence.rows.map(r=>({suite:r.suite,exit:r.exit,testSha256:r.testSha256}))},knowledge:{wikiBuild:version.wikiBuild,encyclopedia:version.encyclopedia,domains:version.domains},acceptance:{durationHours:3,completePct:99.5,minFps:15,requiredCurrentBuild:true},limits:'Current data/source and actual fixture evidence. No soak or current-build gameplay probe is fabricated; guarded capabilities remain separately gated.'};
 if(evidence.kind==='V3.2_offline_checks_not_118_native_acceptance'){
  release.version=3;release.plan='V3.2';release.builtAt=release.deployedAt;release.deployedAt=null;
  release.protocols={registry:1,hostFeed:1,observation:1,durableSchema:1,capability:2};release.compatibility={crossHostMutation:'matching registry/hostFeed/observation/ledger protocol plus fresh identities required',rollback:'preserve DB and unknown intents; unsupported schema read-only/forward repair'};
  release.capabilities=require('../src/knowledge/capability-registry').registry(cat);release.stages={sourceChecks:evidence.offlinePassed===true?'PASSED':'INCOMPLETE',copies:[],loads:[],nativeOutcomes:[],soak3h:'NOT_RUN',soak24h:'NOT_RUN'};release.acceptance.requiredCoverage='each enabled action independently exercised';
 }
 fs.mkdirSync(path.join(root,'logs/system-audit'),{recursive:true});const file=path.join(root,'logs/system-audit/architecture-release.json');if(fs.existsSync(file))fs.copyFileSync(file,path.join(root,'logs/system-audit/architecture-release.previous.json'));fs.writeFileSync(file+'.tmp',JSON.stringify(release,null,2));fs.renameSync(file+'.tmp',file);return release;
}
if(require.main===module){try{const root=path.resolve(__dirname,'..'),build=process.argv.find(a=>a.startsWith('--build='))?.slice(8)||JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'))).build,arg=process.argv.find(a=>a.startsWith('--evidence='))?.slice(11);if(!arg)throw Error('Use --evidence=<actual current test report>');const r=buildRelease(root,build,JSON.parse(fs.readFileSync(path.resolve(root,arg))));console.log(JSON.stringify({build:r.build,files:Object.keys(r.hashes).length,sourceRevision:r.sourceRevision,features:r.features,automaticActivation:'await actual current-release acceptance and probes'}));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={buildRelease,groups};
