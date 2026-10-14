'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),economy=require('../economy'),gearValue=require('../gear-value');
const SLOTS=['weapon','offhand','head','armor','boots','wing','acc1','acc2','accessory'],num=v=>Number.isFinite(v)&&v>=0?v:null;
function normalize(m,at=Date.now()){
 if(m?.t!=='inspect'||typeof m.name!=='string'||!m.name||m.name.length>80)return null;
 const row={name:m.name,job:typeof m.job==='string'?m.job.slice(0,40):null,lv:num(m.lv),jobLv:num(m.jobLv),power:num(m.pw),hidden:!!m.hidden,gone:!!m.gone,at,gear:{}};
 if(row.hidden||row.gone)return row;
 for(const slot of SLOTS){const g=m.gear?.[slot];if(!g||typeof g.id!=='string'||g.id.length>100)continue;const cards=g.c||g.cards,opts=g.o||g.options;row.gear[slot]={id:g.id,refine:num(g.r??g.refine),stage:num(g.s??g.stage),holes:num(g.h??g.holes),cards:Array.isArray(cards)?cards.filter(c=>typeof c==='string'&&c.length<100).slice(0,8):[],options:Array.isArray(opts)?opts.slice(0,4).map(o=>o&&typeof o.k==='string'&&Number.isFinite(o.v)?{k:o.k.slice(0,40),v:o.v}:null):[]};}return row;
}
function family(job,world){return economy.jobChain(job,world).find(j=>['knight','priest','mage','ranger','assassin','monk'].includes(j))||job;}
function compare(save,cat,wiki,peer,now=Date.now()){
 const fresh=now-peer.at>=-5000&&now-peer.at<=900000,compatible=family(save.job,cat.world)===family(peer.job,cat.world),drops=economy.gearFarm({lv:save.lv,job:save.job,world:cat.world,items:cat.items,wiki,minTier:0,limit:1000});
 const rows=Object.entries(peer.gear).map(([peerSlot,g])=>{const it=cat.items[g.id],test=gearValue.compare(save,cat,g.id),slot=test.slot||peerSlot,own=save.equip?.[slot],recipe=wiki?.crafting?.recipes?.find(r=>r.resultId===g.id),drop=drops.find(d=>d.itemId===g.id),usable=!!it&&it.slot===(peerSlot.startsWith('acc')?'acc':peerSlot)&&economy.canUse(it,save.job,cat.world)&&(it.reqLv||1)<=save.lv;
 return {slot,peerSlot,id:g.id,name:it?.name||g.id,ownId:own||null,ownName:cat.items[own]?.name||own||'ว่าง',refine:g.refine,ownRefine:save.refine?.[own]||0,stage:g.stage,ownStage:save.stage?.[own]||0,cards:g.cards,ownCards:save.sockets?.[own]||[],options:g.options,usable,baseGain:test.gain,upgrade:fresh&&compatible&&usable&&own!==g.id&&test.upgrade,source:drop?{kind:'drop',detail:drop}:recipe?{kind:'craft',name:recipe.result,cost:recipe.cost,reqLv:recipe.reqLv,verified:require('../knowledge/development-source').check(process.cwd(),cat.build,'craft',[recipe.result,recipe.type],cat,wiki).allowed}:null,reason:!fresh?'ข้อมูลคู่เทียบเก่า':!compatible?'คนละสายอาชีพ':!it?'ไอเทมยังไม่มีในแค็ตตาล็อก':!usable?'ยังใช้ไม่ได้ตามคลาสหรือเลเวล':own===g.id?'มีไอเทมชนิดเดียวกันแล้ว · เทียบการพัฒนาเพิ่ม':test.upgrade?'เปลี่ยนไอเทมฐานแล้วคะแนนทั้งชุดเพิ่ม':'ยังไม่พบว่าดีกว่าชุดปัจจุบัน'};});
 return {...peer,fresh,compatible,rows,targets:rows.filter(r=>r.upgrade&&r.source&&(r.source.kind==='drop'||r.source.verified)).sort((a,b)=>b.baseGain-a.baseGain),caveat:'คะแนนคาดการณ์จากไอเทมฐาน ไม่ใช่ DPS จริงหรือพลังทั้งชุดของคู่แข่ง; ขั้น ออฟ และการ์ดแสดงตามข้อมูลเซิร์ฟเวอร์'};
}
class CompetitiveGear{
 constructor(root,name){this.file=path.join(root,'logs/competitive-gear',crypto.createHash('sha256').update(name).digest('hex').slice(0,24)+'.json');this.peers={};this.history=[];try{const r=JSON.parse(fs.readFileSync(this.file));this.peers=r.peers||{};this.history=r.history||[];}catch{}}
 observe(frame,build,rank){const r=normalize(frame,frame?._receivedAt);if(!r)return false;const old=this.peers[r.name];if(old&&r.at<=old.at)return false;if(JSON.stringify(old?.gear)!==JSON.stringify(r.gear))this.history.push({at:r.at,name:r.name,build,gear:r.gear});this.peers[r.name]={...r,build,rank:rank?{position:rank.pos,category:rank.rankCategory,value:rank.v}:old?.rank||null};this.history=this.history.slice(-100);this.peers=Object.fromEntries(Object.entries(this.peers).sort((a,b)=>b[1].at-a[1].at).slice(0,24));fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({peers:this.peers,history:this.history}));fs.renameSync(this.file+'.tmp',this.file);return true;}
 view(save,cat,wiki,build,now=Date.now(),rankings=null){
  const categories=rankings?.categories||{},freshRank=r=>r?.fresh&&Number.isFinite(r.receivedAt)&&now-r.receivedAt>=0&&now-r.receivedAt<=360000;
  const leaders=new Set(Object.values(categories).filter(freshRank).flatMap(r=>r.leaders||[]).filter(r=>Number.isInteger(r.pos)&&r.pos>=1&&r.pos<=10).map(r=>r.name));
  const peers=Object.values(this.peers).filter(p=>p.build===build).map(p=>({...compare(save,cat,wiki,p,now),currentTop10:rankings?leaders.has(p.name):null}));
  const targets=peers.filter(p=>rankings?p.currentTop10:true).flatMap(p=>p.targets.map(t=>({...t,benchmark:p.name,observedAt:p.at,benchmarkEvidence:rankings?'fresh_server_top10_and_current_build_inspect':'inspect_only_not_current_rank'}))).sort((a,b)=>b.baseGain-a.baseGain).filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i).slice(0,8);
  return {at:now,build,targetTop:10,peers,targets,rankingGaps:Object.fromEntries(Object.entries(categories).map(([k,r])=>[k,freshRank(r)?{position:r.me?.pos??null,targetValue:r.targetValue,valueGap:r.valueGap,placesToTarget:r.placesToTarget,receivedAt:r.receivedAt}:null])),priority:'pet_class_first_wing_then_role_gain; validate_actual_effect_after_equip',caveat:'Rank gap is observed; baseGain is a role-weighted estimate, not measured damage or a Top10 guarantee'};
 }
}
async function tick(i,s,now=Date.now()){
 if(!i.character?.name||!i.lastSaveAt||now-i.lastSaveAt>30000||now-i.lastSaveAt < -5000)return null;
 const cat=i.catalog(),build=path.basename(i.cache.dir),wiki=economy.loadWiki(i.root),store=i.competitiveGearStore||(i.competitiveGearStore=new CompetitiveGear(i.root,i.character.name));
 i.competitiveGear=store.view(i.lastSave,cat,wiki,build,now,i.serverRankings?.view(now)||{categories:{}});i.lastSave.competitiveTargets=i.competitiveGear.targets;
 if(now<(i.nextInspectAt||0)||i.rankQueryBusy||s.death||s.panelOpen||i.vitals?.hp<0.7||i.teamControl||i.choresBusy||i.recycling||i.pendingTravel||require('../runtime/room-policy').roomPolicy(i.livePos?.room).dungeon||i.endgameCampaign?.ready||['boss','miniboss'].includes(i.goal?.monsterKind)||i.goal?.kind==='boss'||i.campaignGoal?.kind==='boss')return null;
 const ranks=i.serverRankings?.view(now).categories||{},candidates=[...new Map(Object.entries(ranks).filter(([,r])=>r?.fresh).flatMap(([category,r])=>r.leaders.map(p=>({...p,rankCategory:category}))).filter(r=>r.name!==i.character.name).map(r=>[r.name,r])).values()];
 candidates.sort((a,b)=>Number(family(b.job,cat.world)===family(i.lastSave.job,cat.world))-Number(family(a.job,cat.world)===family(i.lastSave.job,cat.world)));
 const target=candidates.find(r=>!store.peers[r.name]||store.peers[r.name].build!==build||now-store.peers[r.name].at>900000);if(!target)return null;i.nextInspectAt=now+120000;
 try{await i.socialSend('inspect',{name:target.name});const until=Date.now()+5000;while(Date.now()<until){const frame=i.socialInbox.last('inspect:'+target.name);if(frame&&frame._receivedAt>=now){store.observe(frame,build,target);i.competitiveGear=store.view(i.lastSave,cat,wiki,build,Date.now(),i.serverRankings?.view()||{categories:{}});i.lastSave.competitiveTargets=i.competitiveGear.targets;return 'competitive gear: observed '+target.name;}await new Promise(r=>setTimeout(r,250));}return 'competitive gear: server response not observed';}
 finally {try{const screen=await i.screen();if(screen.panelName==='inspect')await i.closeGamePanel();}catch{}}
}
module.exports={normalize,compare,CompetitiveGear,tick};
