'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),PREFIX='/asteria',materials=['Ancient Bark','Pharaoh Gold','Wyrm Scale','Tyrant Ember','Abyss Crystal','Celestial Plume','Warden Core','Behemoth Horn','Morvane Chain'];
const read=(root,p)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));}catch{return null;}};
const number=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e15?n:null;
const id=s=>typeof s==='string'&&/^[a-zA-Z0-9_:#-]{1,80}$/.test(s)?s:null;
const fresh=(at,now,ttl)=>number(at)!==null&&now-at>=0&&now-at<ttl;
function ratio(s){if(typeof s!=='string')return null;const m=s.replace(/,/g,'').match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);return m?{current:number(+m[1]),max:number(+m[2])}:null;}
function snapshot(root=ROOT,now=Date.now()){
 const roster=require('./planning/cross-party').roster(root).members,sources={tum:read(root,'logs/fleet/tum.json'),windows:read(root,'logs/fleet/windows.json'),vps:read(root,'logs/fleet/vps.json')},local=read(root,'logs/fleet/local.json');if(local?.machine&&['tum','windows','vps'].includes(local.machine))sources[local.machine]=local;
 const members=roster.map(r=>{const source=sources[r.machine],m=source?.machine===r.machine?source.members?.find(m=>m.charName===r.charName&&m.slot===r.slot):null,inv=m?.teamInventory,linkFresh=fresh(source?.at,now,15000),saveFresh=fresh(m?.lastSaveAt,now,30000),online=!!(m&&linkFresh&&saveFresh&&m.status==='playing'&&!m.recycling);
 // Construct a new object from typed fields. Never forward raw snapshots,
 // account data, arbitrary reasons, paths, commands or client responses.
 const verifiedId=id(m?.identity?.actorId),key=verifiedId||crypto.createHash('sha256').update(JSON.stringify([r.machine,r.slot,r.charName])).digest('hex').slice(0,24);return {actorId:key,identityState:verifiedId?'VERIFIED':'UNVERIFIED_COMPATIBILITY_KEY',name:r.charName,machine:r.machine,slot:r.slot,status:online?'online':m?'stale':'unknown',online,sourceAt:number(source?.at),saveAt:number(m?.lastSaveAt),lv:number(m?.lv),job:id(inv?.job||m?.job),jobLv:number(inv?.jobLv),map:id(m?.livePos?.room),hp:fresh(m?.vitals?.at,now,30000)?ratio(m?.vitals?.hp):null,fps:fresh(m?.performance?.at,now,30000)?number(m?.performance?.fps):null,wing:id(inv?.equip?.wing),materials:Object.fromEntries(materials.map(k=>[k,number(inv?.materials?.[k])])),trade:['GATHERING','READY','SESSION','VERIFYING','CONFIRMED','CANCELLED','UNCERTAIN'].includes(m?.teamTradeStatus?.phase)?m.teamTradeStatus.phase:null};});
 return {at:now,expected:roster.length,online:members.filter(m=>m.online).length,members,readOnly:true};
}
function start({root=ROOT,port=4713}={}){
 const deltas=new(require('./observability/dashboard-delta').DashboardDelta)();
 const server=http.createServer((req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'"};
  const send=(status,type,body)=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(req.method==='HEAD'?'':body);};
  if(!['GET','HEAD'].includes(req.method))return send(405,'text/plain; charset=utf-8','Read only');
  let url;try{url=new URL(req.url,'http://localhost');}catch{return send(400,'text/plain','Invalid request');}
  const p=url.pathname.startsWith(PREFIX+'/')?url.pathname.slice(PREFIX.length):url.pathname===PREFIX?'/':url.pathname;
  if(p==='/api/team/delta'&&/^\?since=\d{1,12}$/.test(url.search)){deltas.update(snapshot(root));return send(200,'application/json; charset=utf-8',JSON.stringify(deltas.since(+url.searchParams.get('since'))));}
  if(url.search)return send(404,'text/plain','Not found');
  if(p==='/api/team')return send(200,'application/json; charset=utf-8',JSON.stringify(snapshot(root)));
  if(p==='/api/health')return send(200,'application/json',JSON.stringify({service:'asteria-public-team-view',readOnly:true}));
  const files={'/':['mobile-team.html','text/html; charset=utf-8'],'/app.js':['mobile-team.js','text/javascript; charset=utf-8'],'/style.css':['mobile-team.css','text/css; charset=utf-8']},file=files[p];
  if(!file)return send(404,'text/plain','Not found');
  try{return send(200,file[1],fs.readFileSync(path.join(ROOT,'src/public',file[0])));}catch{return send(503,'text/plain','Temporarily unavailable');}
 });server.listen(port,'127.0.0.1');return server;
}
if(require.main===module)start();
module.exports={snapshot,start};
