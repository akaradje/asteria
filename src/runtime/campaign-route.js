'use strict';
async function travel(i,g){
 if(i.pendingTravel||i.teamControl||i.dailyWorkStatus?.ownsNavigation||i.recycling||require('./room-policy').roomPolicy(i.livePos?.room).dungeon)return null;
 const owned={mapId:g.mapId,until:Date.now()+540000,reason:'campaign-direct-gates'};i.pendingTravel=owned;
 try{await i.expeditionAuto(false);const ok=await i.chainWalkTo(g.mapId,g.kind==='milestone-assist'?{assistanceKey:g.key}:{});return ok?'campaign route: arrival confirmed '+g.mapId:'campaign route: arrival unconfirmed; recheck actual room';}
 finally{if(i.pendingTravel===owned)i.pendingTravel=null;}
}
module.exports={travel};
