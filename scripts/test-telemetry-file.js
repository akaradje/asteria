'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {writeTelemetry}=require('../src/runtime/telemetry-file');
const {Federation}=require('../src/federation');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-telemetry-'));
const rename=fs.renameSync;
try{
 fs.mkdirSync(path.join(root,'machines'));
 fs.copyFileSync(path.join(__dirname,'../machines/fleet.json'),path.join(root,'machines/fleet.json'));
 let now=Date.now(),messages=[];
 const f=new Federation(root,'windows',{now:()=>now,log:m=>messages.push(m)});
 const file=path.join(f.dir,'local.json');
 assert.equal(f.save(file,{at:now,members:[]}),true);
 const original=fs.readFileSync(file,'utf8');
 for(const code of ['EPERM','EBUSY','EACCES']){
  fs.renameSync=(from,to)=>{if(to===file)throw Object.assign(Error('locked fixture'),{code});return rename(from,to);};
  assert.equal(f.save(file,{at:++now,members:[{status:'playing'}]}),false);
  assert.equal(fs.readFileSync(file,'utf8'),original,'never replace good snapshot with partial or fake fresh data');
  assert.equal(f.persistenceFailures.get('local.json').code,code);
  assert.equal(fs.readdirSync(f.dir).filter(x=>x.endsWith('.tmp')).length,0);
 }
 assert.equal(messages.length,1,'rate-limit warnings during a locked-file burst');
 now+=60000;f.save(file,{at:now});assert.equal(messages.length,2);
 fs.renameSync=rename;
 assert.equal(f.save(file,{at:now,members:[]}),true,'next scheduled publication can recover');
 assert.equal(f.persistenceFailures.size,0);
 assert.equal(JSON.parse(fs.readFileSync(file)).at,now);
 fs.renameSync=()=>{throw Object.assign(Error('disk full fixture'),{code:'ENOSPC'});};
 assert.throws(()=>writeTelemetry(file,{at:now+1}),{code:'ENOSPC'},'unexpected failures stay visible to caller');
 assert.equal(JSON.parse(fs.readFileSync(file)).at,now);
 assert.equal(fs.readdirSync(f.dir).filter(x=>x.endsWith('.tmp')).length,0);
 console.log('PASS locked telemetry keeps complete prior snapshot, cleans temporary files, reports throttled failure and recovers without truncation; unexpected failure remains visible');
}finally{
 fs.renameSync=rename;fs.rmSync(root,{recursive:true,force:true});
}
