'use strict';
const fs=require('fs'),path=require('path');
class CapabilityPolicy{
 constructor(root){this.root=root;this.file=path.join(root,'logs','capability-baselines.json');try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={version:1,builds:{}};}}
 check(knowledge,loadedBuild,capability,identity){
  if(!knowledge?.current||knowledge.lastError)return {allowed:false,reason:'knowledge unavailable'};
  if(knowledge.current.build!==loadedBuild||knowledge.liveBuild!==loadedBuild)return {allowed:false,reason:'game update pending; loaded build differs'};
  if(!require('./loaded-source').inspect(this.root,loadedBuild,knowledge.current.sourceHashes,{liveBuild:knowledge.liveBuild,identity}).matches)return {allowed:false,reason:'game update pending; loaded source differs'};
  if(identity&&!require('./loaded-source').inspect(this.root,loadedBuild,identity.sourceHashes).matches)return {allowed:false,reason:'game update pending; loaded source differs'};
  const fingerprints=knowledge.current.fingerprints;
  const fields=require('./domain-contracts').dependencies[capability];if(!fields)return {allowed:false,reason:'unknown capability contract'};
  if(fields.some(key=>typeof fingerprints?.[key]!=='string'))return {allowed:false,reason:'new mechanics require schema validation'};
  const baseline=this.data.builds[loadedBuild]||Object.values(this.data.builds).find(b=>fields.every(key=>b.fingerprints[key]===fingerprints[key]));
  if(!baseline)return {allowed:false,reason:'new mechanics require schema validation'};
  if(fields.some(key=>baseline.fingerprints[key]!==fingerprints[key]))return {allowed:false,reason:'relevant source changed; review required'};
  if(capability==='boss')return {allowed:false,reason:'boss mechanics require combat verification'};
  return {allowed:true,reason:'validated legacy adapter baseline; outcomes still required'};
 }
 baseline(knowledge,build,evidence){if(!knowledge?.current||knowledge.current.build!==build||!evidence)return false;this.data.builds[build]={fingerprints:{...knowledge.current.fingerprints},at:Date.now(),evidence};fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);return true;}
}
module.exports={CapabilityPolicy};
