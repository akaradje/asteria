'use strict';
// Static AST evidence only. Downloaded functions are never executed here.
const acorn=require('acorn'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const wanted={combat:['stats','physHit','magHit','elementMultiplier','aspdCurve','overLvK','basicGap'],survival:['monsterSwing','damagePlayer','mdefShare','spellHit','dmgRedCap','incomingMul','hcSoak'],skills:['passives','hcStatMods','hcAspdK','skillCardPct','skillResPct'],boss:['BOSS_MOVES','BOSS_RAGE','MONSTER_SKILLS','bossTune','activateMonsterSkill'],activities:['canEnterMap','canEnterAbyss','dungeonMessage','towerMessage','renderDungeon','renderTower'],pets:['petBonus','petHitPct','PET_SHARE','PET_TIERS','ENCH_PET_TIER','rollEnchOpt'],equipment:['refineHigh','refineStar','refineMastery','FORGE','ACC_SETS'],astral:['astralBonus','astralBossGate','astralWbGate','ASTRAL'],cards:['cardTrait','cardRace','accCardBonus','CARD_TRAIT_CAP'],class:['JOBS','HC_JOB_DEF','HIGH_CLASSES','HC_MERGED'],market:['marketMessage','mkSend']};
const constants=new Set(['DEF_K0','DEF_K1','MON_DMG_LV','MDEF_K0','MDEF_K1','MDEF_CAP','MON_SPELL_K','MOB_FLEE_CUT','FLEE_LV','ASPD_K','CD_K','SELF_HEAL','SELF_HEAL_CAP','TANK_HEAL_K','ENCH_STEP_W']);
function walk(n,fn){if(!n||typeof n!=='object')return;if(n.type)fn(n);for(const v of Object.values(n)){if(Array.isArray(v))for(const x of v)walk(x,fn);else if(v&&typeof v==='object')walk(v,fn);}}
function literal(n){if(n?.type==='Literal'&&['number','string','boolean'].includes(typeof n.value))return n.value;if(n?.type==='ArrayExpression'&&n.elements.length<=100)return n.elements.map(literal);if(n?.type==='UnaryExpression'&&n.operator==='-'&&typeof literal(n.argument)==='number')return -literal(n.argument);throw Error('nonliteral');}
function extract({client='',world='',build}={}){
 const rules=[],unknowns=[],numeric={},all=new Set([...Object.values(wanted).flat(),...constants]);
 for(const [source,text]of Object.entries({client,world})){
  if(typeof text!=='string'||text.length>8000000){unknowns.push({source,reason:'bounded_source_required'});continue;}
  const scripts=[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/(application\/json|application\/ld\+json)/i.test(m[1])).map(m=>({text:m[2],offset:m.index+m[0].indexOf('>')+1}));if(!scripts.length)scripts.push({text,offset:0});
  const found=new Map();let failed=false;
  for(const s of scripts){try{const tree=acorn.parse(s.text,{ecmaVersion:'latest'});walk(tree,n=>{const name=n.type==='FunctionDeclaration'?n.id?.name:n.type==='VariableDeclarator'?n.id?.name:null;if(!all.has(name))return;const rows=found.get(name)||[];rows.push({n,script:s});found.set(name,rows);});}catch{failed=true;}}
  if(failed){unknowns.push({source,reason:'source_parse_incomplete'});continue;}
  for(const [name,bindings]of found){const rows=name==='stats'?bindings.filter(r=>['FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(r.n.type==='VariableDeclarator'?r.n.init?.type:r.n.type)):bindings;if(rows.length!==1){unknowns.push({source,name,reason:'ambiguous_binding'});continue;}const {n,script}=rows[0],value=n.type==='VariableDeclarator'?n.init:n;
   if(constants.has(name)){try{numeric[source+':'+name]=literal(value);}catch{}continue;}
   if(!value||value.end-value.start>60000)continue;
   const domain=Object.keys(wanted).find(d=>wanted[d].includes(name)),code=script.text.slice(value.start,value.end),dependencies=new Set(),expressions=[];
   walk(value,x=>{if(x.type==='Identifier')dependencies.add(x.name);if(['ReturnStatement','AssignmentExpression','Property'].includes(x.type)&&expressions.length<48){const e=x.type==='ReturnStatement'?x.argument:x.type==='Property'?x.value:x.right;if(e&&e.end-e.start<=3000)expressions.push({target:x.type==='Property'?(x.key.name??x.key.value):x.type==='AssignmentExpression'?script.text.slice(x.left.start,x.left.end):'return',expression:script.text.slice(e.start,e.end)});}});
   if(!expressions.length&&(!value.properties?.length&&!value.elements?.length))continue;
   rules.push({id:'dna:'+source+':'+name,domain,name,build,source,sourceHash:sha(text),offset:script.offset+value.start,hash:sha(code),code,expressions,dependencies:[...dependencies].sort().slice(0,128),authority:source==='client'?'client_rule_not_server_formula':'world_public_rule',level:'PARSED',runtimeVerified:false,executable:false});
  }
 }
 return {version:1,build,rules,numeric,unknowns,fullyKnown:false,limits:'Client offline formulas are not verified server implementation; unresolved inputs and payment contracts remain unknown.'};
}
const cache=new Map();
function read(root,build){const fs=require('node:fs'),path=require('node:path'),files=['asteria-online-visual-polish.html','asteria-world-system.js'].map(n=>path.join(root,'cache',build,'asteria-online.io',n));try{const key=files.map(f=>{const s=fs.statSync(f);return f+':'+s.mtimeMs+':'+s.size;}).join('|');if(cache.has(key))return cache.get(key);const out=extract({client:fs.readFileSync(files[0],'utf8'),world:fs.readFileSync(files[1],'utf8'),build});cache.set(key,out);while(cache.size>3)cache.delete(cache.keys().next().value);return out;}catch{return {build,rules:[],numeric:{},unknowns:[{reason:'native_source_unavailable'}],fullyKnown:false};}}
module.exports={extract,read,wanted};
