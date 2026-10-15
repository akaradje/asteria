'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const files={client:'asteria-online-visual-polish.html',world:'asteria-world-system.js',network:'asteria-net.js'},cache=new Map();
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function capture(root,build){
 const sourceHashes={},missing=[];
 for(const[k,name]of Object.entries(files)){
  if(!require('./build-id').valid(build)){missing.push(k);continue;}
  const file=path.join(root,'cache',build,'asteria-online.io',name);
  try{const stat=fs.statSync(file),key=path.resolve(file),stamp=[stat.size,stat.mtimeMs,stat.ctimeMs].join(':'),prior=cache.get(key);let sha;
   if(prior?.stamp===stamp)sha=prior.sha;else{sha=hash(fs.readFileSync(file,'utf8'));cache.set(key,{stamp,sha});while(cache.size>48)cache.delete(cache.keys().next().value);}
   sourceHashes[k]=sha;
  }catch{missing.push(k);}
 }
 return Object.freeze({build,sourceHashes:Object.freeze(sourceHashes),missing:Object.freeze(missing),signature:hash(JSON.stringify([build,sourceHashes])).slice(0,24)});
}
function inspect(root,loadedBuild,sourceHashes,{liveBuild=loadedBuild,identity=capture(root,loadedBuild)}={}){
 const missing=[],mismatched=[];
 for(const key of Object.keys(files)){
  if(!/^[a-f0-9]{64}$/.test(sourceHashes?.[key]||'')||!/^[a-f0-9]{64}$/.test(identity?.sourceHashes?.[key]||''))missing.push(key);
  else if(identity.sourceHashes[key]!==sourceHashes[key])mismatched.push(key);
 }
 if(identity?.build!==loadedBuild||loadedBuild!==liveBuild)mismatched.push('build');
 return {matches:missing.length===0&&mismatched.length===0,missing,mismatched,loadedBuild,liveBuild,at:Date.now(),identity};
}
module.exports={capture,inspect};
