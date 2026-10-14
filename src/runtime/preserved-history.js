'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function read(file,select){try{const bytes=fs.readFileSync(file);try{const rows=select(JSON.parse(bytes));if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'))throw Error('History schema');return {rows,corrupt:false};}catch{const digest=crypto.createHash('sha256').update(bytes).digest('hex'),backup=path.join(path.dirname(file),'quarantine',digest+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.writeFileSync(backup,bytes,{flag:'wx',mode:0o600});return {rows:[],corrupt:true,originalSha256:digest};}}catch(e){if(e.code==='ENOENT')return {rows:[],corrupt:false};throw e;}}
module.exports={read};
