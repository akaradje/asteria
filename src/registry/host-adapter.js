'use strict';
const transport=require('../runtime/fleet-transport');
function descriptor(root,host){const p=require('./topology').read(root),h=p.hosts[host];if(!h||h.enabled!==true||h.adapter!=='registered_private_bridge')throw Error('Enabled registered bridge required');return {host:h,active:p.members.filter(m=>m.machine===host&&m.enabled!==false)};}
async function request(root,host,route,{slot}={},capture=transport.sshCapture){
 const d=descriptor(root,host);if(!['status','start','stop','char','progress'].includes(route)||slot!==undefined&&!d.active.some(m=>m.slot===slot))throw Error('Bounded registered host operation required');
 if(route==='start'&&(!d.active.length||!Number.isInteger(d.host.maxActive)||d.active.length>d.host.maxActive))throw Error('Registered cohort exceeds admitted host limit');
 const message={route,...(slot!==undefined?{slot}:{}),...(route==='start'?{count:d.active.length}:{}),machine:host};
 return new Promise((resolve,reject)=>capture(['-n','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',d.host.sshHost,'python3',d.host.bridge,transport.encode(message)],{cwd:root,timeout:route==='start'||route==='stop'?90000:15000,maxBuffer:2000000},(error,out)=>{
  if(error)return reject(Error('Registered host transport unavailable; outcome remains unknown'));
  try{const value=transport.decode(out);if(value.machine!==host||value.controllerProof?.service!=='asteria-panel'||value.controllerProof.machine!==host)throw Error('Wrong registered controller acknowledgement');resolve(require('./host-feed').clean(value));}catch{reject(Error('Registered controller response not verified; no replay'));}
 }));
}
module.exports={descriptor,request};
