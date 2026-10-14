'use strict';
class SessionWatchdog{
 constructor(){this.checks=0;this.lastCheck=0;this.saveAt=0;this.recoveries=[];}
 inspect({now,saveAt,health,protectedRoom=false,busy=false}){
  if(saveAt!==this.saveAt){this.checks=0;this.saveAt=saveAt;}
  if(!saveAt||now-saveAt<180000){this.checks=0;return {action:'continue'};}
  if(protectedRoom||busy||health?.paused)return {action:'wait',reason:'stale save; active room/action owns session'};
  if(!health)return {action:'wait',reason:'stale save; session health unavailable'};
  if(now-this.lastCheck>=20000){this.lastCheck=now;this.checks++;}
  if(this.checks<3)return {action:'wait',reason:'stale save; checking session continuity'};
  this.recoveries=this.recoveries.filter(at=>now-at<900000);
  if(this.recoveries.length>=3)return {action:'wait',reason:'save recovery budget exhausted; server/account needs inspection'};
  this.recoveries.push(now);this.checks=0;return {action:'recover',reason:'outgoing save stale for over 3 minutes across three checks'};
 }
}
module.exports={SessionWatchdog};
