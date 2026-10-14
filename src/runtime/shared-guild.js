'use strict';
const fs=require('fs'),path=require('path'),team=require('./guild-team');
function authority(root,now=Date.now(),config){
 let g;try{g=JSON.parse(fs.readFileSync(path.join(root,'logs/shared-guild-authority.json'),'utf8'));}catch{return null;}
 if(!config||g?.name!==config.name||g?.leader!==config.leader||!Number.isFinite(g.checkedAt)||now-g.checkedAt<0||now-g.checkedAt>=90000||!Array.isArray(g.leaderFrom)||!g.leaderFrom.length)return null;
 return g;
}
async function round(farm,live,config,{now=Date.now}={}){
 if(!live.length||!config)return;
 const native=await live[0].guildState();
 let g=team.project(native,config.leader);
 if(g&&(g.name!==config.name||now()-g.checkedAt<0||now()-g.checkedAt>=90000))g=null;
 g ||= authority(farm.root,now(),config);
 if(!g)return;
 // Shared membership authority never makes the new party leader a guild officer.
 const adapter={root:farm.root,config:{leader:config.leader},now,remote:()=>({guild:g})};
 await team.round(adapter,farm,live,null);
 const after=team.project(await live[0].guildState(),config.leader);
 if(after?.name===config.name&&now()-after.checkedAt>=0&&now()-after.checkedAt<90000){
  farm.guildInfo={checkedAt:after.checkedAt,id:after.id,name:after.name,lv:after.lv,cap:after.cap,members:after.members,roles:after.roster.map(m=>({name:m.name,rank:m.rank}))};
 }
}
module.exports={authority,round};
