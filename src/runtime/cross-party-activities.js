'use strict';
const fs=require('node:fs'),path=require('node:path');
function pulse(farm){if(farm.stopping||farm.machine!=='vps'||require('../planning/host-team-scope').team(farm.root,farm.machine))return;
 const feed=require('../planning/cross-party').receivedPrimary(farm.root);if(!feed)return;
 const build=path.basename(farm.cache.dir),workflow=feed.workflow;farm.crossPartyActivity ||=new(require('../planning/fleet-activity').FleetActivity)(farm.root,require('../planning/cross-party').roster(farm.root),'vps');
 for(const i of farm.instances.filter(Boolean)){
  require('./daily-quota-poll').refreshDailyQuotas(i,build);
  if(i.status!=='playing'||i.fleetActivityBusy)continue;
  const member=feed.build===build&&workflow?.build===build&&workflow?.participants?.some(m=>m.machine==='vps'&&m.slot===i.slot&&m.actorId===i.actorIdentity?.actorId);
  i.dailyActivities=feed.dailyActivities;i.dailyWorkStatus=require('../planning/daily-work-policy').dailyWorkPolicy(feed.dailyActivities,member?workflow:null,build,Date.now());i.dailyTeamPending=member&&i.dailyWorkStatus.reserve;
  if(!member){if(!i.fleetActivityIntent)i.teamControl=false;continue;}
  const gate=require('../knowledge/adapter-source').inspect(farm.root,build,workflow.kind==='rift'?'activity':'daily-activity');if(!gate.allowed)continue;
  i.fleetActivityBusy=true;Promise.resolve().then(()=>farm.crossPartyActivity.act(i,workflow,build)).catch(()=>{i.activityProtocolError='Activity dispatch not confirmed; existing run retained';}).finally(()=>{i.fleetActivityBusy=false;});
 }
}
module.exports={pulse};
