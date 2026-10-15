'use strict';
const fresh=require('../runtime/freshness').fresh;
function observe(i,r,from,now){
 const power=i.socialInbox?.power?.combat,hp=power?.hp,ms=now-from;
 if(ms<=0||ms>15000||!fresh(hp?.at,15000,now))return;
 // A remote/inactive party membership is not a nearby recipient denominator.
 if(require('./party-combat-evidence').sample(i,now))return;
 r.soloObservedMs=(r.soloObservedMs||0)+ms;
 const events=power.events||[],pot=events.some(e=>e.t==='puse'&&e.ok&&e.at>from&&e.at<=now);
 if(!pot)r.soloPotionFreeMs=(r.soloPotionFreeMs||0)+ms;
 if(!hp.dead&&r.soloPreviousHp!=null&&hp.hp>=r.soloPreviousHp)r.soloHpStableMs=(r.soloHpStableMs||0)+ms;r.soloPreviousHp=hp.hp;
 for(const h of events.filter(e=>e.t==='pheal'&&e.n>0&&e.at>from&&e.at<=now)){
  const offers=events.filter(e=>e.t==='psup'&&e.amt>0&&e.at<=h.at&&h.at-e.at<=1000);
  if(!pot&&offers.length===1&&offers[0].from===i.credentials?.charName){r.soloSelfHeals=(r.soloSelfHeals||0)+1;r.soloSelfHealAmount=(r.soloSelfHealAmount||0)+h.n;}
 }
 r.soloSelfBuffEvents=(r.soloSelfBuffEvents||0)+events.filter(e=>e.t==='psup'&&e.from===i.credentials?.charName&&e.at>from&&e.at<=now).length;
}
function view(r){const ms=r.soloObservedMs||0;return {observedMs:ms,selfHealEvents:r.soloSelfHeals||0,selfHealingApplied:r.soloSelfHealAmount||0,selfHealsPerMinute:ms?(r.soloSelfHeals||0)*60000/ms:null,selfBuffEvents:r.soloSelfBuffEvents||0,selfBuffUptime:r.buffObservedMs?Object.fromEntries(Object.entries(r.buffMs||{}).map(([k,v])=>[k,v/r.buffObservedMs])):null,hpStableFraction:ms?(r.soloHpStableMs||0)/ms:null,potionFreeFraction:ms?(r.soloPotionFreeMs||0)/ms:null,authority:'native_self_receiver_and_HUD',causalVerified:false};}
module.exports={observe,view};
