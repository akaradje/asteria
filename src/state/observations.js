'use strict';
const crypto=require('crypto');
class Observations{
 constructor({machine,character,build,now=Date.now}={}){this.machine=machine;this.character=character;this.build=build;this.now=now;this.sessionId=crypto.randomUUID();this.sequence=0;this.fields={};}
 observe(field,value,observedAt,source){const now=this.now();if(!Number.isFinite(observedAt)||observedAt>now||observedAt<=0||observedAt<=(this.fields[field]?.observedAt||0))return false;const sequence=++this.sequence;this.fields[field]={eventId:this.sessionId+':'+sequence,field,value,observedAt,receivedAt:now,source,sequence,sessionId:this.sessionId,build:this.build};return true;}
 view(){const now=this.now(),age={save:30000,position:10000,vitals:15000,fps:15000};return {machine:this.machine,character:this.character,build:this.build,sessionId:this.sessionId,sequence:this.sequence,fields:Object.fromEntries(Object.entries(age).map(([k,maxAge])=>{const r=this.fields[k];return [k,{observedAt:r?.observedAt||null,source:r?.source||null,sequence:r?.sequence||null,ageMs:r?now-r.observedAt:null,fresh:!!r&&now-r.observedAt>=0&&now-r.observedAt<maxAge}];}))};}
}
module.exports={Observations};
