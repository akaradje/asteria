'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ResultLedger}=require('../src/result-ledger'),scope=require('../src/runtime/craft-scope'),brain=require('../src/character-brain');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-craft-scope-'));
const actor='actor-'+'a'.repeat(32),other='actor-'+'b'.repeat(32),now=Date.now();
const cat={build:'checked',items:{old:{id:'old',name:'Old shield',slot:'offhand',tier:7,rarity:'legendary',stats:{def:50}},next:{id:'next',name:'Next armor',slot:'armor',tier:7,rarity:'legendary',stats:{def:30}},wing:{id:'wing',name:'Wing',slot:'wing',tier:6,rarity:'legendary',stats:{}}},world:{MAX_LV:120,MONSTERS:[{id:'pet',kind:'normal',level:1}]}};
const save={lv:120,job:'dragonknight',coins:1000000,pets:{pet:0},petActive:'pet',equip:{wing:'wing'},bag:[],materials:{Ore:100},keyItems:{},refine:{}};
const wiki={crafting:{recipes:[{type:'gear',resultId:'old',result:'Old shield',reqLv:1,cost:{Copper:1000,Ore:1},verified:true,verifiedBuild:'checked'},{type:'gear',resultId:'next',result:'Next armor',reqLv:1,cost:{Copper:1000,Ore:1},verified:true,verifiedBuild:'checked'}]},maps:{maps:[]},monsters:{monsters:[]}};
function ledger(name){const l=new ResultLedger(root,name);l.context={actorId:actor,build:'checked',generation:1,sessionStartedAt:now-300000,baselineRev:10};l.costCatalog=cat;l.expectedCost={Copper:1000,Ore:1};const r=l.begin('craft',{id:'old'},save,now-200000);r.status='unresolved';l.save();const p={authority:'server_readback',actorId:actor,build:'checked',generation:2,sessionStartedAt:now-100000,requestAt:now-1000,at:now-500,rev:20};assert(l.rebaseUncertainCraft(save,p,cat,now));return {l,r};}
function instance(l){return {catalog:()=>cat,actorIdentity:{actorId:actor},developmentLedger:l};}
async function main(){
 const {l,r}=ledger('scope'),i=instance(l),original=JSON.stringify(r);
 assert(scope.blocking(i,'old'));assert(scope.blocking(i));assert.equal(scope.blocking(i,'next'),undefined);assert(scope.blocking(i,'not-in-catalog'));
 assert.deepEqual([...scope.blockedTargets(i)],['old']);assert.equal(JSON.stringify(r),original,'planning never edits an old payment');
 const p=brain.profile(save,cat,wiki,scope.profileOptions(i));assert.equal(p.craft.id,'next');assert(p.craft.ready);assert.equal(p.craftPortfolio.quarantined[0].id,'old');assert(!p.craftPortfolio.workCandidates.some(c=>c.id==='old'));
 const investment=require('../src/investment-plan').choose(save,cat,wiki,{campaignComplete:true,...scope.investmentOptions(i)});assert.equal(investment.selected.id,'next','actual town investment queue uses the independent recipe');
 const refreshed=ledger('cross-build'),oldProof=JSON.stringify(refreshed.r.reconciliation),otherCat={...cat,build:'later'},readProof={...refreshed.r.reconciliation,build:'later',at:now-100,requestAt:now-200,rev:30};assert(refreshed.l.rebaseUncertainCraft(save,readProof,otherCat,now));assert.equal(JSON.stringify(refreshed.r.reconciliation),oldProof,'fresh budget revalidation appends proof without relabeling the original');assert(scope.rebased(refreshed.r,{actorId:actor,build:'later'}));assert(scope.blocking({...instance(refreshed.l),catalog:()=>otherCat},'old'));assert.equal(scope.blocking({...instance(refreshed.l),catalog:()=>otherCat},'next'),undefined);assert(!refreshed.l.rebaseUncertainCraft(save,readProof,otherCat,now),'same build revalidation is idempotent');
 const only=brain.profile(save,cat,{...wiki,crafting:{recipes:wiki.crafting.recipes.slice(0,1)}},scope.profileOptions(i));assert.equal(only.craft,null,'no replay just because no alternative exists');
 for(const mutate of [x=>x.context.actorId=other,x=>x.legacyIdentityUnknown=true,x=>x.status='unresolved',x=>x.status='pending',x=>x.evidence='guessed',x=>x.reconciliation.budgetRebased=false,x=>x.reconciliation.replayBlocked=false,x=>x.reconciliation.costKnown=true,x=>x.reconciliation.historicalSuccessKnown=true,x=>x.reconciliation.actorId=other,x=>x.reconciliation.build='other',x=>x.reconciliation.authority='outgoing_client_save',x=>x.reconciliation.rev=10,x=>x.reconciliation.targetId='other',x=>x.reconciliation.currentOwned=-1,x=>x.reconciliation.at=x.reconciliation.requestAt+30001]){
  const bad=JSON.parse(original);mutate(bad);assert(!scope.independent(bad,scope.scope(i,'next')),'invalid native rebase must not narrow a fence');
 }
 assert(scope.blocking({...i,actorIdentity:{actorId:other}},'next'));assert(scope.blocking({...i,catalog:()=>({...cat,build:'other'})},'next'));
 l.context={actorId:actor,build:'checked',generation:2,sessionStartedAt:now-100000,baselineRev:20};l.costCatalog=cat;
 assert.equal(l.begin('craft',{id:'old'},save,now),null);const fresh=l.begin('craft',{id:'next'},save,now,false,true);assert(fresh);assert(scope.blocking(i,'old'));assert(scope.blocking(i,'next'),'new pending still serializes every attempt');assert.equal(JSON.stringify(r),original);
 assert.equal(require('../src/investment-plan').choose(save,cat,wiki,{campaignComplete:true,...scope.investmentOptions(i)}).selected,null,'town investment preserves a new pending payment fence');
 const executing={...i,activeDevelopmentAttempt:{id:fresh.id,kind:'craft'},bagSessionStartedAt:l.context.sessionStartedAt,socialInbox:{generation:l.context.generation}};assert.equal(scope.blocking(executing,'next'),undefined,'only current exact internal attempt may preflight itself');assert(scope.blocking({...executing,bagSessionStartedAt:1},'next'));assert(scope.blocking({...executing,socialInbox:{generation:999}},'next'));assert(scope.blocking({...executing,activeDevelopmentAttempt:{id:r.id,kind:'craft'}},'old'),'old target is never an own-executor exemption');
 assert(l.cancelBeforeCraftDispatch(fresh.id,'failed before native evaluation'));assert.equal(fresh.status,'not_sent');assert.equal(fresh.evidence,'failed_before_native_payment_dispatch');
 const possible=l.begin('craft',{id:'next'},save,now+1,false,true);assert(possible);assert(!l.markCraftDispatch(possible.id,'old',now+2));assert(l.markCraftDispatch(possible.id,'next',now+2));assert(!l.cancelBeforeCraftDispatch(possible.id,'must not guess'));assert.equal(possible.status,'pending');
 // Exercise the real native method and installed ledger wrapper. A failure
 // opening the NPC is cancellable; loss after payment evaluation remains held.
 const {GameInstance}=require('../src/instance'),economy=require('../src/economy'),oldWiki=economy.loadWiki;
 economy.loadWiki=()=>wiki;
 try{
  for(const mode of ['before','possible','undefined','disabled']){
   const x=ledger('method-'+mode),f=Object.create(GameInstance.prototype);Object.assign(f,{root,actorStateRoot:root,slot:0,actorIdentity:{actorId:actor},lastSave:save,lastSaveAt:Date.now(),livePos:{room:'town',at:Date.now()},developmentLedger:x.l,bagSessionStartedAt:now-100000,socialInbox:{generation:2},serverSaveObservation:{rev:20},catalog:()=>cat});
   f.openTownService=async()=>{if(mode==='before')throw Error('NPC opening failed');return {ok:true};};let calls=0;
   f.eval=async()=>{if(++calls===1)return true;const row=x.l.rows[0];assert.equal(row.dispatchTracking.state,'possible','durable payment boundary precedes native evaluation');if(mode==='possible')throw Error('response lost after possible payment');return mode==='disabled'?{ok:false,reason:'native-recipe-disabled'}:undefined;};
   if(['before','possible'].includes(mode))await assert.rejects(()=>f.craftAtExchange('Next armor'));
   else await f.craftAtExchange('Next armor');
   const row=x.l.rows[0];assert.equal(row.target.id,'next');assert.equal(row.status,['before','disabled'].includes(mode)?'not_sent':'pending');assert(x.l.rows.some(old=>old.id===x.r.id&&old.status==='reconciled_craft_unknown'));assert.equal(f.activeDevelopmentAttempt,undefined);
  }
 }finally{economy.loadWiki=oldWiki;}
 console.log('PASS same-actor/current-build native-budget craft scope, original no-replay, alternative milestone selection, invalid-proof rejection, serial reservations and actual native pre/post-dispatch failure boundaries');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Cleanup outside isolated temp root');fs.rmSync(root,{recursive:true,force:true});});
