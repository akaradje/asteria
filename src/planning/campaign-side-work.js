'use strict';
// Native ownership, not cardLog (historical discovery), closes a collection job.
function ownsCard(save,id){return (save.cards?.[id]||0)>0||!!save.cardAlbum?.[id]||Object.values(save.sockets||{}).some(rows=>Array.isArray(rows)&&rows.includes(id));}
function collection(save,cat,wiki){
 const known=Array.isArray(cat.world?.MONSTERS)?cat.world.MONSTERS:[],ids=known.flatMap(m=>[m.id,...(m.kind!=='normal'&&typeof cat.world.ACC_CARD_PRE==='string'?[cat.world.ACC_CARD_PRE+m.id]:[])]);
 const verified=wiki?._source?.verifiedBuild===cat.build&&!!save.cards&&!!save.cardAlbum;
 return {verified,owned:verified?ids.filter(id=>ownsCard(save,id)).length:null,total:ids.length,album:verified?ids.filter(id=>save.cardAlbum[id]).length:null,complete:verified&&ids.length>0&&ids.every(id=>ownsCard(save,id)),evidence:'owned_native_cards_album_sockets; not historical discovery or a reward receipt'};
}
function cards(i,wiki,now=Date.now()){
 const save=i.lastSave||{},cat=i.catalog(),view=collection(save,cat,wiki),rows=[];
 if(!view.verified||!require('../runtime/freshness').fresh(i.lastSaveAt,30000,now))return {view,candidates:rows};
 const native=new Map(cat.world.MONSTERS.map(m=>[m.id,m])),blocked=i.brain?.blocked?.(now)||{};
 for(const m of wiki.monsters?.monsters||[]){
  const rate=m.card?.dropChancePct,n=native.get(m.id);
  if(n?.kind!=='normal'||m.kind!=='normal'||n.level!==m.level||ownsCard(save,m.id)||!(save.bestiary?.[m.id]>0)||m.level>save.lv-20||!Number.isFinite(rate)||rate<=0||rate>100)continue;
  for(const map of wiki.maps?.maps||[]){
   // D1–D3 are ordinary world farming rooms named "dungeon" in the Wiki;
   // dx/gd/tw are owned team instances and must remain excluded.
   if(!['field','dungeon'].includes(map.kind)||require('../runtime/room-policy').roomPolicy(map.id).dungeon||map.bossRoom!==false||blocked[map.id]||map.levelMin>save.lv||!map.monsters?.normal?.includes(m.id))continue;
   const candidate={kind:'card-collection',cardId:m.id,mapId:map.id,mapName:map.name,monsterId:m.id,monster:m.name,monsterKind:'normal',alive:true,score:350,priority:2,dropRatePct:rate,label:'สะสมการ์ด: '+m.card.name,reason:'ยังไม่มีในกระเป๋า สมุด หรือรูอุปกรณ์ · มอนปกติที่มีประวัติฆ่าจริง',expectedKills:100/rate};
   const learned=i.v2?.farmEvidence?.matching?.(save,i.v2.learningRevision||cat.build,candidate),measured=learned?.samples>=10&&learned.ms>=300000&&now-learned.at>=0&&now-learned.at<86400000;
   if(learned?.cooldownUntil>now||measured&&learned.deaths>0)continue;
   const killsPerHour=measured?learned.kills*3600000/learned.ms:null;
   candidate.learning={samples:learned?.samples||0,measuredMinutes:measured?learned.ms/60000:null,killsPerHour,observedNetCards:measured?learned.netCards?.[m.id]||0:null,expectedCardsPerHour:killsPerHour===null?null:killsPerHour*rate/100,method:'comparable_build_loadout_observed_kills_times_verified_drop_rate; estimate not guarantee'};
   candidate.score+=Math.min(100,killsPerHour===null?rate:candidate.learning.expectedCardsPerHour*20);
   rows.push(candidate);
  }
 }
 return {view,candidates:rows};
}
function training(i,wiki,blocked={},now=Date.now()){
 const cat=i.catalog(),build=i.v2?.learningRevision||cat.build;
 if(i.lastSave?.lv>=cat.world?.MAX_LV)return require('./astral-path').training(i,wiki,now);
 let rows=require('./level-training').candidates(i.lastSave,wiki,cat,{room:i.livePos?.room,blocked,provenOnly:true,now,measurements:require('../runtime/route-travel').view(i,i.campaignRoutes,now)});
 if(i.v2?.sourceCoherence?.matches===true){
  rows=i.v2.farmEvidence?.rank(rows,i.lastSave,build)||rows;
  rows=i.v2.expRouteEvidence?.decorate(rows,i.lastSave,build)||rows;
 }
 const {cycleMeasured,measured}=require('./training-route');
 const evidence=g=>cycleMeasured(g,now)?{tier:2,rate:g.routeEvidence.expPerHour,deaths:g.routeEvidence.deaths||g.routeEvidence.expLossEvents}:measured(g,now)?{tier:1,rate:g.farmEvidence.expPerHour,deaths:g.farmEvidence.deaths}:{tier:0,rate:g.score,deaths:0};
 rows=rows.filter(g=>!evidence(g).deaths&&(!evidence(g).tier||evidence(g).rate>0)&&!(g.farmEvidence?.cooldownUntil>now));
 rows.sort((a,b)=>evidence(b).tier-evidence(a).tier||evidence(b).rate-evidence(a).rate||(a.travelMs||0)-(b.travelMs||0));
 i.campaignTrainingStatus={at:now,selected:rows[0]?.monsterId||null,measured:!!rows[0]&&evidence(rows[0]).tier>0,method:'same_build_loadout_net_cycle_exp_then_field_exp_then_estimate'};
 return rows.slice(0,4).map((g,n)=>({...g,priority:1,score:1700+rows.length-n,label:g.label+' · งานคั่นคลาส/ปีก'}));
}
function income(i,wiki,plan,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),need=plan?.missing?.find(r=>['coins','Copper'].includes(r.name)&&Number.isFinite(r.want)&&Number.isFinite(r.have)&&r.want>r.have);
 if(!need||plan.phase!=='wing'||plan.ready!==false||!plan.wing?.recipeVerified||wiki?._source?.verifiedBuild!==cat.build||i.v2?.sourceCoherence?.matches!==true||!require('../runtime/freshness').decisionGate(i,now).allowed||!require('../runtime/freshness').fresh(i.vitals?.at,15000,now)||!Number.isFinite(i.vitals.hp)||i.vitals.hp<.85||require('../runtime/survival').hpPots(s)<20)return [];
 const blocked={...(i.brain?.blocked?.(now)||{})},rows=[];
 for(const d of require('../runtime/survival').recentDeaths(i,now))blocked[d.map]=true;
 for(const map of wiki.maps?.maps||[]){
  if(map.kind!=='field'||map.bossRoom!==false||blocked[map.id]||!Number.isFinite(map.levelMax)||map.levelMax>s.lv-20||(map.monsters?.boss||[]).length||(map.monsters?.miniboss||[]).length)continue;
  for(const id of map.monsters?.normal||[]){
   const m=cat.world.MONSTERS?.find(m=>m.id===id),w=wiki.monsters?.monsters?.find(m=>m.id===id);
   if(m?.kind!=='normal'||w?.kind!=='normal'||!Number.isFinite(m.level)||m.level!==w.level||m.level>s.lv-20||!(s.bestiary?.[id]>0))continue;
   const g={kind:'campaign-side',income:true,material:'Copper',mapId:map.id,mapName:map.name,monsterId:id,monster:m.name,monsterKind:'normal',priority:0,score:1800+m.level,alive:true,label:'หาเงินคราฟปีก: '+m.name,reason:'Copper ที่ใช้ได้ '+need.have+'/'+need.want+' · ของปีกและเงินยาถูกกันไว้ · มอนปกติที่ฆ่าได้จริง'};
   const learned=i.v2?.farmEvidence?.matching?.(s,i.v2.learningRevision||cat.build,g),measured=Number.isFinite(learned?.netCoins)&&learned.samples>=10&&learned.ms>=300000&&now>=learned.at&&now-learned.at<86400000;
   if(learned?.cooldownUntil>now||measured&&(learned.deaths>0||learned.netCoins<=0))continue;
   g.netCoinsPerHour=measured?learned.netCoins*3600000/learned.ms:null;
   g.method=measured?'same_build_loadout_observed_net_coins':'proven_normal_kills; income_rate_not_yet_measured';rows.push(g);
  }
 }
 rows.sort((a,b)=>Number(b.netCoinsPerHour!==null)-Number(a.netCoinsPerHour!==null)||(b.netCoinsPerHour||0)-(a.netCoinsPerHour||0)||b.score-a.score);
 return rows.slice(0,6).map((g,n)=>({...g,score:2500+rows.length-n}));
}
module.exports={ownsCard,collection,cards,training,income};
