'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
async function main(){
 for(const changed of ['src/public/view.js','src/panel.js','src/auto-brain.js','scripts/test-runtime-v2.js']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-full-freeze-'));
  try{
   for(const dir of ['src/public','scripts','machines','cache/fixture/asteria-online.io'])fs.mkdirSync(path.join(root,dir),{recursive:true});
   fs.writeFileSync(path.join(root,'machines/fleet-client-release.json'),JSON.stringify({build:'fixture'}));
   for(const name of ['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js'])fs.writeFileSync(path.join(root,'cache/fixture/asteria-online.io',name),'fixture public source');
   fs.writeFileSync(path.join(root,changed),'// reviewed before');
   fs.writeFileSync(path.join(root,'scripts/test-runtime-v2.js'),`require('node:fs').appendFileSync(${JSON.stringify(changed)},${JSON.stringify('\n// changed during check')});`);
   const result=await require('./v32-checks').run(root,{selected:['runtime-v2']}),r=JSON.parse(fs.readFileSync(result.file));
   const testEdit=changed.startsWith('scripts/');assert.equal(r.passed,testEdit?0:1);assert.equal(r.sourceChanged,false,'non-farm component leaves farm hash unchanged');assert.equal(r.fullSourceChanged,!testEdit,changed);if(testEdit){assert.equal(r.rows[0].testChanged,true);assert.equal(r.rows[0].error,'test_source_changed');}assert.equal(r.offlinePassed,false,'a passing child cannot approve a changing component/test');
   assert.throws(()=>require('./build-architecture-release').buildRelease(root,'fixture',r),/frozen farm\/controller\/web\/AI/,'manifest rejects mixed component evidence');
   const old={...r,offlinePassed:true};delete old.fullSourceRevision;delete old.currentFullSourceRevision;delete old.fullSourceChanged;
   assert.throws(()=>require('./build-architecture-release').buildRelease(root,'fixture',old),/frozen farm\/controller\/web\/AI/,'old farm-only evidence cannot approve a new V3.2 manifest');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
 console.log('PASS full release freeze rejects web/controller/AI edits despite passing farm tests; old partial source evidence cannot publish a manifest');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
