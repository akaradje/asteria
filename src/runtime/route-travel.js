'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fresh}=require('./freshness'),{roomPolicy,isGuildHall}=require('./room-policy');
const EVIDENCE='fresh_native_route_arrivals';
function context(i){
 try{const id=i.loadedSourceIdentity?.(),s=i.lastSave||{},loadout=crypto.createHash('sha256').update(JSON.stringify([s.job,s.equip,s.refine,s.petActive])).digest('hex').slice(0,16);return i.root&&i.v2?.sourceCoherence?.matches===true&&id?.build&&id.signature&&!id.missing?.length?{key:id.build+':'+id.signature+':'+loadout,build:id.build}:null;}catch{return null;}
}
function ordinary(room){return typeof room==='string'&&!!room&&!roomPolicy(room).dungeon&&!isGuildHall(room);}
function memory(i,c){
 const name=i.credentials?.charName||i.character?.name;if(typeof name!=='string'||!name)return null;
 if(!i.nativeRouteTravel){
  const file=path.join(i.actorStateRoot||i.root,'logs/native-route-travel',crypto.createHash('sha256').update(i.actorIdentity?.actorId||name).digest('hex').slice(0,24)+'.json');let data;
  try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  if(data?.version!==1||!data.rows||typeof data.rows!=='object'||Array.isArray(data.rows)||!Array.isArray(data.history))data={version:1,context:c.key,rows:{},history:[]};
  data.rows=Object.fromEntries(Object.entries(data.rows).filter(([,r])=>Array.isArray(r?.rows)).map(([k,r])=>[k,{at:r.at,rows:r.rows.filter(x=>x&&Number.isFinite(x.at)&&Number.isFinite(x.ms)&&x.ms>0&&x.ms<=900000).slice(-32)}]));
  i.nativeRouteTravel={file,data};
 }
 const memo=i.nativeRouteTravel,d=memo.data;
 if(d.context!==c.key){d.history.push({context:d.context,rows:d.rows});d.history=d.history.slice(-3);d.context=c.key;d.rows={};}
 return memo;
}
function begin(i,to,now=Date.now()){
 const p=i.livePos,c=context(i);
 if(!c||!ordinary(p?.room)||!ordinary(to)||p.room===to||!fresh(p.at,8000,now)||p.dead||i.recycling)return null;
 return {from:p.room,to,at:now,page:i.page,context:c.key,build:c.build};
}
function finish(i,attempt,success,now=Date.now()){
 if(!attempt)return;
 const c=context(i),p=i.livePos,ms=now-attempt.at;
 if(!c||c.key!==attempt.context||i.page!==attempt.page||!Number.isFinite(ms)||ms<=0||ms>900000)return;
 const arrived=success===true&&p?.room===attempt.to&&fresh(p.at,8000,now)&&p.at>=attempt.at&&!p.dead;
 const memo=memory(i,c);if(!memo)return;
 const key=attempt.from+'>'+attempt.to,d=memo.data,r=d.rows[key]||={rows:[]};
 r.rows.push({at:now,ms,ok:arrived});r.rows=r.rows.filter(x=>now-x.at>=0&&now-x.at<3600000).slice(-32);r.at=now;
 d.rows=Object.fromEntries(Object.entries(d.rows).filter(([,v])=>now-v.at>=0&&now-v.at<3600000).sort((a,b)=>b[1].at-a[1].at).slice(0,64));
 try{fs.mkdirSync(path.dirname(memo.file),{recursive:true});require('./telemetry-file').writeTelemetry(memo.file,d);}catch{}
}
function view(i,legacy={},now=Date.now()){
 const out={...(legacy||{})},c=context(i);if(!c)return out;
 const memo=memory(i,c);if(!memo)return out;
 for(const [key,r]of Object.entries(memo.data.rows)){
  const rows=r.rows?.filter(x=>x&&Number.isFinite(x.at)&&now-x.at>=0&&now-x.at<3600000&&Number.isFinite(x.ms)&&x.ms>0&&x.ms<=900000)||[],ok=rows.filter(x=>x.ok===true),failed=rows.filter(x=>x.ok!==true);
  if(!rows.length)continue;
  out[key]={evidence:EVIDENCE,build:c.build,at:rows.at(-1).at,samples:ok.length,attempts:rows.length,failures:failed.length,maxMs:ok.length?Math.max(...ok.map(x=>x.ms)):null,failedMaxMs:failed.length?Math.max(...failed.map(x=>x.ms)):0};
 }
 return out;
}
module.exports={begin,finish,view,EVIDENCE};
