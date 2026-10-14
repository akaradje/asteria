'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..');
async function health(){return new Promise((resolve,reject)=>{const req=http.get('http://127.0.0.1:4714/api/health',res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{try{const value=JSON.parse(body);if(value.service!=='asteria-account-admin'||value.localOnly!==true)throw Error('Port 4714 belongs to another service');resolve(value);}catch{reject(Error('Port 4714 belongs to another service'));}});});req.setTimeout(2000,()=>req.destroy(Error('Account admin timed out')));req.on('error',e=>e.code==='ECONNREFUSED'?resolve(null):reject(Error('Account admin health unavailable')));});}
async function ensure(){
 const existing=await health();if(existing)return existing;
 fs.mkdirSync(path.join(root,'logs/account-admin'),{recursive:true});const out=fs.openSync(path.join(root,'logs/account-admin/service.out.log'),'a'),err=fs.openSync(path.join(root,'logs/account-admin/service.err.log'),'a');
 const child=spawn(process.execPath,[path.join(root,'scripts/account-admin/server.js')],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',out,err]});child.unref();fs.closeSync(out);fs.closeSync(err);
 for(let n=0;n<30;n++){await new Promise(r=>setTimeout(r,200));const ready=await health();if(ready)return ready;}throw Error('Account admin failed to start');
}
if(require.main===module)ensure().then(()=>console.log('Private account dashboard ready: http://127.0.0.1:4714/')).catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={ensure};
