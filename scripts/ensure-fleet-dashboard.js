'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..');
async function ensure(){
 const existing=await new Promise((resolve,reject)=>{const req=http.get('http://127.0.0.1:4712/api/health',res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{try{resolve(JSON.parse(body));}catch{reject(Error('Port 4712 belongs to another service'));}});});req.setTimeout(3000,()=>req.destroy(Error('Dashboard timed out')));req.on('error',e=>e.code==='ECONNREFUSED'?resolve(null):reject(e));});
 if(existing){if(existing.service!=='asteria-fleet-dashboard')throw Error('Port 4712 belongs to another service');return;}
 fs.mkdirSync(path.join(root,'logs'),{recursive:true});
 const out=fs.openSync(path.join(root,'logs/fleet-dashboard.out.log'),'a'),err=fs.openSync(path.join(root,'logs/fleet-dashboard.err.log'),'a');
 const child=spawn(process.execPath,['src/fleet-dashboard.js'],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',out,err]});child.unref();fs.closeSync(out);fs.closeSync(err);
}
if(require.main===module)ensure().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={ensure};
