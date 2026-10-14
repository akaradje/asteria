'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function acquire(root,service){
 if(!['registry-host-agent','v32-recorder'].includes(service))throw Error('Registered independent service only');
 const file=path.join(root,'logs',service+'.owner.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fs.existsSync(file)){let old;try{old=JSON.parse(fs.readFileSync(file));}catch{throw Error('Preserve unreadable service ownership');}if(!Number.isSafeInteger(old.pid)||old.pid<1)throw Error('Preserve unknown service owner');try{process.kill(old.pid,0);throw Error('Independent service already has a live owner');}catch(e){if(e.code!=='ESRCH')throw e;}fs.renameSync(file,file+'.previous-'+Date.now());}
 const row={pid:process.pid,token:crypto.randomUUID(),at:Date.now(),service},fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,JSON.stringify(row));}finally{fs.closeSync(fd);}
 const release=()=>{try{if(JSON.parse(fs.readFileSync(file)).token===row.token)fs.unlinkSync(file);}catch{}};process.once('exit',release);return release;
}
module.exports={acquire};
