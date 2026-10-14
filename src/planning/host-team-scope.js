'use strict';
const fs=require('fs'),path=require('path');
function team(root,machine){
 if(typeof root!=='string')return null;
 let policy;try{policy=JSON.parse(fs.readFileSync(path.join(root,'machines/host-teams.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(policy.version!==1||!policy.teams||Array.isArray(policy.teams)||Object.keys(policy).some(k=>!['version','teams'].includes(k)))throw Error('Invalid host team policy');
 const topology=require('../registry/topology').read(root);
 for(const [host,p]of Object.entries(policy.teams)){
  const expected=topology.members.filter(m=>m.machine===host&&m.enabled!==false);
  if(!['tum','vps'].includes(host)||!topology.hosts[host]?.enabled||!p||Object.keys(p).some(k=>!['leader','members'].includes(k))||!Array.isArray(p.members)||p.members.length!==3||new Set(p.members).size!==3||!p.members.includes(p.leader)||expected.length!==3||expected.some(m=>!p.members.includes(m.charName))||expected.map(m=>m.slot).sort((a,b)=>a-b).some((n,i)=>n!==i))throw Error('Host team requires its exact three registered active actors');
 }
 const p=policy.teams[machine];if(!p)return null;
 return {version:1,scope:'host',coordinatorHost:machine,leader:p.leader,members:topology.members.filter(m=>m.machine===machine&&m.enabled!==false)};
}
module.exports={team};
