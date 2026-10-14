'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const fresh=(at,age,now)=>Number.isFinite(at)&&at<=now&&now-at<age;
const indexes=new WeakMap();
function dropIndex(wiki){if(!wiki)return new Map();if(indexes.has(wiki))return indexes.get(wiki);const index=new Map();for(const monster of wiki.monsters?.monsters||[]){if(monster.kind!=='normal')continue;const maps=(wiki.maps?.maps||[]).filter(m=>m.kind==='field'&&m.monsters?.normal?.includes(monster.id));for(const drop of monster.dropTable||[]){if(!(drop.ratePct>0))continue;const rows=index.get(drop.item)||[];for(const map of maps)rows.push({monster,map,drop});index.set(drop.item,rows);}}indexes.set(wiki,index);return index;}
function safetyHold(i,now){const s=i.survivalStatus;return !!(i.survivalRecovery||i.defensiveMode||s&&(s.recovering||!Number.isFinite(s.until)||s.until>now));}
function milestoneWait(i,now){const p=i.endgameCampaign,w=i.bossWindow;return !!(i.actorIdentity?.actorId&&['class','wing'].includes(p?.phase)&&p.ready===false&&w?.phase==='side-work'&&fresh(w.assignedAt,120000,now)&&Number.isFinite(w.departAt)&&w.departAt>now+120000&&i.v2?.sourceCoherence?.matches===true);}
function project(i){
 if(!i.lastSave||typeof i.catalog!=='function')return {at:i.lastSaveAt||null,phase:'waiting',needs:[],reserved:{},helper:false,blocked:[],kills:0,monsterId:null};
 const now=Date.now(),s=i.lastSave||{},needs=[];let p=i.endgameCampaign;
 // Reserve progression inputs from the first save, even while boot/supplies
 // delay the first campaign tick. Unknown phase is never a donor surplus.
 if(!p?.phase&&s.lv>=i.catalog().world?.MAX_LV){try{p=require('./capped-campaign').plan(i);}catch{p={phase:'waiting'};}}
 for(const r of p?.requirements||[])if(r.name&&r.want>0&&!['Copper','coins'].includes(r.name))needs.push({name:r.name,want:r.want,priority:p.phase==='class'?0:10,kind:p.phase});
 try{const q=require('./main-quest').catalog(i.root,i.catalog().build).quests[s.qIndex];if(q?.kind==='collect')needs.push({name:q.item,want:q.need,priority:20,kind:'quest'});}catch{}
 // Missing inputs are demands before the recipe is ready, including zero stock.
 // The profile merges the reviewed native recipes; wiki recipe names use result.
 if(p?.phase==='complete'||s.lv<i.catalog().world?.MAX_LV&&!p?.active&&s.lv>=20){
  const key=JSON.stringify([i.catalog().build,s.job,s.lv,s.jobLv,s.bag,s.equip,s.refine,s.stage,s.materials,s.coins,s.petActive,s.qIndex,s.qv,s.stats,s.skills,s.holes,s.sockets,s.weaponOpts]);
  if(!i.teamCraftProjection||i.teamCraftProjection.key!==key||now-i.teamCraftProjection.at>=30000)i.teamCraftProjection={key,at:now,craft:require('../character-brain').profile(s,i.catalog(),require('../economy').loadWiki(i.root),{reserved:require('../runtime/paid-actions').heldResources(i),...require('../runtime/craft-scope').profileOptions(i)}).craft};
  const craft=i.teamCraftProjection.craft;
  for(const [name,want]of Object.entries(craft?.cost||{}))if(!['Copper','coins','tokens','runeDust'].includes(name)&&!Object.values(i.catalog().items||{}).some(it=>it.name===name||it.id===name))needs.push({name,want,priority:30,kind:'craft'});
  const work=i.progressionWork;
  if(work?.build===i.catalog().build&&fresh(work.at,30000,now))for(const c of work.candidates||[])if(c.kind==='craft-work'&&c.monsterKind==='normal'&&c.acquisition?.finishable&&!needs.some(n=>n.name===c.material))needs.push({name:c.material,want:c.acquisition.want,priority:40,kind:'craft-alternative'});
 }
 if(require('../equipment-goal').policy(i.catalog()).dynamicProgression&&i.v2?.sourceCoherence?.matches===true){
  for(const goal of require('./combat-work').requirements(i,require('../economy').loadWiki(i.root),now))for(const need of goal.missing||[])if(typeof need.name==='string'&&need.want>0&&!needs.some(n=>n.name===need.name)&&!Object.hasOwn(s.consumables||{},need.name))needs.push({name:need.name,want:need.want,priority:40,kind:goal.purpose});
 }
 const reserved=Object.fromEntries(Object.entries(i.v2?.reservations?.totals(i.catalog().build)||{}).filter(([,n])=>n>0));
 const boss=i.socialInbox?.last?.('bossboard'),bossProof={ignar_the_flame_tyrant:s.bestiary?.ignar_the_flame_tyrant||0};
 const bossBoard=boss&&Number.isFinite(boss.now)&&fresh(boss._receivedAt,30000,now)?{_receivedAt:boss._receivedAt,now:boss.now,list:(boss.list||[]).filter(b=>b.id==='ignar_the_flame_tyrant'&&b.map==='n3').slice(0,1).map(b=>({id:b.id,map:b.map,up:!!b.up,next:Number.isFinite(b.next)?b.next:null}))}:null;
 return {milestones:(()=>{const m=require('./progression-priority').assess(s,i.catalog());return {stage:m.stage,equipmentAllowed:m.equipmentAllowed};})(),equipment:(()=>{const m=require('../equipment-goal').assess(s,i.catalog());return m?{legendaryEquipped:m.legendaryEquipped,refine10Equipped:m.refine10Equipped,complete:m.complete}:null;})(),at:i.lastSaveAt,phase:p?.phase||'training',needs:needs.slice(0,24),reserved,bossProof,bossBoard,helperWaitUntil:milestoneWait(i,now)?i.bossWindow.departAt:null,helper:(p?.phase==='complete'||milestoneWait(i,now)||s.lv<i.catalog().world?.MAX_LV&&!p?.active&&s.lv>=40)&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.v2?.trial?.active()&&i.v2?.sourceCoherence?.matches!==false&&(!i.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))&&(!i.pendingTravel||i.goal?.kind==='team-gather')&&!i.choresBusy&&!safetyHold(i,now)&&require('../runtime/survival').hpPots(s)>=20,
  blocked:Object.keys(i.brain?.blocked?.(now)||{}).slice(0,24),kills:i.goal?.monsterId?s.bestiary?.[i.goal.monsterId]||0:0,monsterId:i.goal?.monsterId||null};
}
function holdings(m,name){return Number(m.teamInventory?.materials?.[name])||0;}
function available(m,name){const held=Number(m.teamWork?.reserved?.[name]??m.teamInventory?.reserved?.[name]??0);return Number.isFinite(held)&&held>=0?Math.max(0,holdings(m,name)-held):0;}
function ownKeep(m,name){if(['waiting','training'].includes(m.teamWork?.phase)&&require('../upgrade-reserve').cores.includes(name))return holdings(m,name);return Math.max(0,...(m.teamWork?.needs||[]).filter(r=>r.name===name).map(r=>Number(r.want)||0),0)+(Number(m.teamWork?.reserved?.[name])||0);}
class TeamWorkboard{
 constructor(root,config,{now=Date.now}={}){this.config=config;this.now=now;this.file=path.join(root,'logs/fleet/team-workboard.json');try{this.state=JSON.parse(fs.readFileSync(this.file));}catch{this.state={version:1,assignments:[],cooldowns:[]};}}
 reconcile(sources,wiki){
  const now=this.now(),build=sources.find(s=>s.machine===(this.config.coordinatorHost||'tum'))?.build,members=this.config.members.map(r=>{const src=sources.find(s=>s.machine===r.machine),m=src?.members?.find(m=>m.slot===r.slot&&m.charName===r.charName);return src?.build===build&&fresh(src.at,15000,now)&&m?.status==='playing'&&!m.recycling&&fresh(m.lastSaveAt,30000,now)&&fresh(m.teamWork?.at,30000,now)&&fresh(m.teamInventory?.at,30000,now)?{...m,machine:r.machine}:null;}).filter(Boolean);
  const quarantined=[...sources.flatMap(s=>s.tradeWorkflow?.blockedMaterials||[]),...sources.flatMap(s=>s.tradeWorkflow?.quarantined||[]).filter(q=>q.offer?.kind==='material'&&q.resolution==='unresolved_no_replay').map(q=>q.offer.name)];
  const old=this.state.build===build?this.state.assignments:[],cooldowns=(this.state.build===build?this.state.cooldowns:[]).filter(c=>c.until>now),demands=[];
  for(const m of members)for(const r of m.teamWork.needs){const have=available(m,r.name),rawHave=holdings(m,r.name),short=Math.max(0,r.want-have);if(!short)continue;const stored=m.teamInventory?.locks?.includes(r.name)?0:Number(m.teamInventory?.storageMaterials?.[r.name])||0;const surplus=members.filter(d=>d.charName!==m.charName).reduce((n,d)=>n+(d.teamInventory?.locks?.includes(r.name)?0:Math.max(0,holdings(d,r.name)-ownKeep(d,r.name))),0);demands.push({...r,receiver:m.charName,have,rawHave,reservedHave:Math.max(0,rawHave-have),stored,short,available:surplus,status:quarantined.includes(r.name)?'reconcile-trade':stored>0?'withdraw-pending':surplus>0?'transfer-pending':'gather'});}
  const allocation=require('./carry-allocation').allocate(this.state.allocation,members,demands,{now,build});demands.sort((a,b)=>a.allocationPriority-b.allocationPriority||a.receiver.localeCompare(b.receiver));const assignments=[],index=dropIndex(wiki);
  for(const m of members){if(!m.teamWork.helper||!fresh(m.livePos?.at,10000,now)||!fresh(m.vitals?.at,15000,now)||m.vitals.hp<.95||m.livePos.dead||/^(tw|dx|gd|pv)/.test(m.livePos.room||''))continue;
   const candidates=[],travelCache=new Map();
   for(const d of demands){if(d.receiver===m.charName||d.status!=='gather'||m.teamInventory?.locks?.includes(d.name))continue;
    // Bounded assistance for the verified missing wing core. A helper must
    // already have killed this boss; a fresh server round controls departure.
    if(m.teamWork.phase==='complete'&&d.name==='Tyrant Ember'&&m.teamWork.bossProof?.ignar_the_flame_tyrant>0&&!m.actionOwner){
     const b=m.teamWork.bossBoard,f=b?.list?.find(r=>r.id==='ignar_the_flame_tyrant'&&r.map==='n3'),monster=wiki.monsters?.monsters?.find(r=>r.id==='ignar_the_flame_tyrant'),map=wiki.maps?.maps?.find(r=>r.id==='n3');
     const travel=require('./boss-window').travelBudget(m.livePos.room,'n3',wiki),live=f?.up&&!f.next,spawnAt=!live&&Number.isFinite(f?.next)&&Number.isFinite(b?.now)?f.next+b._receivedAt-b.now:null;
     if(monster?.kind==='boss'&&monster.level<=m.lv-20&&map?.kind==='field'&&!m.teamWork.blocked.includes('n3')&&fresh(b?._receivedAt,30000,now)&&Number.isFinite(travel.ms)&&(live||spawnAt>now&&now>=spawnAt-90000-travel.ms)){
      const id=crypto.createHash('sha256').update(JSON.stringify([build,m.charName,d.receiver,d.name,'ignar_the_flame_tyrant','n3'])).digest('hex').slice(0,20);
      if(!cooldowns.some(c=>c.id===id))candidates.push({id,helper:m.charName,receiver:d.receiver,material:d.name,mapId:'n3',monsterId:'ignar_the_flame_tyrant',monsterKind:'boss',priority:d.allocationPriority,rate:100,travelMs:travel.ms,baseline:holdings(m,d.name),kind:'team-gather',alive:!!live,spawnAt,short:d.short,score:5100-d.priority,label:'ช่วย '+d.receiver+' หา Tyrant Ember',reason:'เคยฆ่าบอสนี้แล้ว · รอบเซิร์ฟเวอร์สด · เก็บแกนส่วนเกินแล้วเทรดยืนยัน'});
     }
    }
    for(const {map,monster,drop}of index.get(d.name)||[]){if(m.teamWork.phase!=='complete'&&(map.id!==m.livePos.room||m.teamWork.monsterId!==monster.id||!(m.teamWork.kills>0)))continue;if(!Number.isFinite(map.levelMax)||map.levelMax>m.lv-20||m.teamWork.blocked.includes(map.id)||monster.level>m.lv-20||(map.monsters?.boss||[]).length||(map.monsters?.miniboss||[]).length)continue;
     if(!travelCache.has(map.id))travelCache.set(map.id,require('./boss-window').travelBudget(m.livePos.room,map.id,wiki));const travel=travelCache.get(map.id);if(travel.ms>155000&&!old.some(a=>a.helper===m.charName&&a.receiver===d.receiver&&a.material===d.name&&a.mapId===map.id))continue;
      const id=crypto.createHash('sha256').update(JSON.stringify([build,m.charName,d.receiver,d.name,monster.id,map.id])).digest('hex').slice(0,20);
      if(cooldowns.some(c=>c.id===id))continue;
      candidates.push({id,helper:m.charName,receiver:d.receiver,material:d.name,mapId:map.id,monsterId:monster.id,monsterKind:'normal',priority:d.allocationPriority,rate:drop.ratePct,travelMs:travel.ms,baseline:holdings(m,d.name),kind:'team-gather',alive:true,score:2100-d.priority,label:'ช่วย '+d.receiver+' หา '+d.name,reason:'ของทีมยังขาด · รอเทรดยืนยันก่อนนับว่าส่งแล้ว'});
    }
   }
   const available=candidates.filter(c=>!assignments.some(a=>a.receiver===c.receiver&&a.material===c.material||c.monsterKind==='boss'&&a.mapId===c.mapId&&a.monsterId===c.monsterId));available.sort((a,b)=>a.priority-b.priority||a.travelMs-b.travelMs||b.rate-a.rate||a.id.localeCompare(b.id));const prior=old.find(a=>a.helper===m.charName&&a.generation===(m.runtimeGeneration||null)),retained=prior&&available.find(c=>c.id===prior.id),pick=retained||available[0];if(!pick)continue;
   const kills=m.teamWork.monsterId===pick.monsterId?m.teamWork.kills:null,progress=retained&&(holdings(m,pick.material)>prior.stock||(kills!=null&&prior.kills!=null&&kills>prior.kills));
   const progressAt=progress?now:retained?prior.progressAt:now;
   const awaitingBoss=pick.monsterKind==='boss'&&(!pick.alive||m.livePos.room!==pick.mapId);
   if(retained&&(!awaitingBoss&&now-progressAt>=300000||now-prior.startedAt>=1200000)){cooldowns.push({id:pick.id,until:now+600000,reason:now-progressAt>=300000?'ไม่มีผลฆ่าหรือของเพิ่ม 5 นาที':'ครบช่วงช่วยทีม 20 นาที สลับไปพัฒนาตัวเอง'});continue;}
   // At most one helper per demand; use donor surplus before farming more.
   if(assignments.some(a=>a.receiver===pick.receiver&&a.material===pick.material))continue;
   if(pick.monsterKind==='boss'&&holdings(m,pick.material)-ownKeep(m,pick.material)>=pick.short)continue;
   assignments.push({...pick,helperActorId:m.identity?.actorId||null,beneficiaryActorId:demands.find(d=>d.receiver===pick.receiver&&d.name===pick.material)?.beneficiaryActorId||null,returnAt:m.teamWork.helperWaitUntil||null,generation:m.runtimeGeneration||null,baseline:retained?prior.baseline:pick.baseline,stock:holdings(m,pick.material),kills,startedAt:retained?prior.startedAt:now,progressAt:awaitingBoss?now:progressAt,deadline:Math.min(now+120000,m.teamWork.helperWaitUntil||Infinity),at:now,build});
  }
  this.state={version:2,allocation,at:now,build,complete:members.length===this.config.members.length,protectedNames:[...new Set(members.flatMap(m=>[...m.teamWork.needs.map(r=>r.name),...Object.keys(m.teamWork.reserved)]))].slice(0,100),demands:demands.slice(0,100),assignments,cooldowns:cooldowns.slice(-60),reason:members.length===this.config.members.length?'ใช้ของส่วนเกินก่อนฟาร์มเพิ่ม · งานช่วยทีมมี lease 2 นาที':'สมาชิกบางเครื่องไม่พร้อม · งานส่วนตัวเดินต่อและงดบริจาคของทีม'};
  fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.state));fs.renameSync(this.file+'.tmp',this.file);return this.state;
 }
}
function candidate(i,now=Date.now()){
 if(i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.v2?.trial?.active()||i.v2?.sourceCoherence?.matches===false||i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))return null;
 const board=i.teamWorkboard,a=board?.assignments?.find(a=>a.helper===i.credentials?.charName),build=i.catalog().build;
 if(!a||a.generation&&a.generation!==i.v2?.observations?.sessionId||board.build!==build||a.build!==build||!fresh(board.at,15000,now)||a.deadline<=now||!fresh(i.lastSaveAt,30000,now)||!fresh(i.livePos?.at,10000,now)||!fresh(i.vitals?.at,15000,now)||i.vitals.hp<.95||i.livePos.dead||i.teamControl||(i.pendingTravel&&i.goal?.workId!==a.id)||i.choresBusy||i.recycling||safetyHold(i,now)||require('../runtime/survival').hpPots(i.lastSave)<20||(i.endgameCampaign?.phase!=='complete'&&(!milestoneWait(i,now)&&(i.endgameCampaign?.active||i.lastSave.lv>=i.catalog().world?.MAX_LV||i.lastSave.lv<40)||a.monsterKind!=='normal'||a.mapId!==i.livePos.room||!(i.lastSave.bestiary?.[a.monsterId]>0)))||/^(tw|dx|gd|pv)/.test(i.livePos.room||'')||i.brain?.blocked?.(now)?.[a.mapId])return null;
 if(a.helperActorId&&a.helperActorId!==i.actorIdentity?.actorId||a.returnAt&&now+120000>=a.returnAt)return null;
 if(board.demands?.every(d=>d.receiver!==a.receiver||d.name!==a.material||d.status!=='gather'))return null;
 if(a.monsterKind==='boss'){
  const b=i.socialInbox?.last?.('bossboard'),f=b?.list?.find(r=>r.id===a.monsterId&&r.map===a.mapId),s=i.lastSave;
  if(a.material!=='Tyrant Ember'||a.monsterId!=='ignar_the_flame_tyrant'||a.mapId!=='n3'||!(s.bestiary?.[a.monsterId]>0)||!fresh(b?._receivedAt,30000,now)||!f)return null;
  const live=!!(f.up&&!f.next),spawnAt=Number.isFinite(f.next)&&Number.isFinite(b.now)?f.next+b._receivedAt-b.now:null,travel=require('./boss-window').travelBudget(i.livePos.room,a.mapId,require('../economy').loadWiki(i.root));
  if(!live&&(!(spawnAt>now)||!Number.isFinite(travel.ms)||now<spawnAt-90000-travel.ms))return null;
  return {...a,alive:live,spawnAt,workId:a.id};
 }
 return {...a,workId:a.id};
}
module.exports={TeamWorkboard,project,candidate,ownKeep,available,fresh,milestoneWait};
