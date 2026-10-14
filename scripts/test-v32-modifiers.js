'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {totals}=require('../src/gear-value'),{ActivityEvidence}=require('../src/observability/activity-evidence');
const cat={items:{wing:{id:'wing',slot:'wing',tier:7,stats:{}},armor:{id:'armor',slot:'armor',tier:7,stats:{}}},world:{REFINE:{max:15,chance:[100]},REFINE_HIGH:{from:10,wing:.01},REFINE_STAR:{lv:15,slots:['wing'],bonus:{dmgPct:.15}}}};
const save={job:'asura',equip:{wing:'wing',armor:'armor'},refine:{wing:10},weaponOpts:{armor:[{k:'hp',v:100}]},pets:{pet:0},petActive:'pet',petOpts:{pet:[{k:'def',v:20}]}};
const g=totals(save,cat);assert.equal(g.stats.atk,50);assert.equal(g.stats.matk,50);assert.equal(g.stats.hp,100);assert.equal(g.stats.def,20);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-v32-events-'));try{const evidence=new ActivityEvidence(root,'fixture',{now:()=>1000});
 const payload=JSON.stringify({t:'kill',id:'same-monster',coins:1});evidence.receive(payload,'build','map');evidence.receive(payload,'build','map');assert.equal(evidence.data.rows.length,2);
 const native=JSON.stringify({t:'kill',id:'same-monster',eventId:'event'});evidence.receive(native,'build','map');evidence.receive(native,'build','map');assert.equal(evidence.data.rows.length,3);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS T19/T40: legitimate identical events preserved; wing, worn armour and active pet option modifiers');
