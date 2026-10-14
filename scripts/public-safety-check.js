'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const entries=cp.execFileSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).map(row=>{const tab=row.indexOf('\t'),[mode,hash,stage]=row.slice(0,tab).split(' ');return {mode,hash,stage,file:row.slice(tab+1)};});
const files=entries.map(e=>e.file);
if(!files.length)throw Error('No tracked files to inspect');
const failures=[];
const batch=cp.execFileSync('git',['cat-file','--batch'],{cwd:root,input:entries.map(e=>e.hash).join('\n')+'\n',maxBuffer:50000000});
let offset=0;
for(const entry of entries){
 const {file,mode,stage}=entry,lf=batch.indexOf(10,offset),header=batch.subarray(offset,lf).toString('utf8').split(' '),size=Number(header[2]);
 if(lf<0||header[0]!==entry.hash||header[1]!=='blob'||!Number.isSafeInteger(size)||size<0)throw Error('Invalid staged object');
 const text=batch.subarray(lf+1,lf+1+size).toString('utf8');offset=lf+1+size+1;
 if(stage!=='0'||!['100644','100755'].includes(mode)){failures.push({file,rule:'unsafe-mode-or-conflict'});continue;}
 const denied=/(^|\/)(node_modules|private|profiles|logs|cache|backups|__pycache__)(\/|$)|^data\/learning\/|(^|\/)team[^/]*\.json|\.(?:pem|key|pfx|p12|sqlite[^/]*|db|har|zip|tar|gz|bak|backup)$/.test(file)||file.startsWith('.env')&&file!=='.env.example'||file.startsWith('machines/')&&file.endsWith('.json')&&!file.endsWith('.example.json');
 if(denied){failures.push({file,rule:'private-file'});continue;}
 const p=path.join(root,file);if(fs.lstatSync(p).isSymbolicLink()){failures.push({file,rule:'symlink'});continue;}
 // Inspect the staged blob, not only the working copy.
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))failures.push({file,rule:'private-key'});
 if(/https?:\/\/[^/\s:@]+:[^/\s@]+@/.test(text))failures.push({file,rule:'credential-url'});
}
console.log(JSON.stringify({files:files.length,failures}));
if(failures.length)process.exitCode=1;
