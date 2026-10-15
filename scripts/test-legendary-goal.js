'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const goal=require('../src/equipment-goal'),gear=require('../src/gear-value'),economy=require('../src/economy'),runtime=require('../src/runtime/development-progress');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-legendary-goal-'));
const rule={enabled:true,rarity:'legendary',refine:10};
const world={MAX_LV:120,MONSTERS:[{id:'pet',level:1,kind:'normal',element:'ไม่มีธาตุ'}],REFINE:{max:10,chance:[100,100,100,75,60,45,32,20,12,6],cost:(t,l)=>(35+l*30)*t,ore:()=>'Starmetal',need:l=>1+Math.floor(l/3)}};
const item=(id,slot,rarity,stats)=>({id,name:id,slot,rarity,tier:7,stats});
const cat=goal.configure({build:'fixture',world,items:{epic:item('epic','weapon','epic',{atk:1000}),gold:item('gold','weapon','legendary',{atk:10}),better:item('better','weapon','legendary',{atk:20}),high:item('high','weapon','epic',{atk:2000}),a:item('a','acc','legendary',{atk:100}),e:item('e','acc','epic',{atk:200}),b:item('b','acc','legendary',{atk:1}),wing:item('wing','wing','legendary',{atk:1})}},rule);
const save={pets:{pet:0},petActive:'pet',lv:120,job:'asura',coins:1000000,potions:20,bag:[],materials:{Starmetal:200},equip:{wing:'wing',weapon:'epic'},refine:{},stage:{},holes:{},sockets:{},weaponOpts:{}};
async function main(){
 let c=gear.compare(save,cat,'gold');assert(c.upgrade&&c.goalPromotion&&c.gain<0,'explicit gold goal overrides score without inventing a positive gain');
 assert.equal(gear.compare({...save,equip:{weapon:'gold'}},cat,'high').upgrade,false,'even higher scoring Epic cannot replace Legendary');
 assert.equal(gear.compare(save,{...cat,equipmentGoal:{enabled:false}},'gold').upgrade,false,'generic disabled score policy still rejects stat loss');
 c=gear.compare({...save,equip:{weapon:'gold',acc1:'a',acc2:'e'}},cat,'b');assert.equal(c.slot,'acc2');assert(c.upgrade&&c.goalPromotion);assert(!gear.compare({...save,equip:{acc1:'b'}},cat,'b').upgrade,'never duplicate an equipped accessory');
 cat.items.locked={...cat.items.gold,id:'locked',reqLv:121};assert(!gear.compare(save,cat,'locked').upgrade);cat.items.other={...cat.items.gold,id:'other',jobs:['mage']};assert(!gear.compare(save,cat,'other').upgrade);assert(!gear.compare({...save,equip:{weapon:'unknown'}},cat,'gold').upgrade,'unknown outgoing stats need review');
 const plan=economy.planBag({save,bag:[{id:'gold',uid:1}],equip:save.equip,job:save.job,lv:save.lv,items:cat.items,world});assert(plan.equip.some(r=>r.id==='gold'),'legacy {items,world} receives strict context');
 const full={...save,equip:{},refine:{}};for(const slot of ['weapon','offhand','head','armor','boots','wing','acc1','acc2']){const id='full_'+slot;cat.items[id]=item(id,slot.startsWith('acc')?'acc':slot,'legendary',{atk:1});full.equip[slot]=id;if(slot!=='wing')full.refine[id]=10;}
 let g=goal.assess(full,cat);assert(!g.complete&&g.legendaryEquipped===8&&g.refine10Equipped===7&&g.refine10Target===7);assert.deepEqual(g.unknownRefineSlots,['wing']);assert(!g.rows.find(r=>r.slot==='wing').refineMet,'unknown wing eligibility never gets +10 credit or completion');
 const currentCat={...cat,world:{...world,REFINE:{...world.REFINE,max:15},REFINE_STAR:{slots:['weapon','offhand','head','armor','boots','wing']},REFINE_HIGH:{wing:.01}}};
 const currentFull={...full,refine:{...full.refine,full_wing:10}};
 const currentGoal=goal.assess(currentFull,currentCat);assert(currentGoal.complete);assert.equal(currentGoal.refine10Target,8);assert.equal(currentGoal.refine10Equipped,8);
 assert(!goal.assess(full,currentCat).complete,'native wing support requires its actual +10');
 const partial={...full,refine:{...full.refine,full_weapon:9}};assert(!goal.assess(partial,cat).complete);const wrong={...full,equip:{...full.equip,acc2:'full_acc1'}};assert(!goal.assess(wrong,cat).complete,'native duplicate slots cannot count complete');
 assert(!goal.assess(full,{...cat,world:{...world,REFINE:{...world.REFINE,max:9}}}).complete,'future cap cannot fabricate +10');
 const rs={...save,equip:{weapon:'gold',armor:'epic',wing:'wing'},refine:{gold:9,epic:1}};
 let rp=economy.refinePlan({...rs,items:cat.items,world});assert.equal(rp.steps.length,1);assert.deepEqual([rp.steps[0].to,rp.steps[0].chancePct,rp.steps[0].coinCost,rp.steps[0].oreNeed],[10,6,2135,4]);assert(!rp.steps[0].guaranteed);
 assert.equal(economy.refinePlan({...rs,refine:{gold:10},items:cat.items,world}).steps.length,0,'no +11 or Epic roll');
 assert.equal(economy.refinePlan({...rs,items:cat.items,world:{...world,REFINE:{...world.REFINE,chance:[]}}}).doable.length,0,'no invented chance fallback under strict target');
 let now=Date.now();const actor={root,lastSave:rs,lastSaveAt:now,catalog:()=>cat,livePos:{room:'town',at:now},vitals:{hp:1,at:now},endgameCampaign:{phase:'complete'},autoChores:true,canDo:()=>true,goal:{label:'farm'},developmentLedger:{blocking:()=>null,view:()=>[]},expeditionAuto:async()=>{},screen:async()=>({hp:'100 / 100'}),closeGamePanel:async()=>{}};
 let count=0;actor.refineEquipped=async opts=>{assert.equal(opts.targetId,'gold');assert.equal(opts.maxAttempts,1);assert.equal(opts.guaranteedOnly,false);count++;return {refined:1};};
 assert.equal(runtime.refineOpportunity(actor).to,10);await runtime.tick(actor,{});assert.equal(count,1,'one native risk roll, not a blind loop');
 actor.dailyTeamPending=true;await runtime.tick(actor,{});assert.equal(count,1);actor.dailyTeamPending=false;
 actor.developmentLedger.blocking=()=>({kind:'refine',status:'pending'});assert.equal(runtime.refineOpportunity(actor),null);actor.developmentLedger.blocking=()=>null;
 assert.equal(runtime.refineOpportunity({...actor,lastSave:{...rs,coins:12001}}),null,'upkeep reserve cannot be spent');assert.equal(runtime.refineOpportunity({...actor,lastSave:{...rs,materials:{Starmetal:3}}}),null,'native cost must be available');
 cat.nativeRecipes=[{type:'gear',resultId:'gold',result:'gold',reqLv:1,cost:{Copper:100,Starmetal:1},verified:true,verifiedBuild:'fixture',source:'reviewed_native_client'}];
 const objective=require('../src/planning/progression-objective').objective(save,cat,null);assert(objective.targets.every(t=>cat.items[t.id].rarity==='legendary'),'long-term objective never selects Epic');
 const endgame=require('../src/planning/endgame').assess({...full,equip:{...full.equip,acc2:'e'}},cat,null);assert.equal(endgame.nodes.find(n=>n.id==='refine').status,'gather','refined body cannot conceal missing Legendary accessory');
 const profile=require('../src/character-brain').profile(save,cat,null);assert(profile.craft?.goalPromotion&&profile.craft.gain<0&&profile.craft.ready,'gold craft not discarded by negative interim score');
 assert.equal(require('../src/investment-plan').choose({...save,equip:{wing:'wing',weapon:'epic',acc1:'a'}},cat,null,{campaignComplete:true}).selected.kind,'craft','ready gold craft owns budget before refine');
 const craftActor={...actor,lastSave:save};await runtime.tick(craftActor,{});assert.equal(count,1,'runtime does not spend on refine before a ready gold craft');
 const choose=require('../src/planning/team-trade').choose;const inventory=equip=>({at:Date.now(),lv:120,jobLv:50,job:'asura',equip,refine:{},stage:{},holes:{},sockets:{},weaponOpts:{},locks:[],materials:{},bagFree:3,offers:[]});
 const d={charName:'Donor',status:'playing',teamInventory:{...inventory({weapon:'better'}),offers:[{id:'gold',index:0},{id:'high',index:1}]}},receiver={charName:'Receiver',status:'playing',teamInventory:inventory({weapon:'epic'})};
 const trade=choose([d,receiver],cat);assert.equal(trade.id,'gold');assert(trade.goalPromotion&&trade.gain<0);d.teamInventory.offers=[{id:'high',index:1}];assert.equal(choose([d,receiver],cat),null,'trade cannot deliver Epic as target');
 const ceiling=require('../src/planning/equipment-ceiling').assess(save,cat,null);assert(!ceiling.complete&&ceiling.goal.legendaryEquipped===1);
 const ctx={fmt:n=>String(n),esc:x=>String(x).replace(/[<>&]/g,'?')};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/public/fleet-layout.js','utf8'),ctx);const html=ctx.equipmentGoalLayout(g);assert(html.includes('Legendary 8 / 8')&&html.includes('เป้า native +10')&&html.includes('ถึงเป้า 7 ช่อง')&&html.includes('รอตรวจความสามารถตีบวก: wing'));assert(!html.includes('เกมไม่รองรับตีบวกปีก'));assert(ctx.equipmentGoalLayout(currentGoal).includes('ถึงเป้า 8 ช่อง'));
 // A first wing cannot freeze all paid development until the final boss drops.
 // Exercise the real shared budget and one-action runtime, not a click loop.
 {const at=Date.now(),board={now:at,_receivedAt:at,list:[{id:'boss',map:'town',up:false,next:at+600000}]};
  const a={...actor,lastSave:rs,lastSaveAt:at,v2:{sourceCoherence:{matches:true}},socialInbox:{last:()=>board},bossWindow:{phase:'side-work',assignedAt:at,spawnAt:at+600000,boss:{monsterId:'boss',mapId:'town'},leadMs:90000},endgameCampaign:{active:true,phase:'wing',ready:false,target:'finalWing',wing:{name:'Final Wing',recipeVerified:true,coinsNeeded:500000,needs:{Starmetal:15}}}};
  const parallel=require('../src/planning/campaign-equipment'),paid=require('../src/runtime/paid-actions');
  assert(parallel.window(a,at));assert(runtime.refineOpportunity(a,at)?.strictGoal);assert.equal(runtime.refineOpportunity(a,at).to,10,'native +10 goal continues during a verified wing wait');
  assert.equal(runtime.refineOpportunity(a,at).extraReserveCoins,500000);assert.equal(runtime.refineOpportunity(a,at).reservedMaterials.Starmetal,15);
  a.v2.reservations={totals:()=>({Copper:100,Starmetal:2})};assert.equal(parallel.resources(a).Copper,500100);assert.equal(parallel.resources(a).Starmetal,17,'durable unknown claims are additive to the wing bill');
  assert.equal(paid.preflight({...a,lastSave:{...rs,materials:{Starmetal:15}}},'craftAtExchange',['gold','gear']).allowed,false,'unreserved gear craft may not consume the wing ore');
  assert.equal(paid.preflight({...a,lastSave:{...rs,coins:512100}},'craftAtExchange',['gold','gear']).allowed,false,'gear craft cannot spend wing or upkeep or held funds');
  assert.equal(parallel.window({...a,lastSave:{...rs,lv:119}},at),false);assert.equal(parallel.window({...a,v2:{sourceCoherence:{matches:false}}},at),false);
  assert.equal(parallel.window({...a,bossWindow:{...a.bossWindow,spawnAt:at+100000}},at),false,'near spawn retains return ownership');
  board.list[0].up=true;assert.equal(parallel.window(a,at),false,'early native spawn preempts gear');board.list[0].up=false;
  board._receivedAt=at-31000;assert.equal(parallel.window(a,at),false,'stale server timer cannot authorize gear');board._receivedAt=at;
  const final={...a,endgameCampaign:{...a.endgameCampaign,ready:true}};assert.equal(parallel.window(final,at),false);assert.equal(paid.preflight(final,'craftAtExchange',['gold','gear']).allowed,false,'ready final wing owns the wallet');
  cat.world.bagCap=()=>10;
  const craftActor={...a,lastSave:save,developmentLedger:{blocking:()=>null,view:()=>[]},planBag:async()=>({equip:[{id:'gold',slot:'weapon'}]})};let crafts=0,equips=0;
  craftActor.craftAtExchange=async(name,type)=>{assert.equal(name,'gold');assert.equal(type,'gear');crafts++;craftActor.lastSave={...save,bag:[{id:'gold'}]};craftActor.lastSaveAt=Date.now()+1;return {ok:true};};
  craftActor.equipItems=async()=>{equips++;return {equipped:1};};
  await runtime.tick(craftActor,{});assert.equal(crafts,1);assert.equal(equips,1,'owned native save triggers equip, not the click response alone');assert.equal(craftActor.equipmentMaintenanceStatus.status,'change_observed');
  craftActor.lastSave=save;craftActor.dailyTeamPending=true;await runtime.tick(craftActor,{});assert.equal(crafts,1,'team owner blocks paid side craft');craftActor.dailyTeamPending=false;
  craftActor.developmentLedger={blocking:()=>({status:'pending'}),view:()=>[{kind:'craft',status:'pending'}]};await runtime.tick(craftActor,{});assert.equal(crafts,1,'pending native result never replays the craft');
  const j={fresh:true,saveAt:at,milestones:{stage:'equipment'},steps:[{id:'gear',legendary:'6/8',refine10:'2/7'}],slotQueue:[],verified:[]};const compact=ctx.characterJourneyLayout(j,true);assert(compact.includes('6/8 Legendary · เพดาน รอข้อมูล')&&compact.includes('เพดานตีบวกตามกฎเกมที่โหลด'));
 }
 console.log('PASS Legendary-only promotion/no downgrade, distinct accessory and legal/unknown guards, exact +9 -> +10 native 6%/cost/ore, one paid attempt and reserve/owner/no-replay guards, negative-score ready craft/trade, truthful native slot refinement and unknown capability completion and UI');
{
 const s={...save,equip:{weapon:'gold',armor:'full_armor',wing:'wing'},refine:{gold:9,full_armor:0}};
 const a={root,lastSave:s,catalog:()=>cat,endgameCampaign:{phase:'complete'}};
 const step=runtime.refineOpportunity(a);assert.equal(step.id,'full_armor','guaranteed cheap armor beats always-weapon low odds');assert.equal(step.to,1);assert(step.valuePerCopper>0&&step.expectedGain>0);
 a.lastSave={...s,materials:{Starmetal:0}};assert.equal(runtime.refineOpportunity(a),null,'no positive estimate authorizes missing materials');
 console.log('PASS role-weighted expected native refine value before weapon bias');
}
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1});
