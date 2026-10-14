'use strict';
const fs=require('fs'),path=require('path'),geometries=new Map();
function parse(source){
 if(!source.includes("$('minimap').addEventListener('pointerdown'")||!source.includes("$('townMapCanvas').addEventListener('pointerdown'")||!source.includes('const x=TOWN.cx+(u-.5)*TOWN.span,z=TOWN.cz+(v-.5)*TOWN.span'))return null;
 const block=source.match(/const TOWN\s*=\s*\{([^\n]+)/)?.[1],g={};if(!block)return null;
 for(const k of ['cx','cz','x0','x1','z0','z1','span']){const value=block.match(new RegExp('\\b'+k+'\\s*:\\s*(-?[\\d.]+)'))?.[1];if(value===undefined||!Number.isFinite(+value)||Math.abs(+value)>10000)return null;g[k]=+value;}
 return g.span>0&&g.x0<g.x1&&g.z0<g.z1?g:null;
}
function parseField(source){
 if(!source.includes("$('minimap').addEventListener('pointerdown'")||!source.includes("$('townMapCanvas').addEventListener('pointerdown'")||!source.includes('if(!inTown){if(bigMapTown)return;goTo(clamp(FIELD_MAP.x+(u-.5)*FIELD_MAP.span,FIELD.x0,FIELD.x1),clamp(FIELD_MAP.z+(v-.5)*FIELD_MAP.span,FIELD.z0,FIELD.z1),true);closeTownMap();return;}')||!source.includes('get span(){return Math.max(FIELD.x1-FIELD.x0,FIELD.z1-FIELD.z0)+6;}'))return null;
 const block=source.match(/const FIELD\s*=\s*\{([^\n]+)/)?.[1],g={};if(!block)return null;
 for(const k of ['x0','x1','z0','z1']){const value=block.match(new RegExp('\\b'+k+'\\s*:\\s*(-?[\\d.]+)'))?.[1];if(value===undefined||!Number.isFinite(+value)||Math.abs(+value)>10000)return null;g[k]=+value;}
 if(g.x0>=g.x1||g.z0>=g.z1)return null;
 return {...g,cx:(g.x0+g.x1)/2,cz:(g.z0+g.z1)/2,span:Math.max(g.x1-g.x0,g.z1-g.z0)+6};
}
function geometry(i,field=false){
 try{if(!i.cache?.dir||!i.loadedSourceIdentity)return null;const b=path.basename(i.cache.dir),id=i.loadedSourceIdentity();if(id?.build!==b||!require('../knowledge/loaded-source').inspect(i.root,b,id?.sourceHashes).matches)return null;
  // Inspect current bytes before every use. Only the parsed public geometry is
  // reusable; never cache permission to act or a stale loaded-client identity.
  const key=path.resolve(i.cache.dir)+':'+id.sourceHashes.client;let g=geometries.get(key);
  if(!g){const source=fs.readFileSync(path.join(i.cache.dir,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');g={town:parse(source),field:parseField(source)};geometries.set(key,g);while(geometries.size>16)geometries.delete(geometries.keys().next().value);}
  return field?g.field:g.town;
 }catch{return null;}
}
function point(g,x,z){if(!g||![x,z].every(Number.isFinite)||x<g.x0||x>g.x1||z<g.z0||z>g.z1)return null;const u=.5+(x-g.cx)/g.span,v=.5+(z-g.cz)/g.span;return u>=0&&u<=1&&v>=0&&v<=1?{u,v}:null;}
async function walk(i,x,z,{timeoutMs=30000,tolerance=1.4,room='town',abort=null}={}){
 const policy=require('./room-policy'),field=room!=='town';
 if(!room||policy.roomPolicy(room).dungeon||policy.isGuildHall(room))return null;
 const at=Date.now(),g=geometry(i,field),p=point(g,x,z);
 if(!p||i.livePos?.room!==room||at-i.livePos.at<0||at-i.livePos.at>10000)return null;
 await i.expeditionAuto(false);
 const dispatch=()=>i.eval(`(() => {
  const panel=document.getElementById('panel');if(panel&&!panel.hidden&&document.getElementById('pBody')?.dataset?.panel==='news'){const close=document.getElementById('pClose');if(close&&!close.disabled)close.click();}
  if(panel&&!panel.hidden)return false;
  const m=document.getElementById('minimap'),c=document.getElementById('townMapCanvas'),s=document.getElementById('townMapScreen');
  if(!m||!c||!s)return false;
  const r=m.getBoundingClientRect();if(!r.width||!r.height)return false;
  m.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true,pointerType:'mouse'}));
  if(s.hidden)return false;
  if(s.classList.contains('field')!==${field}){document.getElementById('townMapClose')?.click();return false;}
  const b=c.getBoundingClientRect();if(!b.width||!b.height){document.getElementById('townMapClose')?.click();return false;}
  c.dispatchEvent(new PointerEvent('pointerdown',{clientX:b.left+b.width*${p.u},clientY:b.top+b.height*${p.v},bubbles:true,cancelable:true,pointerType:'mouse'}));
  return s.hidden===true;
 })()`);
 const sent=await dispatch();
 if(!sent)return null;
 const until=Date.now()+timeoutMs;let newsAt=0,stillAt=Date.now(),lastPos=null,replans=0;
 while(Date.now()<until){
  i.v2?.scheduler?.yieldOptionalNavigation?.();
  i.v2?.scheduler?.checkpoint();
  if(await require('./capped-campaign').routeExpired(i))return {ok:false,reason:'campaign-deadline'};
  const pos=i.livePos,age=Date.now()-pos?.at;
  if(pos?.dead)return {ok:false,reason:'dead'};
  if(pos?.room!==room)return {ok:false,reason:field?'left-field':'left-town'};
  if(abort&&await abort())return {ok:false,reason:'aborted'};
  if(age>=0&&age<6000&&Math.hypot(pos.x-x,pos.z-z)<=tolerance)return {ok:true,reason:field?'native-field-map-arrived':'native-town-map-arrived'};
  if(age>=0&&age<6000){if(!lastPos||Math.hypot(pos.x-lastPos.x,pos.z-lastPos.z)>.5){stillAt=Date.now();lastPos={x:pos.x,z:pos.z};}
   // No DOM polling while the native socket proves movement. A stationary
   // actor may have an informational news panel; retry only that close button.
   if(!pos.mv&&Date.now()-stillAt>=5000&&Date.now()>=newsAt){newsAt=Date.now()+10000;await require('./startup-news').dismissStartupNews(i);}
   // A newly observed stationary native path permits one native replan,
   // not another keyboard walker or an endless replay of the same input.
   if(pos.at>at&&Date.now()-stillAt>=8000&&[pos.x,pos.z].every(Number.isFinite)){
    if(replans||!geometry(i,field))return {ok:false,reason:field?'native-field-map-stalled':'native-town-map-stalled'};
    if(!await dispatch())return {ok:false,reason:'native-map-replan-not-dispatched'};
    replans++;stillAt=Date.now();lastPos={x:pos.x,z:pos.z};
   }
  }
  await new Promise(r=>setTimeout(r,500));
 }
 return {ok:false,reason:field?'native-field-map-arrival-unconfirmed':'native-town-map-arrival-unconfirmed'};
}
function inconsistentTown(i,now=Date.now()){
 const p=i.livePos;
 if(p?.room!=='town'||p.dead===true||!Number.isFinite(p.at)||now-p.at<0||now-p.at>=6000||![p.x,p.z].every(Number.isFinite))return false;
 const town=geometry(i),field=geometry(i,true);
 // A valid pier/island position is not a corrupt town position. This guard
 // recognizes only the disjoint normal-field rectangle in the loaded client.
 return !!(p?.room==='town'&&p.dead!==true&&Number.isFinite(p.at)&&now-p.at>=0&&now-p.at<6000&&town&&field&&[p.x,p.z].every(Number.isFinite)&&point(field,p.x,p.z)&&!point(town,p.x,p.z));
}
async function cancel(i){
 const p=i.livePos,at=Date.now();
 if(!p||p.dead||!Number.isFinite(p.at)||at-p.at<0||at-p.at>=6000||![p.x,p.z].every(Number.isFinite))return null;
 // A native click at the actual current position replaces the prior path.
 // Returning from a controller wait alone does not stop the game's walker.
 return walk(i,p.x,p.z,{timeoutMs:2000,tolerance:1.5,room:p.room});
}
function validTown(i,now=Date.now()){
 const p=i.livePos;
 return !!(p?.room==='town'&&!p.dead&&Number.isFinite(p.at)&&now-p.at>=0&&now-p.at<6000&&point(geometry(i),p.x,p.z));
}
module.exports={parse,parseField,point,walk,cancel,inconsistentTown,validTown};
