'use strict';
// Only reproducible code symptoms enter repair. Random drops, reserves, user
// stops and protected work are not software defects.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function observe(root,row,now=Date.now()){
 if(row?.status!=='playing'||row.owner||row.quietMs<1800000||row.fresh!==true||row.codeDefect?.observed!=='ERROR'||!require('./repair-pipeline').scopes[row.codeDefect.file]||!/^actor-[a-f0-9]{32}$/.test(row.actorId||''))return null;
 const fixture={version:1,actorId:row.actorId,build:row.build,file:row.codeDefect.file,kind:row.codeDefect.kind,input:row.codeDefect.input,expected:row.codeDefect.expected};
 if(!['refine_plan','craft_catalog'].includes(fixture.kind)||!fixture.input||!fixture.expected)return null;
 const bytes=JSON.stringify(fixture),fixtureHash=sha(bytes),file=path.join(root,'logs/ai-repair/fixtures',fixtureHash+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});if(sha(fs.readFileSync(file))!==fixtureHash)throw Error('Immutable progression fixture changed');
 const sourceRevision=require('../knowledge/system-version').inventory(root).revision,id=sha(JSON.stringify([row.actorId,row.build,sourceRevision,fixtureHash]));
 const incident={id,at:now,actorId:row.actorId,build:row.build,sourceRevision,file:fixture.file,fixtureHash,fixturePath:path.relative(root,file).replace(/\\/g,'/'),status:'NEEDS_REPRODUCTION',replayed:false,nativeBenefitVerified:false};
 const target=path.join(root,'logs/ai-repair/incidents',id+'.json');fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target))fs.writeFileSync(target,JSON.stringify(incident),{flag:'wx'});return incident;
}
function detect(i,quietMs,now=Date.now()){
 if(quietMs<1800000||i.status!=='playing'||!i.lastSave||i.v2?.sourceCoherence?.matches!==true||!require('../runtime/freshness').decisionGate(i,now).allowed||i.activeResourceClaim||i.activeDevelopmentAttempt||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||require('../runtime/team-trade').blocksNavigation(i,now))return null;
 const cat=i.catalog(),s=i.lastSave,p=require('../equipment-goal').policy(cat);if(!p.dynamicProgression)return null;
 const input=Object.fromEntries(['lv','job','coins','equip','refine','bag','materials','consumables','stage','holes','sockets','weaponOpts','pets','petActive','petOpts','locks','st','astral'].filter(k=>s[k]!==undefined).map(k=>[k,JSON.parse(JSON.stringify(s[k]))]));
 const held=require('../runtime/paid-actions').heldResources(i);input.coins=Math.max(0,(input.coins||0)-(held.Copper||0)-require('../upgrade-reserve').reserve(s,cat.world));for(const [k,n]of Object.entries(input.materials||{}))input.materials[k]=Math.max(0,n-(held[k]||0));
 try{const actual=require('../economy').refinePlan({...input,items:cat.items,world:cat.world,state:input});for(const id of Object.values(s.equip||{})){const step=require('../knowledge/refine-capability').step(input,cat,id);if(step?.ready&&require('../planning/combat-roi').refinement(input,cat,step).eligible&&!actual.steps.some(r=>r.id===id&&r.to===step.to))return {observed:'ERROR',file:'src/knowledge/refine-capability.js',kind:'refine_plan',input,expected:{id,to:step.to}};}
 const native=require('../knowledge/development-source').source(i.root,cat.build,cat).recipes;for(const r of native){if(r.out?.item&&cat.items[r.out.item]&&!cat.nativeRecipes?.some(x=>x.resultId===r.out.item&&x.type===r.type))return {observed:'ERROR',file:'src/knowledge/development-source.js',kind:'craft_catalog',input:{},expected:{id:r.out.item}};}
 }catch{/* No expected result is invented from an exception. */}return null;
}
function pending(root){const dir=path.join(root,'logs/ai-repair/incidents');if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(-32).map(n=>JSON.parse(fs.readFileSync(path.join(dir,n)))).filter(r=>r.status==='NEEDS_REPRODUCTION');}
module.exports={observe,pending,detect};
