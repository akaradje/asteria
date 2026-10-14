'use strict';
function optionalWork(i,now=Date.now()){
 const pressure=i.resourceHealth?.mode==='reduced'&&now-i.resourceHealth.at<45000;
 const group=i.assistanceReservation,prep=i.milestonePreparationStatus;
 const classOwner=group?.expiresAt>now||prep?.expiresAt>now&&Number.isFinite(prep.lastIntentAt||prep.at)&&now-(prep.lastIntentAt||prep.at)>=0&&now-(prep.lastIntentAt||prep.at)<45000||i.classBossProbeActive?.status==='running'&&i.classBossProbeActive.deadline>now;
 const journal=i.v2?.journal;
 const pending=Array.isArray(journal?.rows)?journal.rows.some(r=>['STARTED','WAITING_CONFIRMATION','UNCERTAIN','OBSERVED'].includes(r.status)&&!require('./client-refresh').historicalClosedPurchase(r,{runtimeV2:{sessionStartedAt:i.bagSessionStartedAt}},now)):!!journal?.pending();
 return !pressure&&!classOwner&&!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.pendingTravel&&!i.choresBusy&&!i.recycling&&!i.v2?.trial?.active()&&!pending&&!i.survivalRecovery;
}
function installRuntimeV3(GameInstance){const p=GameInstance.prototype;if(Object.hasOwn(p,'_runtimeV3Installed'))return;Object.defineProperty(p,'_runtimeV3Installed',{value:true});
 p.observeV3=function(now=Date.now()){
  if(!this.v2)return;this.v3 ||= {version:3};if(now-(this.v3.at||0)<5000)return;
  this.v3.incidents ||=new(require('./v3-incidents').IncidentBook)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.charName||'slot-'+this.slot);
  this.v3.controller ||=new(require('./progression-controller').ProgressionController)(this.actorStateRoot||this.root,this.actorIdentity?.actorId||this.credentials?.charName||'slot-'+this.slot);
  this.v3.controller.observe(this,now);
  this.v3.health=this.v3.incidents.observe(this,now);this.v3.at=now;this.v3.optionalWork=optionalWork(this,now);
  if(!this.v3.plan||now-this.v3.plan.at>=30000){try{this.v3.plan=require('../planning/progression-dag').plan(this,now);}catch{this.v3.plan={version:3,at:now,fresh:false,nodes:[],selected:null,reason:'native catalog not available yet; observer continues'};}}
 };
 const observe=p.observeAdvanced;p.observeAdvanced=function(...args){const result=observe?.apply(this,args);this.observeV3(args[0]||Date.now());return result;};
 const continuity=p.observeContinuity;p.observeContinuity=async function(...args){const result=await continuity?.apply(this,args);this.observeV3();return result;};
 p.progressionTick=async function(screen){this.observeV3();return this.v3?.controller?.tick(this,screen)||null;};
 const snapshot=p.snapshot;p.snapshot=function(...args){const result=snapshot.apply(this,args);return {...result,runtimeV3:require('./v3-projection').project({at:this.v3?.at||null,optionalWork:this.v3?.optionalWork??null,incidents:this.v3?.health,progression:this.v3?.plan,experiments:this.v2?.trial?.view(),controller:this.v3?.controller?.view()})};};
}
module.exports={installRuntimeV3,optionalWork};
