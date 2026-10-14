'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),{EventEmitter}=require('events');
function fixture({locked=false,spawnThrows=false,killThrows=false,oversize=false}={}){
 let callbacks=0,result,removes=0,kills=0,closed=0;const timers=[],child=new EventEmitter();
 child.kill=()=>{kills++;if(killThrows)throw Error('kill race');};
 const fakeFs={mkdtempSync:()=>'/tmp/asteria-ssh-owned',openSync:()=>42,closeSync:()=>closed++,statSync:()=>({size:oversize?3000000:2}),readFileSync:()=> '{}',rmSync:()=>{removes++;if(locked&&removes<3)throw Object.assign(Error('file held by ssh'),{code:'EPERM'});}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../src/runtime/fleet-transport'),'utf8'),{module:mod,exports:mod.exports,require:n=>n==='fs'?fakeFs:n==='child_process'?{spawn:()=>{if(spawnThrows)throw Error('spawn refused');return child;}}:require(n),Buffer,setTimeout:(fn,ms)=>{const t={fn,ms,active:true,unref(){}};timers.push(t);return t;},clearTimeout:t=>{if(t)t.active=false;}});
 mod.exports.sshCapture([],{timeout:15,maxBuffer:2000000},(error,out)=>{callbacks++;result={error,out};});
 return {child,timers,counts:()=>({callbacks,removes,kills,closed}),result:()=>result,timeout:()=>{const t=timers.find(t=>t.ms===15&&t.active);t.fn();},cleanup:()=>{for(let n=0;n<4;n++){const t=timers.find(t=>t.ms===250&&t.active);if(t){t.active=false;t.fn();}}}};
}
let f=fixture({locked:true});f.child.emit('close',0);assert.equal(f.counts().callbacks,1,'locked cleanup cannot swallow successful status');assert.equal(f.result().out,'{}');f.cleanup();assert.equal(f.counts().removes,3);
f=fixture({locked:true,killThrows:true});f.timeout();assert.equal(f.counts().callbacks,1,'timeout and kill race always release awaiting fleet poll');assert.equal(f.result().error.code,'SSH_TIMEOUT');f.child.emit('close',255);f.cleanup();assert.equal(f.counts().callbacks,1,'late close cannot complete twice');
f=fixture({spawnThrows:true,locked:true});assert.equal(f.counts().callbacks,1);assert.equal(f.counts().closed,1);f.cleanup();
f=fixture({oversize:true});f.child.emit('close',0);assert.match(f.result().error.message,/too large/);assert.equal(f.counts().callbacks,1);
console.log('PASS owned SSH file cleanup/kill races settle once; bounded cleanup and output size retained');
