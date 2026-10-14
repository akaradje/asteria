'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),recovery=require('../src/runtime/capacity-recovery'),native=require('../src/runtime/isolated-storage');
async function main(){
 const now=Date.now(),start=now-10000,items={spare:{id:'spare',name:'Spare',slot:'head',stats:{def:1},rarity:'epic',rarityEvidence:'reviewed_native_generator'},current:{id:'current',name:'Current',slot:'head',stats:{def:20}}},cat={build:'native',items,world:{bagCap:()=>2}};
 const old={kind:'refine',status:'OBSERVED',at:start-100000,target:{id:'current'}},plan={sell:[{id:'spare',name:'Spare'}],store:[{id:'spare',name:'Spare'}]};
 function actor(){const i={catalog:()=>cat,actorIdentity:{actorId:'actor'},bagSessionStartedAt:start,socialInbox:{generation:1},lastSaveAt:Date.now(),livePos:{room:'town',at:Date.now()},lastSave:{lv:120,job:'knight',bagTier:4,bag:['spare','spare'],coins:100,equip:{head:'current'},storage:{gear:[]},locks:[]},endgameCampaign:{phase:'wing',ready:true},planBag:async()=>plan,openTownService:async()=>({ok:true}),v2:{sourceCoherence:{matches:true}}};
  i.v2.journal={rows:[structuredClone(old)],save(){},pending(item){return this.rows.find(r=>r.target.item===item&&['STARTED','UNCERTAIN'].includes(r.status));},begin(kind,target){const row={kind,target,status:'STARTED',at:Date.now(),id:'sale'};this.rows.push(row);return row;},sent(row,r){row.status=r.ok?'WAITING_CONFIRMATION':'CANCELLED';}};return i;}
 const a=actor();assert.equal(recovery.candidates(a,plan).length,1);
 {
  const brain=require('../src/character-brain'),original=brain.profile,eco=require('../src/economy'),originalWiki=eco.loadWiki;
  const gear=actor();gear.endgameCampaign={phase:'complete'};items.target={id:'target',rarity:'legendary'};
  let craft={id:'target',ready:true,recipeVerified:true,verifiedBuild:'native'};
  try{brain.profile=()=>({craft});eco.loadWiki=()=>({});assert(recovery.readyCraft(gear),'ready ordinary Legendary craft gets the same capacity remedy as a wing');
   for(const patch of [{ready:false},{recipeVerified:false},{verifiedBuild:'old'}]){craft={id:'target',ready:true,recipeVerified:true,verifiedBuild:'native',...patch};assert(!recovery.readyCraft(gear));}
  }finally{brain.profile=original;eco.loadWiki=originalWiki;delete items.target;}
 }
 for(const patch of [{refine:{spare:1}},{locks:['spare']},{bag:['spare']},{equip:{head:'spare'}}])assert.equal(recovery.candidates({...a,lastSave:{...a.lastSave,...patch}},plan).length,0);
 assert.equal(recovery.candidates(a,{...plan,give:[{id:'spare'}]}).length,0,'retain team copy');
 items.spare.rarity='legendary';assert.equal(recovery.candidates(a,plan).length,0);items.spare.rarity='epic';
 {
  const low=actor();low.lastSave.bag=['spare'];low.lastSave.storage.gear=[{id:'spare'}];const stored={store:[{id:'spare',name:'Spare'}],sell:[]};
  assert.equal(recovery.candidates(low,stored).length,1,'retain existing stored Epic copy while freeing its uninvested bag duplicate');
  low.lastSave.refine={spare:1};assert.equal(recovery.candidates(low,stored).length,0,'stored spare cannot authorize sale of invested ID');delete low.lastSave.refine;
  low.lastSave.storage.gear=[];assert.equal(recovery.candidates(low,stored).length,0,'last Epic copy retained');low.lastSave.storage.gear=[{id:'spare'}];
  items.spare.rarity='uncommon';assert.equal(recovery.candidates(low,stored).length,1,'one low-tier bag duplicate can clear headroom while its storage copy remains');
  items.spare.rarityEvidence='native_authored_table';assert.equal(recovery.candidates(low,stored).length,1,'native authored low-tier items have explicit provenance too');
  items.spare.rarityEvidence=undefined;assert.equal(recovery.candidates(low,stored).length,0,'missing evidence remains blocked');
  items.spare.rarityEvidence='reviewed_native_generator';
  low.lastSave.storage.gear=[];assert.equal(recovery.candidates(low,stored).length,0,'never sell last low-tier keepsake');
  low.lastSave.storage.gear=[{id:'spare'}];low.lastSave.locks=['spare'];assert.equal(recovery.candidates(low,stored).length,0);
  low.lastSave.locks=[];assert.equal(recovery.candidates(low,{...stored,give:[{id:'spare'}]}).length,0,'stored copy does not release a team-reserved bag copy');
  items.spare.rarity='epic';
 }
 const inheritedCatalog=a.catalog;delete a.catalog;Object.setPrototypeOf(a,{catalog:inheritedCatalog});
 const economy=require('../src/economy'),catalog=economy.loadCatalog(process.cwd(),economy.newestBuild(process.cwd()));
 assert.equal(catalog.items.leaf_hood.rarityEvidence,'native_authored_table');assert.equal(catalog.items.leaf_hood.rarity,'uncommon');
 const original=native.readback;let rev=1,clicks=0,armed=false,armedAt=0,failReceipt=false,changeOwner=false;
 native.readback=async i=>{if(failReceipt&&clicks===2)return null;const proof={authority:'server_readback',actorId:'actor',sessionStartedAt:start,generation:1,build:'native',requestAt:Date.now(),at:Date.now(),rev:rev++};i.serverSaveReceipt={state:structuredClone(i.lastSave),proof};return i.serverSaveReceipt;};
 const b={dataset:{sellGear:'42'},disabled:false,textContent:'ขาย 20',classList:{contains:()=>armed},closest:()=>r,click(){clicks++;if(!armed){armed=true;armedAt=Date.now();if(changeOwner)a.teamControl={};}else if(Date.now()-armedAt>=400&&Date.now()-armedAt<5000){a.lastSave.bag.pop();a.lastSave.coins+=20;a.lastSaveAt=Date.now();}}},r={querySelector:q=>q==='.iname'?{textContent:'Spare'}:b};
 a.eval=code=>Promise.resolve(vm.runInNewContext(code,{document:{querySelectorAll:()=>[r],querySelector:q=>q.includes('data-shop-tab')?{click(){}}:b}}));
 try{
  a.lastSaveAt=a.livePos.at=Date.now();const result=await recovery.sellOne(a);assert.equal(result.sold,1);assert.equal(clicks,2,'one arm and one confirm, never retry');assert.equal(a.lastSave.bag.length,1);assert.equal(a.v2.journal.rows[0].status,'OBSERVED','old payment retained');assert.equal(a.v2.journal.rows[1].evidence,'server_readback_exact_single_sale');
  const row=a.v2.journal.rows[1],after=a.serverSaveReceipt;assert(recovery.receipt(row,after,a));
  for(const patch of [{coins:121},{bag:[]},{equip:{head:'spare'}},{materials:{ore:1}}])assert(!recovery.receipt(row,{...after,state:{...after.state,...patch}},a));
  assert(!recovery.receipt(row,{...after,proof:{...after.proof,generation:2}},a));
  a.lastSaveAt=a.livePos.at=Date.now();a.lastSave.bag=['spare','spare'];a.lastSave.coins=100;clicks=0;armed=false;changeOwner=true;
  assert.equal((await recovery.sellOne(a)).sold,0);assert.equal(clicks,1,'owner change after arm prevents confirmation');
  a.lastSaveAt=a.livePos.at=Date.now();delete a.teamControl;changeOwner=false;clicks=0;armed=false;failReceipt=true;
  assert.equal((await recovery.sellOne(a)).sold,0);assert.equal(clicks,2);assert.equal(a.v2.journal.rows.at(-1).status,'UNCERTAIN','missing native result remains fenced');
  a.lastSaveAt=a.livePos.at=Date.now();a.lastSave.bag=['spare','spare'];assert.equal((await recovery.sellOne(a)).sold,0);assert.equal(clicks,2,'no retry of ambiguous sale');
  failReceipt=false;const pending=a.v2.journal.rows.at(-1);assert.equal(await recovery.reconcile(a),false,'same page cannot clear uncertainty');
  a.lastSave=structuredClone(pending.baseline.state);a.bagSessionStartedAt=Date.now()+1;
  native.readback=async i=>{const proof={...pending.baseline.proof,sessionStartedAt:i.bagSessionStartedAt,requestAt:Date.now()+2,at:Date.now()+2,rev:99};i.serverSaveReceipt={state:structuredClone(i.lastSave),proof};return i.serverSaveReceipt;};
  await new Promise(r=>setTimeout(r,5));await native.readback(a);a.serverSaveReceipt.proof.requestAt=Date.now();a.serverSaveReceipt.proof.at=Date.now();
  assert.equal(await recovery.reconcile(a),true,'exact unchanged readback after closed page permits NOT_APPLIED only');assert.equal(pending.status,'NOT_APPLIED');
 }finally{native.readback=original;}
 console.log('PASS bounded surplus duplicate sale, exact native receipt, protected/team/Legendary copies, owner race, ambiguous no replay');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
