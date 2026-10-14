'use strict';
const a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),r=require('../src/learning/repair-pipeline');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-repair-test-')),file='src/planning/dependency-time.js',source="module.exports={result:1};";
try{
 fs.mkdirSync(path.join(root,'src/planning'),{recursive:true});fs.writeFileSync(path.join(root,file),source);
 const fixture="require('node:assert').equal(require('../src/planning/dependency-time').result,2);";fs.mkdirSync(path.join(root,'scripts'));fs.writeFileSync(path.join(root,'scripts/test-brain-dependency-time.js'),fixture);
 const p=r.packet(root,{id:'incident',build:'b',sourceRevision:'a'.repeat(64),file,reproduction:{fixtureHash:crypto.createHash('sha256').update(fixture).digest('hex'),observed:'FAIL'}});
 const patch={file,beforeHash:p.beforeHash,content:'module.exports={result:2};',reason:'Restore expected result in supplied negative fixture'};
 a.throws(()=>r.validate(p,{...patch,file:'src/runtime/action-contract.js'}));a.throws(()=>r.validate(p,{...patch,content:"require('fs').writeFileSync('test','x')"}));a.throws(()=>r.validate(p,{...patch,content:'process.exit(0)'}));
 a.throws(()=>r.stage(path.join(root,'bad'),p,patch,{[file]:source,'../.env':'secret'}));
 const normalized=r.validate(p,patch);a.deepEqual(r.validate(p,normalized),normalized,'validated proposal can enter staging');a.throws(()=>r.validate(p,{...normalized,afterHash:'0'.repeat(64)}),'candidate hash cannot be forged');
 const test=p.tests[0],workspace=path.join(root,'candidate'),manifest=r.stage(workspace,p,patch,{[file]:source,[test]:"require('node:assert').equal(require('../src/planning/dependency-time').result,2);"});
 a.equal(fs.readFileSync(path.join(root,file),'utf8'),source);a.equal(manifest.productionModified,false);a.throws(()=>r.testIsolated(workspace,{image:'node:latest'}));
 a.throws(()=>r.stage(workspace,p,patch,{[file]:source,[test]:'x'}));
 a.equal(r.canary({}).decision,'ROLLBACK_CODE_ONLY');
 const plan={actorId:'a',sourceRevision:'a'.repeat(64),build:'b',goalId:'wing',minimumMs:60000,maxNewDeaths:0},observation={...plan,measuredMs:61000,newDeaths:0,receiptLoss:0,duplicateActions:0,targetReceipt:'native-proof'};
 a.equal(r.canary({plan,observation}).decision,'REVIEW_PROMOTION');a.equal(r.canary({plan,observation:{...observation,newDeaths:1}}).decision,'ROLLBACK_CODE_ONLY');a.equal(r.canary({plan,observation:{...observation,targetReceipt:null}}).decision,'OBSERVE');
 a.equal(r.queue([{id:'a',status:'ESCALATED',resolved:false,reason:'raw sensitive text'}])[0].reason,undefined);
 console.log('PASS repair pure scope, immutable originals/tests, traversal, pinned isolation, no production execution and canary rollback boundaries');
}finally{const resolved=fs.realpathSync(root);if(!resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep))throw Error('Unexpected temp root');fs.rmSync(resolved,{recursive:true,force:true});}
