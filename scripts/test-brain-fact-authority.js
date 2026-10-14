'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EvidenceStore}=require('../src/knowledge/evidence-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'brain-facts-'));let db;
try{
 db=new EvidenceStore(root);
 const fact={key:'pet:cost',domain:'pet',source:'client',scope:'public_rule',build:'b',authority:'client_rule',at:100,expiresAt:200,value:10,dependencies:['pet:table'],evidenceId:'e'};
 const id=db.observe(fact);assert.equal(db.observe(fact),id);
 const q={key:fact.key,scope:fact.scope,build:'b',now:150};assert.equal(db.resolve(q).value,10);
 db.observe({...fact,source:'wiki',authority:'wiki_rule',value:20});assert.equal(db.resolve(q).state,'CONFLICT');
 db.observe({...fact,source:'ai',authority:'hypothesis',value:10});assert.equal(db.resolve(q).state,'CONFLICT');
 assert.equal(db.resolve({...q,now:201}).state,'UNKNOWN');assert.equal(db.resolve({...q,build:'new'}).state,'UNKNOWN');
 db.dependency({id:'upgrade_pet',dependencies:['pet:table']});db.dependency({id:'combat_plan',dependencies:['upgrade_pet']});db.dependency({id:'travel',dependencies:['routes']});
 assert.deepEqual(db.affected(['pet:table']),['combat_plan','upgrade_pet']);
 const native={...fact,key:'wallet',scope:'actor',source:'save',authority:'native_state',actorId:'a',session:'s',generation:1,rev:9};
 db.observe(native);db.observe({...native,rev:8,at:110,value:5});
 const nq={key:'wallet',scope:'actor',build:'b',purpose:'state',actorId:'a',session:'s',generation:1,now:150};
 assert.equal(db.resolve(nq).value,10,'delayed lower revision cannot overwrite');
 assert.equal(db.resolve({...nq,actorId:'other'}).state,'UNKNOWN');assert.equal(db.resolve({...nq,session:'new'}).state,'UNKNOWN');
 assert.throws(()=>db.observe({...native,session:null}));

 db.attempt('client',{at:100,ok:true,hash:'a'.repeat(64)});
 const idLong='x'.repeat(240),publicFact={id:idLong,domain:'pet',level:'PARSED',value:10,evidence:['client']};
 db.publish({build:'b',at:100,sourceHashes:{client:'a'.repeat(64)},facts:[publicFact]});
 const pq={key:idLong,scope:'public_rule',build:'b',now:150};assert.equal(db.resolve(pq).value,10);
 db.attempt('client',{at:151,ok:false});assert.equal(db.resolve({...pq,now:152}).state,'UNKNOWN','failed refresh invalidates affected rule immediately');
 db.attempt('client',{at:153,ok:true,hash:'b'.repeat(64)});assert.equal(db.resolve({...pq,now:154}).state,'UNKNOWN','new source bytes require a published generation');
 db.publish({build:'b',at:155,sourceHashes:{client:'b'.repeat(64)},facts:[{...publicFact,value:12}]});assert.equal(db.resolve({...pq,now:156}).value,12);
 db.close();db=new EvidenceStore(root);assert.equal(db.resolve(nq).value,10);
 console.log('PASS scoped conflicts, source authority, stale/actor/session/revision rejection, dependency isolation, durable restart');
}finally{db?.close();fs.rmSync(root,{recursive:true,force:true});}
