'use strict';
const assert=require('node:assert/strict'),{assess}=require('../src/learning/policy-evidence'),{decision}=require('../src/learning/provider-routing');
const scope={actorId:'a',build:'b',signature:'s',candidate:'route',now:1000},rows=Array.from({length:60},(_,n)=>({...scope,id:String(n),finishedAt:900,status:'accepted',candidateCoverage:1,baselineRate:100,candidateRate:200,minimumGain:.2}));
assert.equal(assess(rows.slice(0,3),scope).state,'INCONCLUSIVE');assert.equal(assess(rows,{...scope,actorId:'other'}).comparableCycles,0);assert.equal(assess([...rows,{...rows[0],id:'death',status:'safety_abort'}],scope).state,'REJECTED');assert.equal(assess(rows,scope).executable,false);assert.equal(assess([...rows,...rows],scope).cycles,60);
const p={ok:true,provider:'meta',model:'m'},b={evidenceValidated:true,version:1,provider:'meta',model:'m',contractRevision:'r',at:900,stage:'held_out_provider_observed',independentCases:30,invalidActions:0,identityFailures:0,staleDispatches:0,accuracy:.99,effectEvaluation:'verified_no_regression',evidenceHashes:['a'.repeat(64),'b'.repeat(64)]},input={planner:p,judge:{ok:false},action:'review_route',benchmark:b,revision:'r',now:1000};
assert(decision(input).allowed);assert(!decision({...input,benchmark:{...b,evidenceValidated:false}}).allowed);assert(!decision({...input,action:'recover'}).allowed);assert(!decision({...input,benchmark:{...b,effectEvaluation:'unknown'}}).allowed);assert(!decision({...input,planner:{...p,model:'changed'}}).allowed);assert(!decision({...input,revision:'new'}).allowed);assert(!decision({...input,benchmark:null}).allowed);assert.equal(decision({...input,action:'observe'}).route,'local');
console.log('PASS exact-context policy negatives/dedup/censoring and evidence-bound provider routing/fallback');
{
 const member={actorId:'actor-'+'a'.repeat(32),build:'b',status:'playing',busy:false,saveAgeSeconds:2,noProgressSeconds:300,level:120,personalBrain:{availableFocuses:['focus_craft','focus_income','focus_growth'],lowFunds:false,milestones:{stage:'equipment'}}};
 const proposal={version:2,actorId:member.actorId,build:'b',maxSpend:0,at:900,expiresAt:120900,evidenceIds:[member.actorId+':goal:fixture'],stopRule:{maxActiveMs:180000,maxDeaths:0,stopOnUncertain:true}};
 const single={planner:p,judge:{ok:true,action:'continue',confidence:.2},action:'focus_craft',member,proposal,now:1000};
 assert.equal(decision(single).route,'bounded_planner');
 assert(decision({...single,member:{...member,busy:true}}).allowed,'busy actor may queue zero-spend focus');assert(!decision({...single,action:'review_route',member:{...member,busy:true}}).allowed,'route action cannot steal owner');
 for(const patch of [{saveAgeSeconds:31},{actorId:'other'},{build:'other'},{recovery:{blockedNodes:['health']}}])assert(!decision({...single,member:{...member,...patch}}).allowed);
 assert(decision({...single,member:{...member,noProgressSeconds:0}}).allowed,'AI strategic authority does not require a stalled actor');
 assert(!decision({...single,action:'review_route',member:{...member,noProgressSeconds:0}}).allowed,'corrective route review still requires stalled evidence');
 for(const patch of [{maxSpend:1},{expiresAt:undefined},{expiresAt:999},{evidenceIds:['other:goal']},{stopRule:{maxActiveMs:999999,maxDeaths:0,stopOnUncertain:true}}])assert(!decision({...single,proposal:{...proposal,...patch}}).allowed);
 for(const action of ['focus_income','focus_growth','recover','sell','execute'])assert(!decision({...single,action}).allowed);
 assert(decision({...single,action:'review_route'}).allowed);
 assert(decision({...single,member:{...member,recovery:{blockedNodes:['execute']}}}).allowed,'strategy intent is not payment authority');
 assert(!decision({...single,action:'review_route',member:{...member,recovery:{blockedNodes:['execute']}}}).allowed);
 assert(decision({...single,member:{...member,independentStrategy:true,recovery:{blockedNodes:['execute']}}}).allowed);
 assert(!decision({...single,member:{...member,independentStrategy:true,recovery:{blockedNodes:['health']}}}).allowed);
 assert(!decision({...single,planner:{ok:false}}).allowed);
 console.log('PASS autonomous strategy with dissent, exact actor/build, freshness, stop budget and no new spend authority');
}

const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{load}=require('../src/learning/provider-routing');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'provider-proof-'));
try{
 fs.mkdirSync(path.join(root,'logs/system-audit'),{recursive:true});
 const artifacts=[{stage:'native_provider_held_out',independentCases:30,invalidActions:0,identityFailures:0,staleDispatches:0,accuracy:.99},{stage:'native_effect_evaluation',result:'verified_no_regression'}];
 const refs=artifacts.map((e,n)=>{const bytes=JSON.stringify({...e,provider:'meta',model:'m',contractRevision:'r',at:890}),p='logs/system-audit/e'+n+'.json';fs.writeFileSync(path.join(root,p),bytes);return {path:p,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 fs.writeFileSync(path.join(root,'logs/ai-routing-benchmark.json'),JSON.stringify({...b,evidence:refs}));assert(load(root)?.evidenceValidated);
 fs.writeFileSync(path.join(root,refs[0].path),'{}');assert.equal(load(root),null,'tampered evidence must invalidate routing');
}finally{fs.rmSync(root,{recursive:true,force:true});}
