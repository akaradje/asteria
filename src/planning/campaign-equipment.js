'use strict';
const economy=require('../economy');
// A first usable wing unlocks parallel equipment work. A verified final-wing
// bill remains protected; the observed boss deadline still owns navigation.
function reserve(i){
 const c=i.endgameCampaign,cat=i.catalog(),s=i.lastSave||{};
 if(c?.phase!=='wing'||c.ready!==false||!c.wing?.recipeVerified)return null;
 const cash=c.wing.coinsNeeded,needs=c.wing.needs;
 if(!Number.isFinite(cash)||cash<0||!needs||Object.values(needs).some(n=>!Number.isFinite(n)||n<0))return null;
 return {...needs,Copper:cash};
}
function resources(i){
 const bill=reserve(i);if(!bill)return null;
 const held=require('../runtime/paid-actions').heldResources(i),out={...held};
 for(const [k,n]of Object.entries(bill))out[k]=(out[k]||0)+n;
 return out;
}
function profile(i){
 if(!require('./progression-priority').assess(i.lastSave||{},i.catalog()).equipmentAllowed)return null;
 const reserved=resources(i);if(!reserved)return null;
 return require('../character-brain').profile(i.lastSave,i.catalog(),economy.loadWiki(i.root),{reserved,equipmentOnly:true,...require('../runtime/craft-scope').profileOptions(i)});
}
function window(i,now=Date.now()){
 if(!reserve(i)||!require('./progression-priority').assess(i.lastSave||{},i.catalog()).equipmentAllowed||i.lastSave.lv!==i.catalog().world.MAX_LV||i.v2?.sourceCoherence?.matches!==true)return false;
 const w=i.bossWindow,board=i.socialInbox?.last('bossboard');
 // A missing final wing without an assigned boss must not own all equipment
 // work forever. One town upgrade may use only resources outside its reserve.
 // Existing boss windows (including stale ones) still require re-observation.
 if(!w&&!i.pendingTravel&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&i.livePos?.room==='town'&&!i.survivalRecovery)return true;
 if(w?.phase!=='side-work'||!Number.isFinite(w.assignedAt)||now-w.assignedAt<0||now-w.assignedAt>120000||!require('../runtime/freshness').fresh(board?._receivedAt,30000,now))return false;
 const observed=w.boss||w.bossObservation,spawnAt=w.spawnAt||w.bossObservation?.spawnAt;
 if(!observed||observed.alive||!Number.isFinite(spawnAt)||spawnAt<=now)return false;
 const row=board.list?.find(r=>r.id===observed.monsterId&&r.map===observed.mapId);
 if(!row||row.up||!Number.isFinite(row.next)||!Number.isFinite(board.now)||row.next<=board.now)return false;
 const nativeAt=row.next+board._receivedAt-board.now;
 const travel=require('./boss-window').travelBudget('town',observed.mapId,economy.loadWiki(i.root));
 const home=i.livePos?.room==='town'?0:155000;
 // One action plus native confirmation must fit before the conservative return.
 return Number.isFinite(travel.ms)&&now+home+90000<Math.min(spawnAt,nativeAt)-(w.leadMs||90000)-travel.ms;
}
module.exports={reserve,resources,profile,window};
