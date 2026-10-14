'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),economy=require('../src/economy');
const file=process.env.ASTERIA_REPAIR_FIXTURE;
if(file&&fs.existsSync(file)){
 const f=JSON.parse(fs.readFileSync(file));assert.equal(f.version,1);const cat=economy.loadCatalog(process.cwd(),f.build);
 if(f.kind==='refine_plan'){const p=economy.refinePlan({...f.input,items:cat.items,world:cat.world,state:f.input});assert(p.steps.some(s=>s.id===f.expected.id&&s.to===f.expected.to),'Native eligible positive-EV refinement must be represented');}
 else if(f.kind==='craft_catalog'){const rows=require('../src/knowledge/development-source').source(process.cwd(),f.build,cat).recipes;assert(rows.some(r=>r.out.item===f.expected.id),'Native constructed recipe must be represented');}
 else assert.fail('Unsupported immutable progression fixture');
 console.log('PASS immutable native progression defect fixture');
}else if(file)throw Error('Required repair fixture missing');else console.log('PASS fixture runner requires immutable incident input for reproduction');
