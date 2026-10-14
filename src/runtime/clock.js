'use strict';
const {performance}=require('node:perf_hooks');
class Clock{
 constructor({wall=Date.now,mono=()=>performance.now()}={}){this.wall=wall;this.mono=mono;this.last=null;this.offset=null;this.revision=0;}
 sample(){const at=this.wall(),monotonic=this.mono(),old=this.last;const jumped=!!old&&Math.abs((at-old.at)-(monotonic-old.monotonic))>2000;if(jumped){this.offset=null;this.revision++;}this.last={at,monotonic};return {...this.last,jumped,revision:this.revision};}
 deadline(ms){if(!Number.isFinite(ms)||ms<0)throw Error('Invalid monotonic duration');return {mono:this.mono()+ms,revision:this.revision};}
 expired(d){return this.mono()>=d.mono;}
 server(now,receivedAt){if(!Number.isFinite(now)||!Number.isFinite(receivedAt))return false;const s=this.sample();if(s.jumped||receivedAt>s.at||s.at-receivedAt>30000)return false;this.offset={ms:now-receivedAt,at:receivedAt,revision:this.revision};return true;}
 serverNow(){const s=this.sample(),o=this.offset;return !o||s.jumped||s.at-o.at>30000||s.at<o.at?null:s.at+o.ms;}
}
module.exports={Clock};
