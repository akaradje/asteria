'use strict';
const crypto=require('node:crypto'),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x??null)).digest('hex');
class DashboardDelta{
 constructor({maxHistory=32}={}){this.sequence=0;this.maxHistory=maxHistory;this.history=[];this.current=null;}
 update(snapshot){const data={...snapshot};delete data.at;const revision=hash(data);if(this.current?.revision===revision)return this.current;
  this.current={version:1,sequence:++this.sequence,revision,snapshot};this.history.push(this.current);if(this.history.length>this.maxHistory)this.history.shift();return this.current;}
 since(sequence){const current=this.current,previous=this.history.find(x=>x.sequence===sequence);if(!current)return null;if(!previous)return {...current,kind:'snapshot'};
  const old=new Map(previous.snapshot.members.map(m=>[m.actorId,m])),members=current.snapshot.members.filter(m=>hash(m)!==hash(old.get(m.actorId))),ids=new Set(current.snapshot.members.map(m=>m.actorId));
  return {version:1,kind:'delta',sequence:current.sequence,previousSequence:previous.sequence,revision:current.revision,at:current.snapshot.at,expected:current.snapshot.expected,online:current.snapshot.online,members,removed:[...old.keys()].filter(k=>!ids.has(k)),readOnly:true};
 }
}
module.exports={DashboardDelta};
