'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{normalize,compare,CompetitiveGear}=require('../src/observability/competitive-gear'),{SocialInbox}=require('../src/runtime/social-inbox');
const cat={world:{JOBS:{knight:{},mage:{}}},items:{old:{id:'old',name:'Old',slot:'weapon',tier:4,stats:{atk:10}},better:{id:'better',name:'Better',slot:'weapon',tier:5,stats:{atk:100}}}},wiki={monsters:{monsters:[{name:'Boss',level:100,area:'field',dropTable:[{item:'Better',ratePct:2}]}]}},save={job:'knight',lv:120,equip:{weapon:'old'}};
const now=Date.now(),frame={t:'inspect',name:'Leader',job:'knight',lv:120,pw:999,token:'DO_NOT_KEEP',gear:{weapon:{id:'better',r:7,s:3,h:1,c:['card1'],o:[{k:'atk',v:10}]}}};
const inbox=new SocialInbox();inbox.receive(JSON.stringify({t:'b',l:[frame]}),now);assert.equal(inbox.last('inspect:Leader'),null,'competitor inspection is not retained or routed by the production observer');const safe={...frame,_receivedAt:now};delete safe.token;
const peer=normalize(safe,safe._receivedAt);assert.equal(peer.gear.weapon.refine,7);assert.equal(peer.gear.weapon.stage,3);assert.deepEqual(peer.gear.weapon.cards,['card1']);assert.equal(peer.gear.weapon.options[0].v,10);
assert.equal(compare(save,cat,wiki,peer,now).targets[0].id,'better');assert.equal(compare(save,cat,wiki,peer,now+900001).targets.length,0);assert.equal(compare(save,cat,wiki,{...peer,job:'mage'},now).targets.length,0);assert.equal(compare(save,cat,{},peer,now).targets.length,0);
assert.deepEqual(normalize({...frame,hidden:true},now).gear,{});assert.deepEqual(normalize({...frame,gone:true},now).gear,{});
assert.equal(compare({...save,stage:{old:3}},cat,wiki,peer,now).targets.length,0);
assert.equal(compare({...save,stage:{old:3}},{...cat,world:{...cat.world,FORGE:{canStage:()=>true,stageBonus:(it,s)=>({atk:s*100})}}},wiki,peer,now).targets.length,0);
cat.items.ring={id:'ring',name:'Ring',slot:'acc',rarity:'legendary',tier:4,stats:{atk:50}};
const accessory=normalize({...frame,gear:{acc1:{id:'ring',r:3},acc2:{id:'ring',r:2}}},now);assert.equal(accessory.gear.acc1.refine,3);assert.equal(accessory.gear.acc2.refine,2);
const comparison=compare(save,cat,{crafting:{recipes:[]}},accessory,now);assert(comparison.rows.every(r=>r.usable&&r.slot==='acc1'),'native acc slots compare with catalog acc type and actual destination');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-peer-test-'));try{const store=new CompetitiveGear(root,'fixture');store.observe(safe,'v1');assert.equal(store.view(save,cat,wiki,'v2',now).targets.length,0);assert.equal(store.view(save,cat,wiki,'v1',now).targets.length,1);const reloaded=new CompetitiveGear(root,'fixture');assert.equal(reloaded.history.length,1);}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: public inspect batching/privacy, refine/stage/card/option preservation, class/build/freshness separation, source-backed targets and durable history');
