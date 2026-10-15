'use strict';
// Read only class data from the loaded build, never execute the whole client.
const fs=require('fs'),path=require('path'),vm=require('vm');
const cache=new Map(),L=(s,...values)=>typeof s==='string'?s:s.reduce((a,b,n)=>a+b+(values[n]??''),'');
function table(text,name){const a=text.indexOf('const '+name+' = {'),b=text.indexOf('\n};',a);if(a<0||b<0)throw Error('class table unavailable');return vm.runInNewContext('('+text.slice(text.indexOf('{',a),b+2)+')',{__L:L},{timeout:1000});}
function load(i){
 const cat=i.catalog(),file=path.join(i.root,'cache',cat.build,'asteria-online.io/asteria-online-visual-polish.html'),key=file+':'+fs.statSync(file).mtimeMs;
 if(cache.has(key))return cache.get(key);
 const text=fs.readFileSync(file,'utf8'),jobs=table(text,'JOBS'),high=text.includes('const HC_JOB_DEF = {')?table(text,'HC_JOB_DEF'):{};
 for(const[id,d]of Object.entries(high)){const from=cat.world?.HIGH_CLASSES?.[id]?.from;if(!from||!jobs[from])continue;jobs[id]={...jobs[from],...d,skills:[...jobs[from].skills,...d.skills],base:from};}
 if(cache.size>=8)cache.clear();cache.set(key,jobs);return jobs;
}
function skillPlan(i,job,{preferHotbar=false}={}){try{const j=load(i)[job],list=j?.skills;if(!Array.isArray(list)||list.some(id=>typeof id!=='string'))return [];const all=[...new Set(list)];return preferHotbar?[...new Set([...(j.hotbar||[]).filter(id=>all.includes(id)),...all])]:all;}catch{return [];}}
function statPlan(i,job,points,{ignoreNovice=true}={}){
 if(ignoreNovice&&(!job||job==='novice')||!Number.isInteger(points)||points<1||points>10000)return [];
 try{const weights=load(i)[job]?.bonus||{},keys=Object.keys(weights).filter(k=>['str','agi','vit','int','dex','luk'].includes(k)&&Number.isFinite(weights[k])&&weights[k]>0),total=keys.reduce((n,k)=>n+weights[k],0);if(!total)return [];
 const rows=keys.map(k=>({k,n:Math.floor(points*weights[k]/total),fraction:points*weights[k]/total%1}));let left=points-rows.reduce((n,r)=>n+r.n,0);for(const r of [...rows].sort((a,b)=>b.fraction-a.fraction)){if(left-->0)r.n++;}
 const plan=[];while(rows.some(r=>r.n>0))for(const r of rows)if(r.n>0){plan.push(r.k);r.n--;}return plan;
 }catch{return [];}
}
function theorycraft(i){const cat=i.catalog(),job=i.lastSave?.job;let native;try{native=load(i)[job];}catch{}return {build:cat.build,job,role:require('./learning/combat-evidence').role(job,cat.world),nativeStatPrior:native?.bonus||null,learnableSkills:native?.skills||[],combat:i.theorycraft?.combat||null,trial:i.v2?.trial?.combatReview(i)||null,resetPermission:false,limits:'Native bonuses are priors; resets/skill reallocations require verified isolated native trial and exact paid contracts'};}
module.exports={load,skillPlan,statPlan,theorycraft};
