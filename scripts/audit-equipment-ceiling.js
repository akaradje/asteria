'use strict';
const fs=require('fs'),path=require('path'),economy=require('../src/economy');
const root=path.resolve(__dirname,'..'),status=JSON.parse(fs.readFileSync(path.join(root,'logs/status.json'))),wiki=economy.loadWiki(root);
const result={at:new Date().toISOString(),machine:process.argv[2]||'windows',characters:(status.instances||[]).map(s=>{
 const build=s.equipmentCeiling?.build||s.endgameCampaign?.build||JSON.parse(fs.readFileSync(path.join(root,'logs/fleet/local.json'))).build||s.build||economy.newestBuild(root),cat=economy.loadCatalog(root,build);
 return {char:s.char,lv:s.lv,job:s.job,lastSaveAgo:s.lastSaveAgo,status:s.status,ceiling:require('../src/planning/equipment-ceiling').assess(s,cat,wiki),limitations:'Outgoing save evidence; no proof of optimal equipment or successful upgrade from a click'};
})};
fs.mkdirSync(path.join(root,'logs/system-audit'),{recursive:true});fs.writeFileSync(path.join(root,'logs/system-audit/equipment-ceiling-2026-10-02.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
