'use strict';
function freshRoom(actor,room,now=Date.now()){const p=actor.livePos;return !!(p&&p.room===room&&Number.isFinite(p.at)&&now-p.at>=0&&now-p.at<8000);}
// Native gateStep keeps gateGuard until the player is more than 2.8 units away.
function retreat(gate,room){
 const cx=room==='town'?160:0,dx=cx-gate.x,dz=-gate.z,length=Math.hypot(dx,dz);
 return length?{x:gate.x+dx/length*5,z:gate.z+dz/length*5}:null;
}
async function cross(actor,gate,{from,to,abort,timeoutMs=150000}={}){
 const arrived=()=>freshRoom(actor,to);
 if(to&&arrived())return {ok:true,reason:'already-arrived'};
 await actor.expeditionAuto(false);
 const p=actor.livePos,age=Date.now()-p?.at;
 if(p?.room===from&&age>=0&&age<6000&&Math.hypot(p.x-gate.x,p.z-gate.z)<=2.8){
  const back=retreat(gate,from);if(!back)return {ok:false,reason:'gate-rearm-unavailable'};
  const r=await actor.walkTo(back.x,back.z,{timeoutMs:30000,tolerance:1.5,abort:to?arrived:null});
  if(to&&arrived())return {ok:true,reason:'arrived-during-rearm'};
  const after=actor.livePos,elapsed=Date.now()-after?.at;
  if(!r.ok||after?.room!==from||elapsed<0||elapsed>=6000||Math.hypot(after.x-gate.x,after.z-gate.z)<=2.8)return {ok:false,reason:'gate-rearm-not-confirmed'};
 }
 // The native large map invokes collision-aware findPath/navigate. Direct WASD
 // steering can remain against a building even while the target gate is valid.
 const policy=require('./room-policy');
 if(from&&to&&actor.livePos?.room===from&&!policy.roomPolicy(from).dungeon&&!policy.isGuildHall(from)){
  const mapped=await require('./town-map-walk').walk(actor,gate.x,gate.z,{timeoutMs:Math.min(timeoutMs,60000),tolerance:1,room:from,abort});
  if(mapped){
   if(arrived())return {ok:true,reason:from==='town'?'native-town-gate-confirmed':'native-field-gate-confirmed'};
   if(mapped.reason==='aborted')await require('./town-map-walk').cancel(actor);
   // A sent map walk owns this attempt. Never overwrite an unconfirmed path
   // with another long keyboard walk, or equate leaving town with arrival.
   return {ok:false,reason:['dead','campaign-deadline'].includes(mapped.reason)?mapped.reason:from==='town'?'native-town-gate-unconfirmed':'native-field-gate-unconfirmed'};
  }
 }
 return actor.walkTo(gate.x,gate.z,{timeoutMs,tolerance:1.5,abort:abort||(to?arrived:null)});
}
module.exports={retreat,cross,freshRoom};
