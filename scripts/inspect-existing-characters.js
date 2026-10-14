'use strict';
// Read saved credentials in place; output only character metadata, never secrets.
const fs=require('fs'),api=require('../src/api');
(async()=>{
 const candidates=[];let pending=null;
 for(const line of fs.readFileSync('.env','utf8').split(/\r?\n/)){
  const match=line.match(/^\s*(ID|Pass)\s*=\s*(.*?)\s*$/i);if(!match)continue;
  const value=match[2].replace(/^(['"])(.*)\1$/,'$2');
  if(match[1].toLowerCase()==='id')pending=value;
  else if(pending){candidates.push({username:pending,password:value});pending=null;}
 }
 const team=JSON.parse(fs.readFileSync('team.json','utf8'));
 candidates.push(...team.members);
 for(const file of process.argv.slice(2)){
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  candidates.push(...(saved.members||[]));
 }
 const seen=new Set();const rows=[];
 for(const account of candidates){
  if(!account.username||!account.password||seen.has(account.username))continue;
  seen.add(account.username);
  const cached=account.token&&await api.whoami(account.token).catch(()=>null);
  const login=cached?{ok:true,token:account.token}:await api.loginRetry(account.username,account.password,{attempts:3});
  if(!login.ok){rows.push({accountIndex:rows.length,error:'Login failed'});continue;}
  const chars=await api.listChars(login.token);
  rows.push({accountIndex:rows.length,characters:chars});
 }
 // Whitelist fields recursively because API responses may contain credentials.
 function clean(v){if(Array.isArray(v))return v.map(clean);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>['characters','chars','id','name','job','baseJob','lv','level','jobLv','accountIndex','error','ok'].includes(k)).map(([k,x])=>[k,clean(x)]));return v;}
 console.log(JSON.stringify(clean(rows)));
})().catch(()=>{console.error('Character inspection failed');process.exitCode=1;});
