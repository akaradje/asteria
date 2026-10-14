'use strict';
// Reuse a running panel. Never kill a port owner or leave its farm orphaned.
const http=require('http');
async function request(method,path,body){
 let token=null;if(method==='POST'&&['/api/start','/api/stop'].includes(path)){const h=await request('GET','/api/panel-health');if(h.data.service!=='asteria-panel'||h.data.machine!=='windows')throw Error('Unexpected controller');if(Number(h.data.version)>=15){const t=await request('GET','/api/control-token');if(t.code!==200||typeof t.data.token!=='string')throw Error('Panel authentication required');token=t.data.token;}else if(h.data.loadedControllerRevision!=='6764094f9dce7fe4156c110d77674c0b1e83f7cbf494f789ccfd723fb4127d35')throw Error('Unknown legacy controller');}
 return new Promise((resolve,reject)=>{
 const data=body?JSON.stringify(body):null;
 const req=http.request({host:'127.0.0.1',port:4711,path,method,timeout:30000,headers:data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...(token?{'X-Asteria-Control':token}:{})}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({code:res.statusCode,data:JSON.parse(text)});}catch{reject(Error('Port 4711 is occupied by an unrecognized service'));}});});
 req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Existing panel timed out; inspect it before restarting')));req.end(data);
});}
async function main(){
 if(process.platform!=='win32')throw Error('Windows launcher requires win32');
 await require('./ensure-fleet-dashboard').ensure();
 let result;
 try{result=await request('GET','/api/panel-health');}catch(e){if(e.code!=='ECONNREFUSED')throw e;}
 if(result){
  if(result.code===401){console.log('Panel requires login: http://127.0.0.1:4711/');return;}
  if(result.code!==200||result.data.service!=='asteria-panel'||typeof result.data.running!=='boolean')throw Error('Unexpected service on port 4711');
  if(process.argv.includes('--autostart')&&!result.data.running){const config=require('../machines/windows/config.json').args;let r=await request('POST','/api/start',{n:config.n,god:!!config.god,nodraw:true});const oldAssignment=/^This machine is assigned ([1-6]) characters/.exec(r.data.error||'');if(!r.data.ok&&oldAssignment)r=await request('POST','/api/start',{n:Number(oldAssignment[1]),god:!!config.god,nodraw:true});if(!r.data.ok)throw Error(r.data.error||'Farm start failed');}
  console.log('Team dashboard: http://127.0.0.1:4712/ (existing game panel reused)');return;
 }
 process.argv=['node','src/panel.js','--machine=windows',...process.argv.slice(2)];require('../src/panel');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
