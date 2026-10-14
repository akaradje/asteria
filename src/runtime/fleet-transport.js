'use strict';
const zlib=require('zlib');
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
function sshCapture(args,options,callback){
 // Windows OpenSSH can stall writing larger replies into Node's overlapped pipe.
 // An owned temporary regular file avoids that pipe; no remote secrets are returned.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-ssh-')),file=path.join(dir,'response'),fd=fs.openSync(file,'w');let done=false,timer;
 // A just-killed SSH process can still hold its file on Windows. Cleanup must
 // never throw past the completion callback and leave every later poll waiting.
 const cleanup=(attempt=0)=>{try{fs.rmSync(dir,{recursive:true,force:true});}catch{if(attempt<3){const retry=setTimeout(()=>cleanup(attempt+1),250);retry.unref?.();}}};
 const finish=error=>{if(done)return;done=true;clearTimeout(timer);let out='';try{if(!error){if(fs.statSync(file).size>(options.maxBuffer||2000000))throw Error('Fleet response too large');out=fs.readFileSync(file,'utf8');}}catch(e){error=e;}finally{cleanup();}callback(error,out);};
 let child;try{child=spawn('ssh',args,{cwd:options.cwd,windowsHide:true,stdio:['ignore',fd,'ignore']});}catch(e){fs.closeSync(fd);finish(e);return;}
 fs.closeSync(fd);child.once('error',finish);child.once('close',code=>finish(code===0?null:Object.assign(Error('Fleet SSH request failed'),{code:'SSH_EXIT_'+code})));
 if(!done)timer=setTimeout(()=>{try{child.kill();}catch{}finish(Object.assign(Error('Fleet SSH request timed out'),{code:'SSH_TIMEOUT'}));},options.timeout||18000);
}
function encode(value){const payload=Buffer.from(JSON.stringify(value));if(payload.length>16000)throw Error('Fleet request too large');return payload.toString('base64');}
function encodeCompressed(value){const payload=Buffer.from(JSON.stringify(value));if(payload.length>48000)throw Error('Cooperation request too large');const envelope=JSON.stringify({encoding:'gzip-base64',data:zlib.gzipSync(payload).toString('base64')});if(Buffer.byteLength(envelope)>16000)throw Error('Compressed cooperation request too large');return Buffer.from(envelope).toString('base64');}
function decode(out){const value=JSON.parse(out);if(value?.encoding!=='gzip-base64')return value;if(typeof value.data!=='string'||value.data.length>2000000)throw Error('Invalid compressed fleet response');return JSON.parse(zlib.gunzipSync(Buffer.from(value.data,'base64'),{maxOutputLength:2000000}).toString('utf8'));}
module.exports={encode,encodeCompressed,decode,sshCapture};
