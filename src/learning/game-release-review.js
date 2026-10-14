'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
function permitted(root,request){
 const intent=read(path.join(root,'logs/host-intent.json')),ai=read(path.join(root,'logs/ai-auto.json'));
 if(intent.mode!=='running'||intent.revision!==request.intentRevision||ai.enabled!==true)throw Error('AI or operator intent changed; preserve stop');
 const v=require('../knowledge/system-version').inventory(root);
 if(v.revision!==request.sourceRevision)throw Error('Application source changed during review');
 return v;
}
function promotionFiles(stage,release){
 const entries=[...release.files,...release.dependencies].map(f=>({path:'cache/'+release.build+'/'+require('../assetcache').keyFor(f.url),hash:f.sha256}));
 entries.push({path:'cache/'+release.build+'/asteria-online.io/_root.json'});
 entries.push(...['data/wiki.json','machines/fleet-client-release.json','logs/system-audit/architecture-release.json'].map(p=>({path:p})));
 return entries.map(e=>{const file=path.resolve(stage,e.path);if(!file.startsWith(path.resolve(stage)+path.sep)||fs.lstatSync(file).isSymbolicLink())throw Error('Public promotion path invalid');const bytes=fs.readFileSync(file);if(e.hash&&sha(bytes)!==e.hash)throw Error('Public source changed after tests');return {...e,hash:sha(bytes),bytes};});
}
async function promote(root,stage,request,{confirm,now=Date.now,beforeCopy=()=>{}}={}){
 const before=permitted(root,request),report=read(path.join(stage,'logs/system-audit/v32-checks-current.json')),release=read(path.join(stage,'machines/fleet-client-release.json')),manifest=read(path.join(stage,'logs/system-audit/architecture-release.json'));
 const staged=require('../knowledge/system-version').inventory(stage),identity=require('../knowledge/loaded-source').capture(stage,release.build);
 const suites=require('../../scripts/v32-checks').suites;
 if(!report.offlinePassed||report.failed!==0||!Number.isFinite(report.at)||now()-report.at<0||now()-report.at>3600000||report.rows.length!==suites.length||new Set(report.rows.map(r=>r.suite)).size!==suites.length||report.rows.some(r=>!suites.includes(r.suite)||r.exit!==0||r.error||r.testSha256!==sha(fs.readFileSync(path.join(stage,'scripts/test-'+r.suite+'.js')))||r.testSha256!==sha(fs.readFileSync(path.join(root,'scripts/test-'+r.suite+'.js'))))||report.sourceRevision!==before.revision||report.fullSourceRevision!==before.fullRevision||staged.fullRevision!==before.fullRevision||report.gameSourceSignature!==identity.signature||manifest.sourceRevision!==before.revision||manifest.build!==release.build||manifest.stages?.sourceChecks!=='PASSED'||release.build!==request.build)throw Error('Current immutable complete test evidence required');
 const live=await confirm();if(!live?.ok||live.build!==release.build||['client','world','network'].some(k=>live.sourceHashes?.[k]!==identity.sourceHashes[k]))throw Error('Server changed after tests');
 require('../runtime/fleet-client-release').inspect(stage,live);
 const semantic=require('../runtime/semantic-release').inspect(stage,release.build);if(!semantic.autoApproved)throw Error('Native transaction contract changed; affected domains require a safe implementation');
 const files=promotionFiles(stage,release);beforeCopy();if(permitted(root,request).fullRevision!==before.fullRevision)throw Error('App bytes changed before promotion');
 // Keep the old manifest/pin and every original byte. Publish the new manifest
 // last so an interrupted copy cannot approve a half-published release.
 const dir=path.join(root,'logs/ai-system/backups',String(now()));fs.mkdirSync(dir,{recursive:true});
 const rollback=[];
 try{for(const entry of files){const target=path.join(root,entry.path),backup=path.join(dir,entry.path),existed=fs.existsSync(target);fs.mkdirSync(path.dirname(target),{recursive:true});if(existed){fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(target,backup);}rollback.push({target,backup,existed});fs.writeFileSync(target+'.review-tmp',entry.bytes);fs.renameSync(target+'.review-tmp',target);if(sha(fs.readFileSync(target))!==entry.hash)throw Error('Promotion readback differs');}}
 catch(error){for(const row of rollback.reverse()){if(row.existed)fs.copyFileSync(row.backup,row.target);else if(fs.existsSync(row.target))fs.unlinkSync(row.target);}throw error;}
 const result={at:now(),build:release.build,sourceRevision:before.revision,fullRevision:before.fullRevision,passed:report.rows.length,stage:'PUBLIC_SOURCES_REVIEWED',semantic,approvalMode:'AST_structural_contract',loaded:false,nativeOutcome:false,operationalStatePreserved:true,files:files.map(e=>({path:e.path,sha256:e.hash})),evidence:stage+'/logs/system-audit/v32-checks-current.json'};
 fs.writeFileSync(path.join(root,'logs/ai-system/promoted.json'),JSON.stringify(result));return result;
}
module.exports={permitted,promotionFiles,promote};
