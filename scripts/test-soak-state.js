'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{resumeReport}=require('../src/observability/soak-state');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-soak-state-')),file=path.join(dir,'report.json');
try{
 const original={runId:'100',startedAt:100,targetEndAt:10000,status:'running',samples:4,observedMs:200,build:'old',lastSample:{at:500}};
 fs.writeFileSync(file,JSON.stringify(original));fs.writeFileSync(file+'.tmp',JSON.stringify({...original,samples:5,lastSample:{at:600}}));
 const r=resumeReport(file,1500);assert.equal(r.samples,5);assert.equal(r.observedMs,200);assert.equal(r.runId,'100');assert.equal(r.targetEndAt,10000);assert.equal(r.build,'old');assert.equal(r.longTermVerified,false);assert.deepEqual(r.measurementGaps,[{from:600,to:1500,reason:'recorder stopped; interval not measured'}]);
 fs.writeFileSync(file+'.tmp',JSON.stringify({...original,runId:'another',samples:99,lastSample:{at:900}}));assert.equal(resumeReport(file,1500).samples,4);
 fs.writeFileSync(file,JSON.stringify({...original,status:'completed'}));assert.throws(()=>resumeReport(file),/valid running/);
 console.log('PASS resume original counters/build/deadline, recover same-run temporary, exclude gap, refuse completed and cross-run state');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
