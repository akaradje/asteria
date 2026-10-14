'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-progression-core-'));
const budget=require('../src/planning/side-work-budget'),route=require('../src/planning/training-route'),storage=require('../src/runtime/personal-storage');
const build=require('../machines/fleet-client-release.json').build;
async function main(){
 let now=Date.now(),g={kind:'card-collection',mapId:'n1',monsterId:'normal',monsterKind:'normal',cardId:'normal'};
 const i={root,character:{name:'Fixture'},catalog:()=>({build:'fixture',world:{}}),lastSaveAt:now,lastSave:{lv:120,autoTargets:['normal'],bestiary:{normal:1},cards:{},cardAlbum:{},sockets:{}},livePos:{room:'n1',at:now},goal:g,v2:{sourceCoherence:{matches:true}}};
 const step=(kills=true)=>{now+=15000;i.lastSaveAt=i.livePos.at=now;if(kills)i.lastSave.bestiary.normal++;return budget.filter(i,[g],now);};
 budget.filter(i,[g],now);for(let n=0;n<79;n++)assert.equal(step().length,1);assert.equal(step().length,0,'kills do not prove target card received after bounded dry window');assert.equal(i.campaignWorkStatus.blocked.length,1);
 const resumed={...i,sideWorkBudget:null};assert.equal(budget.filter(resumed,[g],now).length,0,'job cooldown survives process restart');
 i.catalog=()=>({build:'new',world:{}});assert.equal(budget.filter(i,[g],now).length,1,'build contexts isolated');assert.equal(i.sideWorkBudget.data.history[0].build,'fixture');
 i.teamControl=true;for(let n=0;n<90;n++)assert.equal(step(false).length,1,'team-owned time cannot trigger a recovery');i.teamControl=false;
 budget.filter(i,[g],now);for(let n=0;n<19;n++)assert.equal(step(false).length,1);i.lastSave.cards.normal=1;assert.equal(step(false).length,1,'native card output resets job budget');assert.equal(i.campaignWorkStatus.quietMs,0);
 assert.equal(budget.key({...g,monsterKind:'boss'}),null,'boss rounds never use normal-job dry timeout');
 const {TeamWorkboard}=require('../src/planning/team-workboard'),members=['Receiver','Donor'].map((charName,n)=>({slot:n,charName,status:'playing',lastSaveAt:now,livePos:{room:'town',at:now},vitals:{hp:1,at:now},teamInventory:{at:now,materials:{Core:n?1:0},storageMaterials:{},locks:[]},teamWork:{at:now,phase:'complete',needs:n?[]:[{name:'Core',want:3,priority:0,kind:'class'}],reserved:{},helper:true,blocked:[]}}));
 const board=new TeamWorkboard(root,{members:members.map(m=>({machine:'tum',slot:m.slot,charName:m.charName}))},{now:()=>now}),sources=()=>[{machine:'tum',at:now,build:'fixture',members}];
 assert.equal(board.reconcile(sources(),{}).demands[0].status,'transfer-pending','partial surplus used before assigning more gathering');members[0].teamInventory.storageMaterials.Core=2;assert.equal(board.reconcile(sources(),{}).demands[0].status,'withdraw-pending','own storage is not a missing drop or a received trade');members[0].teamInventory.storageMaterials.Core=0;members[1].teamInventory.materials.Core=0;assert.equal(board.reconcile(sources(),{}).demands[0].status,'gather');
 const evidence={confidence:'observational',at:now,samples:20,ms:600000,coveragePct:100,deaths:0,expPerHour:0};
 const exp={kind:'exp',monsterKind:'normal',mapId:'n1',monsterId:'normal',kills:1,score:99999,routeEvidence:evidence};
 const actor={root,credentials:{charName:'route-fixture'},lastSave:{lv:110,job:'asura'},lastSaveAt:now,livePos:{room:'town'},catalog:()=>({build:'fixture',world:{}})};
 assert.equal(route.choose(actor,[exp],now).goal,null,'measured zero cannot return through optimistic score');
 assert.equal(route.choose(actor,[{...exp,routeEvidence:{...evidence,deaths:1,expPerHour:9999}}],now).goal,null,'dead route cannot return through prior estimates');
 assert(route.choose(actor,[{...exp,routeEvidence:{...evidence,expPerHour:100},farmEvidence:{at:now,samples:20,minutes:10,confidence:'observational',expPerHour:200,deaths:1}}],now).goal,'whole-cycle safe evidence outranks field-only death history');
 const {CompetitiveGear}=require('../src/observability/competitive-gear'),store=new CompetitiveGear(root,'rank-fixture');
 const cat={world:{JOBS:{knight:{}}},items:{old:{id:'old',slot:'weapon',name:'Old',stats:{atk:1}},best:{id:'best',slot:'weapon',name:'Best',stats:{atk:50}}}},wiki={monsters:{monsters:[{name:'Prey',level:10,dropTable:[{item:'Best',ratePct:10}]}]}};
 store.observe({t:'inspect',name:'Leader',job:'knight',lv:120,gear:{weapon:{id:'best'}},_receivedAt:now},'fixture');
 const save={job:'knight',lv:120,equip:{weapon:'old'}},rank={categories:{power:{fresh:true,receivedAt:now,leaders:[{name:'Leader',pos:1}],me:{pos:50},targetValue:100,valueGap:90,placesToTarget:40}}};
 assert.equal(store.view(save,cat,wiki,'fixture',now,rank).targets.length,1);rank.categories.power.fresh=false;assert.equal(store.view(save,cat,wiki,'fixture',now,rank).targets.length,0,'old inspect cannot pretend current Top10');rank.categories.power.fresh=true;rank.categories.power.leaders[0].pos=11;assert.equal(store.view(save,cat,wiki,'fixture',now,rank).targets.length,0);
 // Execute the actual loaded game's material-move kernel through the native UI contract.
 const html=fs.readFileSync(path.join(process.cwd(),'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8'),start=html.indexOf('  function stMove(side, key, qty)'),end=html.indexOf('  let stAllArm',start);assert(start>0&&end>start);assert(html.includes('data-stq-in')&&html.includes("addEventListener('change', () => setQ(qIn.value))"));
 const realNow=Date.now;let saveClockOffset=0;Date.now=()=>realNow()+saveClockOffset;try{
 const a={root,character:{name:'storage-fixture'},catalog:()=>({build,items:{},world:{}}),lastSaveAt:Date.now(),lastSave:{materials:{Core:1},storage:{materials:{Core:4}},locks:[]},livePos:{room:'town',at:Date.now()},vitals:{hp:1,at:Date.now()},v2:{sourceCoherence:{matches:true}},openTownService:async()=>({ok:true}),closeGamePanel:async()=>{}};
 let selected=false,qty=4,clicks=0;const tile={dataset:{sk:'st|Core',tip:'m:Core'},disabled:false,classList:{contains:k=>k==='sel'&&selected},click(){selected=true;}};
 const context={storeTab:'mine',stCat:'mat',player:{materials:a.lastSave.materials},storage:a.lastSave.storage,clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),stEntries:()=>[{key:'Core',n:4}],stWhy:()=>'',sfx:()=>{},renderStorage:()=>{},saveGame:()=>{saveClockOffset++;a.lastSaveAt=Date.now();a.livePos.at=a.vitals.at=a.lastSaveAt;},Event:class {constructor(type){this.type=type;}}};
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 const q={value:qty,dispatchEvent(e){assert.equal(e.type,'change');qty=Number(this.value);}},go={disabled:false,click(){clicks++;context.stMove('st','Core',qty);}};
 const body={dataset:{stView:'mine|mat'},querySelectorAll:()=>[tile],querySelector:s=>s==='[data-stq-in]'?q:s==='.tile.sel[data-sk]'&&selected?tile:s==='[data-st-go]'?go:null};
 context.document={getElementById:()=>body,querySelector:()=>null};a.eval=code=>Promise.resolve(vm.runInContext(code,context));
 let result=await storage.restoreCampaignMaterial(a,{missing:[{name:'Core',want:3,have:1}]});assert.equal(result.moved,2);assert.equal(clicks,1);assert.equal(a.lastSave.materials.Core,3);assert.equal(a.lastSave.storage.materials.Core,2);
 a.lastSave.locks=['Core'];assert.equal(await storage.restoreCampaignMaterial(a,{missing:[{name:'Core',want:4,have:3}]}),null,'locked materials preserved');a.lastSave.locks=[];
 const hash=require('crypto').createHash('sha256').update(a.character.name).digest('hex').slice(0,24),file=path.join(root,'logs/storage-material',hash+'.json');fs.writeFileSync(file,JSON.stringify({build,at:Date.now()-1000,name:'Core',bag:0,stored:5,quantity:2,status:'UNCERTAIN'}));
 result=await storage.restoreCampaignMaterial(a,{missing:[{name:'Core',want:4,have:3}]});assert.equal(result.reason,'personal-material-move-awaiting-confirmation');assert.equal(clicks,1,'unknown move never replayed');
 }finally{Date.now=realNow;}
 console.log('PASS bounded actual-output jobs/restart/build/owner isolation, measured route rejection, fresh current Top10, actual native material kernel/quantity/two-sided receipt/locks/uncertain no replay');
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1;});
