'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function setup(dir=path.join(root,'machines')){
 let count=0;
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isDirectory())count+=setup(p);
  else if(e.name.endsWith('.example.json')){
   const out=p.replace(/\.example\.json$/,'.json');
   try{fs.copyFileSync(p,out,fs.constants.COPYFILE_EXCL);count++;}catch(error){if(error.code!=='EEXIST')throw error;}
  }
 }
 return count;
}
if(require.main===module)console.log(JSON.stringify({created:setup(),servicesStarted:false}));
module.exports={setup};
