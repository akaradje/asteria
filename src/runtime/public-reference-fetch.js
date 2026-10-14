'use strict';
const cp=require('child_process');
const paths=new Set(['/api/health','/asteria-online-visual-polish.html','/asteria-world-system.js','/asteria-net.js','/wiki/data.json']);
function allowed(url){let u;try{u=new URL(url);}catch{return false;}return u.origin==='https://asteria-online.io'&&!u.username&&!u.password&&!u.search&&!u.hash&&paths.has(u.pathname);}
function download(url,{runner=cp.execFile,platform=process.platform,timeoutMs=12000}={}){
 if(!allowed(url))return Promise.reject(Error('Unexpected public reference URL'));
 const seconds=Math.max(1,Math.min(12,Math.floor(timeoutMs/1000)));
 return new Promise((resolve,reject)=>runner(platform==='win32'?'curl.exe':'curl',['--fail','--silent','--show-error','--proto','=https','--max-time',String(seconds),'--write-out','\nASTERIA_PUBLIC_URL:%{url_effective}\nASTERIA_PUBLIC_STATUS:%{http_code}',url],{encoding:'utf8',windowsHide:true,timeout:seconds*1000+1000,maxBuffer:8001024},(error,out)=>{
  if(error)return reject(Error('Bounded public reference transport unavailable'));
  const match=String(out).match(/\nASTERIA_PUBLIC_URL:([^\n]+)\nASTERIA_PUBLIC_STATUS:(\d{3})$/);
  if(!match||match[1]!==url||match[2]!=='200')return reject(Error('Public reference origin/status mismatch'));
  const body=out.slice(0,match.index);if(body.length>8000000)return reject(Error('Public reference source too large'));
  resolve({ok:true,status:200,url,headers:{get:()=>null},referenceTransport:'bounded_public_curl',text:async()=>body});
 }));
}
async function fetchPublic(url,options={}, {fetcher=fetch,runner=cp.execFile,platform=process.platform}={}){
 if(!allowed(url))throw Error('Unexpected public reference URL');
 try{
  const r=await fetcher(url,options);
  // HTTP refusals remain refusals. Only a failed transport/body read retries.
  if(!r.ok&&r.status!==304)return r;
  if(r.url&&r.url!==url)throw Error('Public reference origin/status mismatch');
  const body=await r.text();if(body.length>8000000)throw Error('Public reference source too large');
  return {ok:r.ok,status:r.status,url:r.url||url,headers:r.headers,referenceTransport:'fetch',text:async()=>body};
 }catch(e){
  if(!['AbortError','TimeoutError'].includes(e.name)&&!(e instanceof TypeError&&/fetch failed|terminated|network/i.test(e.message)))throw e;
  return download(url,{runner,platform});
 }
}
module.exports={allowed,download,fetchPublic};
