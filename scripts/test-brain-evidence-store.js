'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EvidenceStore,project}=require('../src/knowledge/evidence-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-brain-'));let store;
try{
 store=new EvidenceStore(root);const at=1000000,hash='a'.repeat(64),f={id:'pet:rule',domain:'pet',level:'PARSED',value:{cost:10},evidence:['client']};
 store.attempt('client',{at,ok:true,hash});const g1=store.publish({build:'b',at,sourceHashes:{client:hash},facts:[f],unknowns:[{id:'pet:visibility',domain:'pet',reason:'gate unknown'}]});
 assert.equal(store.view(at).sources[0].fresh,true);assert.equal(project(store.view(at),at+600001).sources[0].fresh,false);
 store.attempt('client',{at:at+10,ok:false});assert.equal(store.view(at+10).sources[0].success,at);assert.equal(store.view(at+10).sources[0].fresh,false);
 assert.equal(store.attempt('client',{at:at-1,ok:true,hash}),false);assert.equal(store.view(at).sources[0].status,'unavailable');
 const g2=store.publish({build:'b',at:at+20,sourceHashes:{client:'b'.repeat(64)},facts:[{...f,value:{cost:15}}],changes:[{domain:'pet',reason:'same-build change'}]});assert.notEqual(g1,g2);assert.equal(store.view(at+20).recentChanges[0].domain,'pet');assert.equal(store.view(at+20).unknownCount,1);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM facts').get().n,2,'history remains');
 assert.throws(()=>store.publish({build:'b',at:at+30,sourceHashes:{client:hash},facts:[f],changes:[{domain:'',reason:'bad'}]}));assert.equal(store.active().generation,g2,'publication atomic on failed invalidation');
 assert.throws(()=>store.publish({build:'b',at:at+40,sourceHashes:{client:hash},facts:[{...f,level:'EXECUTABLE'}]}));
 assert.throws(()=>store.publish({build:'b',at:at+40,sourceHashes:{client:hash},facts:[{...f,evidence:['secret']}]}));
 assert.throws(()=>store.publish({build:'b',at:at-1,sourceHashes:{client:hash},facts:[f]}));
 assert.throws(()=>store.resolveUnknown('pet:visibility',{evidenceId:'review',generation:g1,at:at+30}));
 store.close();store=new EvidenceStore(root);assert.equal(store.active().generation,g2);assert.equal(store.view(at+30).unknownCount,1,'unknown survives restart');
 assert.equal(store.resolveUnknown('pet:visibility',{evidenceId:'review-1',generation:g2,at:at+30}),true);
 const compile=require('../src/knowledge/wiki-facts').compile;const wiki={items:{equipment:{sword:{name:'Sword',attack:30}}},monsters:{monsters:[{id:'rat',exp:10}]}};const parsed=compile(wiki);assert(parsed.complete);assert(parsed.facts.some(f=>f.value.value.attack===30));assert(parsed.facts.every(f=>f.level==='PARSED'));assert(!compile(wiki,{maxFacts:1}).complete);
 store.publish({build:'b',at:at+40,sourceHashes:{wiki:hash},facts:parsed.facts});assert.equal(store.query({domain:'wiki:items'})[0].value.value.attack,30);assert.throws(()=>store.query({domain:'wiki:items',limit:100000}));
 console.log('PASS knowledge history, failure freshness, clock ordering, atomic publication, provenance, unknowns, restart, scoped invalidation');
}finally{store?.close();fs.rmSync(root,{recursive:true,force:true});}
