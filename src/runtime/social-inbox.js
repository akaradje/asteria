'use strict';
// Capture server party messages before the page's UI hook is installed.
// The narrow whitelist avoids retaining chat, credentials or combat frame floods.
class SocialInbox{
 constructor(bossIds=[]){this.bossPositions=new(require('./boss-feed').BossPositions)(bossIds);this.astral=new(require('../observability/astral-state').AstralState)();this.power=new(require('../observability/power-state').PowerState)();this.market=new(require('../observability/market-state').MarketState)();this.buildLab=new(require('../observability/build-lab-state').BuildLabState)();this.forgeSupplies=new(require('../observability/forge-supplies').ForgeSupplies)();this.clear();}
 // Once bound, absence is evidence too: the new connection has not received a
 // party yet. Falling back to the page could return an old connection's frame.
 sustainTelemetry(){return {generation:this.generation,self:this.power.combat.view(),combatDomain:this.power.combatDomain,authority:'server_socket_observations_not_causal_support_credit'};}
 owns(type){return this.generation>0&&['party','pinvite','bossboard','as','asno','mk','mkr'].includes(type);}
 bind(socket){
  const generation=this.generation=(this.generation||0)+1;this.clear();
  socket.on('framereceived',ev=>{if(this.generation===generation)this.receive(ev.payload);});
  socket.on('framesent',ev=>{if(this.generation===generation)this.sent(ev.payload);});
  socket.on('close',()=>{if(this.generation===generation)this.clear();});
 }
 sent(payload,at=Date.now()){
  if(typeof payload!=='string'||payload.length>1000000)return;
  try{const m=JSON.parse(payload);this.market.sent(m,at);this.forgeSupplies.sent(m,at);this.power.combat.sent(m,at);}catch{}
 }
 clear(){this.latest=new Map();this.rows=[];this.streamAt=null;this.criticalGap=false;this.metrics={oversize:0,batchOverflow:0,invalid:0};this.bossPositions?.clear();this.astral?.reset(this.generation||0);this.power?.reset(this.generation||0);this.market?.reset(this.generation||0);this.buildLab?.reset(this.generation||0);this.forgeSupplies?.reset(this.generation||0);}
 receive(payload,at=Date.now()){
  try{if(typeof payload!=='string')return;if(payload.length>1000000){this.metrics.oversize++;this.criticalGap=true;return;}const packet=JSON.parse(payload);
   if(!packet||typeof packet.t!=='string')return;this.streamAt=at;
   // New clients opt into the server's documented {t:'b',l:[...]} batching.
     if(packet?.t==='b'&&Array.isArray(packet.l)&&packet.l.length>1000){this.metrics.batchOverflow++;this.criticalGap=true;return;}
     const messages=packet?.t==='b'&&Array.isArray(packet.l)?packet.l:[packet];
   for(const m of messages)if(m&&typeof m.t==='string'){this.bossPositions?.receive(m,at);this.power.receive(m,at);this.market.receive(m,at);this.buildLab.receive(m,at);this.forgeSupplies.receive(m,at);}
   for(const m of messages)if(this.astral.receive(m,at)){this.latest.set(m.t,{at,m:m.t==='asno'?{t:'asno',why:this.astral.rejection.reason}:{t:'as',...this.astral.state}});}
   // Keep only public spawn timing. Never retain chat, tokens or arbitrary frames.
   for(const m of messages)if(m?.t==='bossboard'&&Number.isFinite(m.now)&&Array.isArray(m.list)&&m.list.length<=100){const list=m.list.filter(b=>typeof b.id==='string'&&b.id.length<=100&&typeof b.map==='string'&&b.map.length<=100&&(typeof b.up==='boolean'||Number.isInteger(b.up)&&b.up>=0&&b.up<=1000)&&(b.next==null||Number.isFinite(b.next))).map(b=>({id:b.id,map:b.map,up:!!b.up,next:b.next??null}));this.latest.set('bossboard',{at,m:{t:'bossboard',now:m.now,list}});}
   for(const m of messages){if(m?.t==='rank'){const rank=require('../observability/server-rankings').normalize(m,at);if(!rank)continue;const safe={t:'rank',cat:rank.category,n:rank.population,next:rank.nextUpdateAt,me:rank.me,list:rank.leaders};this.latest.set('rank:'+m.cat,{at,m:safe});continue;}if(!['party','pinvite'].includes(m?.t))continue;const row={at,m};this.latest.set(m.t,row);this.rows.push(row);if(this.rows.length>100)this.rows.shift();}
  }catch{this.metrics.invalid++;this.criticalGap=true;}
 }
 last(type,now=Date.now()){
  if(type==='mk'){
   const b=this.market.board;if(!b||!b.rowsValid)return null;
   const rows=xs=>xs.map(r=>({...r,id:/^[1-9][0-9]*$/.test(r.id)&&Number.isSafeInteger(Number(r.id))?Number(r.id):r.id}));
   return {t:'mk',now:b.serverNow,list:rows(b.list),mine:rows(b.mine),tax:b.tax,fee:b.fee,max:b.max,total:b.total,_receivedAt:b.at,_generation:b.generation,_nativeMarket:true};
  }
  if(type==='mkr'){
   const e=this.market.events.findLast(e=>e.type==='mkr');if(!e)return null;
   return {t:'mkr',op:e.op,ok:e.ok,no:e.no,rev:e.rev,res:{item:e.item,n:e.n,price:e.price,coins:e.coins,left:e.left},d:e.delta,_deltaValid:e.deltaValid,_receivedAt:e.at,_generation:e.generation,_sequence:e.sequence,_nativeMarket:true,_command:e.command?{...e.command}:null};
  }
  const r=this.latest.get(type);if(!r)return null;
  const m={...r.m,_receivedAt:r.at,...(type==='party'?{_sessionBound:true,_streamAt:this.streamAt}:{})};
  if(type==='bossboard')m.list=m.list.map(b=>{const p=this.bossPositions.observation(b.id,b.map,now);return p&&p.at>=r.at?{...b,up:p.alive,next:p.alive?null:0,positionAt:p.at,liveEvidence:'server_zone_frame'}:b;});
  return m;
 }
 frames(type,since=0){return this.rows.filter(r=>r.m.t===type&&r.at>since).map(r=>r.m);}
}
module.exports={SocialInbox};
