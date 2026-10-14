'use strict';
class RecoveryQueue{
 constructor({now=Date.now,gapMs=40000,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){this.now=now;this.gapMs=gapMs;this.wait=wait;this.tail=Promise.resolve();this.lastStart=0;this.history=new Map();}
 run(identity,action){const result=this.tail.then(async()=>{let history=(this.history.get(identity)||[]).filter(at=>this.now()-at<900000);if(history.length>=3)throw Error('recovery budget exhausted: inspect this slot before another reload');const delay=this.lastStart?Math.max(0,this.gapMs-(this.now()-this.lastStart)):0;if(delay)await this.wait(delay);history.push(this.now());this.history.set(identity,history);this.lastStart=this.now();return action();});this.tail=result.catch(()=>{});return result;}
}
const shared=new RecoveryQueue();module.exports={RecoveryQueue,shared};
