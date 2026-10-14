'use strict';
const fs=require('fs'),path=require('path'),{execFile}=require('child_process'),{snapshot}=require('./source');
function provider(root){
 const fleet=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet.json'),'utf8')),exp=JSON.parse(fs.readFileSync(path.join(root,'machines/expansion.json'),'utf8'));
 const locations={windows:{root},tum:{root:'/opt/asteria-node-a/asteria',host:fleet.ssh.host},vps:{root:'/opt/asteria-node-b/asteria',host:exp.ssh.host,key:exp.ssh.identityFile},'tum-extra':{root:'/opt/asteria-node-a/asteria-youlater',host:fleet.ssh.host}};
 const known=[...fleet.members,...exp.members,{machine:'tum-extra',slot:0,charName:'YouLater',baseJob:'ranger'}];
 async function read(machine,request){
  const location=locations[machine];if(!location)throw Error('invalid_machine');
  if(machine==='tum-extra')request={...request,externalCharacter:'YouLater'};
  if(machine==='windows')return snapshot(root,request);
  // execFile uses pipes in memory; credentials never pass through a temporary file or log.
  const program=`console.log(JSON.stringify((${snapshot.toString()})(${JSON.stringify(location.root)},${JSON.stringify(request)})))`;
  const node=machine==='vps'?'/opt/asteria-node/node-v22.23.2-linux-x64/bin/node':'node';
  const command=`${node} -e 'eval(Buffer.from("${Buffer.from(program).toString('base64')}","base64").toString())'`;
  const args=['-n','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5',...(location.key?['-i',location.key]:[]),location.host,command];
  return new Promise((resolve,reject)=>execFile('ssh',args,{windowsHide:true,timeout:20000,maxBuffer:262144},(err,out)=>{if(err)return reject(Error('machine_unavailable'));try{resolve(JSON.parse(out));}catch{reject(Error('invalid_machine_response'));}}));
 }
 async function list(){
  const hosts=await Promise.all(Object.keys(locations).map(async machine=>{
   try{const result=await read(machine,{mode:'list'});return {machine,available:true,checkedAt:result.at,rows:result.rows.map(r=>({...r,id:machine+':'+r.slot,machine}))};}
   catch{return {machine,available:false,checkedAt:new Date().toISOString(),rows:known.filter(r=>r.machine===machine).map(r=>({id:machine+':'+r.slot,machine,slot:r.slot,charName:r.charName,job:r.baseJob,online:false,status:'connection_unavailable',kind:'unknown',hasPassword:false,loginMasked:'รอการเชื่อมต่อ'}))};}
  }));
  return {at:new Date().toISOString(),hosts:hosts.map(({rows,...h})=>h),rows:hosts.flatMap(h=>h.rows)};
 }
 return {list,reveal:async row=>read(row.machine,{mode:'reveal',slot:row.slot,charName:row.charName})};
}
module.exports={provider};
