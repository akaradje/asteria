'use strict';
const {fresh}=require('./freshness');
// Only reviewed monster identities and public combat state; never player targets or chat.
class BossPositions{
 constructor(ids=[]){this.ids=new Set(ids);this.clear();}
 clear(){this.room=null;this.rows=new Map();}
 receive(m,at){
  if(m.t==='welcome'){this.clear();return;}
  if(m.t==='mons'&&typeof m.room==='string'&&Array.isArray(m.list)){this.clear();this.room=m.room;for(const s of m.list.slice(0,500))this.add(s,at);}
  if(m.t==='mspawn'&&m.r===this.room&&m.m)this.add({...m.m,al:true},at);
  if(m.t==='ms'&&Array.isArray(m.l))for(const s of m.l.slice(0,500)){const old=this.rows.get(s.n);if(old)this.add({...old,...s,id:old.id,al:old.alive},at);}
  if(['mdie','kill','mgone'].includes(m.t)){const old=this.rows.get(m.n);if(old)this.rows.set(m.n,{...old,alive:false,hp:0,at});}
 }
 add(s,at){if(!this.ids.has(s.id)||!(Number.isFinite(s.n)||typeof s.n==='string'&&s.n.length>0&&s.n.length<=100)||!Number.isFinite(s.x)||!Number.isFinite(s.z)||!Number.isFinite(s.hp))return;
  this.rows.set(s.n,{n:s.n,id:s.id,map:this.room,x:s.x,z:s.z,hp:s.hp,mx:Number.isFinite(s.mx)?s.mx:null,ak:Number.isFinite(s.ak)?s.ak:1,rage:!!(s.rg??s.rage),alive:!!s.al&&s.hp>0,at});
  if(this.rows.size>100)this.rows.delete(this.rows.keys().next().value);
 }
 view(id,map,now=Date.now()){return [...this.rows.values()].find(r=>r.id===id&&r.map===map&&r.alive&&fresh(r.at,10000,now))||null;}
 observation(id,map,now=Date.now()){return [...this.rows.values()].find(r=>r.id===id&&r.map===map&&(!r.alive||fresh(r.at,10000,now)))||null;}
}
async function poll(i,{waitMs=0,force=false}={}){
 if(i.bossBoardFlight)return i.bossBoardFlight;
 const now=Date.now();if(!force&&now-(i.bossBoardAskedAt||0)<20000)return i.socialInbox?.last('bossboard');
 i.bossBoardAskedAt=now;
 const work=(async()=>{const sent=await i.queryBosses();if(!sent)return null;const deadline=Date.now()+Math.min(2000,waitMs);
  do{const board=i.socialInbox?.last('bossboard');if(board?._receivedAt>=now)return board;if(Date.now()>=deadline)break;await new Promise(r=>setTimeout(r,100));}while(true);
  return null;
 })();i.bossBoardFlight=work;try{return await work;}finally{if(i.bossBoardFlight===work)i.bossBoardFlight=null;}
}
function view(i,now=Date.now()){
 const b=i.socialInbox?.last('bossboard',now),cat=i.catalog(),valid=fresh(b?._receivedAt,45000,now)&&Number.isFinite(b?.now),monsters=cat.world?.MONSTERS||[];
 const maps=cat.world?.MAPS||[];
 return {at:now,boardAt:b?._receivedAt||null,fresh:!!valid,evidence:'server_bossboard_and_zone_frames',rows:(b?.list||[]).filter(r=>! /^(pv|p\d|tw|dx|gd)/.test(r.map)).map(r=>{
  const native=monsters.find(m=>m.id===r.id),position=i.socialInbox?.bossPositions?.view(r.id,r.map,now);
  return {id:r.id,name:native?.name||r.id,map:r.map,mapName:(Array.isArray(maps)?maps:[]).find(m=>m.id===r.map)?.name||r.map,alive:valid?!!r.up&&!r.next:null,nextAt:valid&&Number.isFinite(r.next)&&r.next>b.now?r.next+b._receivedAt-b.now:null,serverNextAt:r.next,position:position?{x:position.x,z:position.z,hp:position.hp,maxHp:position.mx,at:position.at}:null};
 })};
}
async function awaitSpawn(i,g,{maxMs=20000}={}){
 const end=Date.now()+Math.min(20000,maxMs);
 while(Date.now()<end){
  i.v2?.scheduler?.checkpoint();
  if(i.livePos?.room!==g.mapId||i.livePos?.dead||i.teamControl||i.survivalRecovery||i.v2?.sourceCoherence?.matches!==true)return false;
  const b=i.socialInbox?.last('bossboard'),row=b?.list?.find(r=>r.id===g.monsterId&&r.map===g.mapId);
  if(fresh(b?._receivedAt,45000)&&row?.up&&!row.next)return true;
  if(row?.next&&Number.isFinite(g.nextAt)&&row.next+b._receivedAt-b.now>g.nextAt+5000)return false;
  // Zone spawn/death frames arrive without polling; the periodic board query
  // is only a fallback. No combat, movement or paid action is sent here.
  await poll(i);
  await new Promise(r=>setTimeout(r,250));
 }
 return false;
}
module.exports={BossPositions,poll,view,awaitSpawn};
