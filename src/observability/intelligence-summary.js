'use strict';
const finite=x=>Number.isFinite(x)?x:null;
function project(g,actorId,build,now=Date.now()){
 const scope=g?.combat?.scope,c=g?.combat?.current,m=g?.competitiveMeta;
 const valid=scope?.actorId===actorId&&actorId&&scope.build===build&&Number.isFinite(g.at)&&now>=g.at&&now-g.at<30000;
 if(!valid)return null;
 return {role:scope.role,map:scope.map,target:scope.target,loadoutSignature:scope.loadoutSignature,measured:{ready:c?.ready===true,dps:finite(c?.dps),ttkMs:finite(c?.ttkMs),killsPerHour:finite(c?.killsPerHour),damageTakenPerSecond:finite(c?.damageTakenPerSecond),potionsPerMinute:finite(c?.potionsPerMinute),deaths:finite(c?.deaths),supportRecipientsPerMinute:finite(c?.supportRecipientsPerMinute),ehp:finite(c?.ehp),ehpReference:finite(c?.ehpReference),mitigationReference:finite(c?.mitigationReference),hpLossPerSecond:finite(c?.hpLossPerSecond),partySupport:c?.partySupport||null,buffUptime:finite(c?.buffUptime)},promotedBuilds:g.theorycraft?.policies?.filter(p=>p.automatic).length||0,meta:m?.build===build&&now>=m.at&&now-m.at<360000?{peers:m.peers,gaps:m.gaps?.map(r=>({slot:r.slot,refineGap:r.refineGap,samples:r.samples})).slice(0,8),scope:m.scope,optimalVerified:false}:null,boss:g.bossMastery?{retreat:g.bossMastery.retreat,requiredHp:g.bossMastery.requiredHp,requiredPotions:g.bossMastery.requiredPotions,soloVerified:false}:null,causalVerified:false,spendPermission:false};
}
module.exports={project};
