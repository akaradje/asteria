'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function projectRoot(root){let p=path.resolve(root);for(;;){if(fs.existsSync(path.join(p,'machines/runtime-v32.json')))return p;const parent=path.dirname(p);if(parent===p)return root;p=parent;}}
function existing(root,file){const base=projectRoot(root);if(require('../registry/registry').policy(base).durableDocuments!==true)return null;const store=require('./durable-store').shared(base),id=path.relative(base,file).replace(/\\/g,'/');return store.document(id);}
function open(root,file,initial){
 root=projectRoot(root);
 const enabled=require('../registry/registry').policy(root).durableDocuments===true;
 if(!enabled)return null;
 const store=require('./durable-store').shared(root),id=path.relative(root,file).replace(/\\/g,'/');
 const existing=store.document(id);if(existing)return {store,id,data:existing,revision:store.documentRevision(id)};
 if(fs.existsSync(file)){
  const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const backup=path.join(root,'logs/migration-originals',hash+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});
  if(!fs.existsSync(backup))fs.writeFileSync(backup,bytes,{flag:'wx',mode:0o600});
 }
 store.importDocument(id,initial);return {store,id,data:initial,revision:store.documentRevision(id)};
}
function save(document,data){if(document)document.revision=document.store.putDocument(document.id,data,document.revision);}
module.exports={open,save,existing,projectRoot};
