'use strict';
const assert=require('assert/strict'),{EventEmitter}=require('events');
const {SocialInbox}=require('../src/runtime/social-inbox'),{GameInstance}=require('../src/instance');
async function main(){
 const inbox=new SocialInbox(),socket=new EventEmitter();inbox.bind(socket);
 let reads=0;const actor={socialInbox:inbox,eval:async()=>{reads++;return {id:99,members:[]};}};
 const last=t=>GameInstance.prototype.socialLast.call(actor,t),frames=(t,since)=>GameInstance.prototype.socialFrames.call(actor,t,since);
 assert.equal(await last('party'),null);assert.deepEqual(await frames('pinvite',0),[]);assert.equal(reads,0,'empty current socket cannot fall back to stale renderer');
 socket.emit('framereceived',{payload:JSON.stringify({t:'party',id:1,members:[]})});assert.equal((await last('party')).id,1);
 socket.emit('framereceived',{payload:JSON.stringify({t:'pinvite',from:123})});assert.equal((await frames('pinvite',0)).length,1);
 assert.deepEqual(await frames('pinvite',Date.now()+1),[]);assert.equal(reads,0,'no fresh invite does not evaluate the page');
 socket.emit('close');assert.equal(await last('party'),null);assert.equal(reads,0,'disconnected socket cannot resurrect old membership');
 const next=new EventEmitter();inbox.bind(next);socket.emit('framereceived',{payload:JSON.stringify({t:'party',id:99})});assert.equal(await last('party'),null);
 await last('guild');assert.equal(reads,1,'other social types retain their existing read path');
 console.log('PASS party/invite reads stay on current socket, including empty/reconnected sessions; guild fallback preserved');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
