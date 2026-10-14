'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const docs=['ASTERIA-AI-BRAIN-ARCHITECTURE.md','ASTERIA-AI-BRAIN-DELIVERY-PLAN.md','ASTERIA-GAME-DNA-AND-MARKET-ARCHITECTURE.md'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function inventory(root){
 const cases=new Map(),packages=new Map(),documents=[];
 for(const file of docs){const bytes=fs.readFileSync(path.join(root,file)),text=bytes.toString('utf8');documents.push({file,sha256:sha(bytes)});
  for(const [index,line]of text.split(/\r?\n/).entries()){
   const c=line.match(/^\|\s*(A\d{2})\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|/);
   if(c){if(cases.has(c[1]))throw Error('Duplicate acceptance case '+c[1]);cases.set(c[1],{id:c[1],scenario:c[2],required:c[3],file,line:index+1});}
   const p=line.match(/^### (B\d{2}) — (.+)$/);if(p)packages.set(p[1],{id:p[1],title:p[2],file,line:index+1});
  }
 }
 for(let n=1;n<=72;n++)if(!cases.has('A'+String(n).padStart(2,'0')))throw Error('Acceptance case missing '+n);
 for(let n=0;n<=13;n++)if(!packages.has('B'+String(n).padStart(2,'0')))throw Error('Delivery package missing '+n);
 return {documents,packages:[...packages.values()].sort((a,b)=>a.id.localeCompare(b.id)),cases:[...cases.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
function report(root,claims=[],{sourceRevision,build,now=Date.now()}={}){
 const spec=inventory(root);if(!Array.isArray(claims)||claims.length>10000)throw Error('Bounded delivery evidence required');
 const cases=spec.cases.map(c=>{
  const evidence=claims.filter(e=>e.id===c.id&&e.sourceRevision===sourceRevision&&e.build===build&&Number.isFinite(e.at)&&e.at<=now&&e.specHash===spec.documents.find(d=>d.file===c.file).sha256);
  const valid=evidence.filter(e=>['OFFLINE_PASS','NATIVE_PASS'].includes(e.stage)&&typeof e.file==='string'&&!path.isAbsolute(e.file)&&!e.file.split(/[\\/]/).includes('..')&&/^[a-f0-9]{64}$/.test(e.sha256||'')).filter(e=>{try{return sha(fs.readFileSync(path.join(root,e.file)))===e.sha256;}catch{return false;}});
  return {...c,status:valid.some(e=>e.stage==='NATIVE_PASS')?'NATIVE_PASS':valid.length?'OFFLINE_PASS':'UNVERIFIED',evidence:valid.map(e=>({stage:e.stage,file:e.file,sha256:e.sha256,at:e.at})),rejectedEvidence:evidence.length-valid.length};
 });
 return {version:1,at:now,sourceRevision,build,...spec,cases,nativePassed:cases.filter(c=>c.status==='NATIVE_PASS').length,offlineOnly:cases.filter(c=>c.status==='OFFLINE_PASS').length,complete:cases.every(c=>c.status==='NATIVE_PASS'),scope:'case_evidence_index_not_automatic_native_verification'};
}
module.exports={inventory,report};
