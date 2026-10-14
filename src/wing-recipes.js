'use strict';
const validRecipe=r=>r&&r.verified!==false&&Number.isInteger(r.reqLv)&&r.reqLv>0&&r.cost&&Object.keys(r.cost).length>0&&Object.values(r.cost).every(v=>Number.isFinite(v)&&v>0);
function plan({job,materials={},coins=0,lv=1,world,items={},wings={},recipes=[],held=[],chain,farmFor,reserveCoins=0,reservedMaterials={}}){
 const mine=Object.entries(wings).filter(([,w])=>chain.includes(w.line)).sort((a,b)=>b[1].tier-a[1].tier);
 if(!mine.length)return null;
 const [finalId,finalWing]=mine[0],counts=new Map();
 for(const id of held){if(!id||id==='null'||id==='undefined')continue;counts.set(id,(counts.get(id)||0)+1);}
 const byId=new Map(recipes.filter(r=>r.type==='wing').map(r=>[r.resultId,r]));
 const nameIds=new Map(Object.entries({...items,...wings}).map(([id,i])=>[i.name,id]));
 const have=name=>{if(name==='Copper')return Math.max(0,coins);const id=nameIds.get(name);return id?counts.get(id)||counts.get(name)||0:Math.max(0,materials[name]||0);};
 const owned=id=>(counts.get(id)||counts.get(wings[id]?.name)||0)>0;
 const baseId=finalWing.from,activeId=baseId&&!owned(baseId)&&!owned(finalId)?baseId:finalId,active=wings[activeId];
 const completed=owned(finalId),sequence=completed?[]:activeId===finalId?[finalId]:[activeId,finalId];
 const unavailable=sequence.find(id=>!wings[id]||!validRecipe(byId.get(id)));
 const recipe=byId.get(activeId),classOk=(active?.tier||0)<6||chain.length>=2&&chain[0]!==chain.at(-1)&&job!==active.line&&Object.values(require('./economy').BASE_TO_PROMOTED).some(p=>chain.includes(p));
 // Tier 6 requires the promoted class (the game's third class), not the later High Class.
 const stages=sequence.map(id=>{const r=byId.get(id),w=wings[id];return {id,name:w?.name||id,tier:w?.tier,reqLv:r?.reqLv||null,cost:validRecipe(r)?r.cost:null};});
 const needs={},requirements=[];
 if(!unavailable&&!completed)for(const [name,want]of Object.entries(recipe.cost)){
  const count=have(name),id=nameIds.get(name),isItem=!!id,reserved=name==='Copper'?reserveCoins:reservedMaterials[name]||0,usable=Math.max(0,count-reserved);
  const sources=name==='Copper'||isItem?[]:farmFor(name,world).slice(0,2);
  requirements.push({name,want,have:count,reserved,usable,short:Math.max(0,want+reserved-count),kind:name==='Copper'?'currency':isItem?'item':'material',sources});
  if(name!=='Copper')needs[name]=want;
 }
 const totals={};if(!unavailable)for(const stage of stages)for(const[name,want]of Object.entries(stage.cost)){const id=nameIds.get(name);if(id&&sequence.includes(id))continue;totals[name]=(totals[name]||0)+want;}
 const missing=requirements.filter(r=>r.short>0&&r.name!=='Copper'),coinCost=completed||unavailable?0:recipe.cost.Copper||0;
 return {target:activeId,name:active?.name||activeId,tier:active?.tier||null,reqLv:recipe?.reqLv||null,levelOk:!unavailable&&lv>=recipe.reqLv,classOk,completed,recipeVerified:!unavailable,blockedReason:unavailable?'ไม่พบสูตร Wiki ที่ตรวจสอบได้: '+unavailable:null,finalTarget:finalId,finalName:finalWing.name,finalTier:finalWing.tier,from:active?.from||null,fromOwned:!active?.from||owned(active.from),chainNote:activeId!==finalId?'คราฟ '+active.name+' ก่อน แล้วอัปเป็น '+finalWing.name:null,stats:active?.stats,coinsNeeded:coinCost,coinsHave:coins,reserveCoins,coinsShort:requirements.find(r=>r.name==='Copper')?.short||0,needs,requirements,missing,stages,totalCost:totals,totalRemaining:Object.fromEntries(Object.entries(totals).map(([n,w])=>[n,Math.max(0,w-have(n))])),craftable:!completed&&!unavailable&&classOk&&lv>=recipe.reqLv&&requirements.every(r=>r.short===0),source:'https://asteria-online.io/wiki/data.json'};
}
function publicPlan(p){if(!p)return null;const requirements=(p.requirements||[]).map(r=>({...r,short:Math.max(0,r.want+(r.reserved||0)-r.have)}));const missing=requirements.length?requirements.filter(r=>r.name!=='Copper'&&r.short>0):p.missing||[];return {...p,requirements,coinsShort:requirements.find(r=>r.name==='Copper')?.short??p.coinsShort,missing:missing.map(m=>typeof m==='string'?m:`${m.name} ${m.have}/${m.want}${m.reserved?' · กันไว้ '+m.reserved+' · ยังต้องหา '+m.short:''}`)};}
module.exports={plan,publicPlan,validRecipe};
