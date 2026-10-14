'use strict';
const fs=require('node:fs'),path=require('node:path');
function read(root){const file=path.join(root,'machines/topology-v32.json');let p;try{p=JSON.parse(fs.readFileSync(file));}catch(e){if(e.code!=='ENOENT')throw e;const base=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet.json')));let extra;try{extra=JSON.parse(fs.readFileSync(path.join(root,'machines/expansion.json')));}catch(e){if(e.code!=='ENOENT')throw e;}const members=[...base.members,...(extra?.enabled===true?extra.members.map((r,n)=>({...r,enabled:n<(extra.activeCount??extra.members.length)})):[])];return {version:1,revision:0,coordinatorHost:'tum',leader:base.leader,hosts:Object.fromEntries([...new Set(members.map(m=>m.machine))].map(id=>[id,{id,enabled:true,adapter:'legacy_verified_controller'}])),members};}
 if(p.version!==1||!Number.isSafeInteger(p.revision)||p.revision<1||!p.hosts||Array.isArray(p.hosts)||Object.keys(p.hosts).length>32||!Array.isArray(p.members)||p.members.length>120||!p.hosts[p.coordinatorHost])throw Error('Invalid bounded topology');
 for(const[id,h]of Object.entries(p.hosts))if(!/^[a-z][a-z0-9_-]{0,47}$/.test(id)||h.id!==id||typeof h.enabled!=='boolean'||!['legacy_verified_controller','registered_private_bridge'].includes(h.adapter)||Object.keys(h).some(k=>!['id','enabled','adapter','serviceId','bridge','sshHost','platform','intermittent','maxActive','admissionFloorMb'].includes(k))||h.adapter==='registered_private_bridge'&&(!/^[\w.@-]+$/.test(h.sshHost||'')||!/^\/[\w/.-]+\.py$/.test(h.bridge||'')))throw Error('Unverified host descriptor');
 const names=new Set(),slots=new Set();for(const m of p.members){const k=m.machine+':'+m.slot;if(!p.hosts[m.machine]||!Number.isInteger(m.slot)||m.slot<0||m.slot>119||typeof m.enabled!=='boolean'||typeof m.charName!=='string'||!m.charName||m.charName.length>64||names.has(m.charName)||slots.has(k)||Object.keys(m).some(k=>!['machine','slot','charName','baseJob','enabled','pauseReason'].includes(k)))throw Error('Invalid topology member');names.add(m.charName);slots.add(k);}return p;
}
function roster(root){const p=read(root);return {version:p.version,revision:p.revision,leader:p.leader,coordinatorHost:p.coordinatorHost,members:p.members.filter(m=>m.enabled!==false&&p.hosts[m.machine]?.enabled!==false)};}
function peer(root,host,now=Date.now()){
 if(!read(root).hosts[host])return null;
 const signed=path.join(root,'logs/fleet',host+'-v32.json'),file=fs.existsSync(signed)?signed:path.join(root,'logs/fleet',host+'.json');let r;
 try{r=JSON.parse(fs.readFileSync(file));}catch{return null;}
 // Never let a legacy writer supersede a calibrated native feed, or fall back
 // to a different clock/session while the native publisher is unavailable.
 return r?.machine===host&&Number.isFinite(r.at)&&now>=r.at&&now-r.at<15000&&Array.isArray(r.members)?r:null;
}
function feeds(root,now=Date.now(),exclude=[]){const p=roster(root),out=[];for(const host of new Set(p.members.map(m=>m.machine))){if(exclude.includes(host))continue;const r=peer(root,host,now);if(!r)continue;const expected=p.members.filter(m=>m.machine===host);if(r.members.length>expected.length||r.members.some(m=>!expected.some(e=>e.slot===m.slot&&e.charName===m.charName)))continue;out.push(r);}return out;}
module.exports={read,roster,feeds,peer};
