'use strict';
const fs=require('node:fs'),path=require('node:path');
function inspect(root,build){
 const text=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8'),native=require('../knowledge/native-contract');
 const contracts=Object.fromEntries(['craft','refine','rewards','enchant','astral'].map(k=>[k,native.validate(text,k)]));
 // A changed domain contract suspends that domain, not the running combat farm.
 return {build,mode:'semantic_auto_adapt',sourceDigest:contracts.craft.sourceDigest,contracts,autoApproved:['craft','refine','rewards','enchant'].every(k=>contracts[k].allowed),hashPinRequired:false};
}
module.exports={inspect};
