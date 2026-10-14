'use strict';
// Operates the existing external controllers; never launches game tabs in chat.
const {ensure}=require('./ensure-fleet-dashboard');
async function request(route,machine){
 const url='http://127.0.0.1:4712/api/'+route+(machine?'?machine='+machine:'');
 const mutation=route!=='fleet';
 const policy=mutation?await(await fetch('http://127.0.0.1:4712/api/control-policy')).json():null;
 const r=await fetch(url,{method:mutation?'POST':'GET',headers:mutation?{Origin:'http://127.0.0.1:4712','X-Control-CSRF':policy.csrf,'X-Control-Revision':policy.revision,'X-Control-Request':require('node:crypto').randomUUID()}:{},signal:AbortSignal.timeout(mutation?120000:45000)});
 const body=await r.json();if(!r.ok||body.ok===false||body.error)throw Error(machine+': '+(body.error||'controller request failed'));return body;
}
async function control(action,machine='both',{send=request}={}){
 if(!['start','stop','restart','status'].includes(action)||!['windows','tum','both'].includes(machine))throw Error('Use start|stop|restart|status windows|tum|both');
 if(action==='status')return send('fleet');
 const machines=machine==='both'?['windows','tum']:[machine],results=[];
 for(const target of machines){
  if(action==='stop'||action==='restart')await send('stop',target);
  if(action==='start'||action==='restart')await send('start',target);
  results.push({machine:target,action,requested:true});
 }
 return results;
}
async function main(){await ensure();console.log(JSON.stringify(await control(process.argv[2],process.argv[3])));}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={control};
