'use strict';
const fs=require('fs'),path=require('path');
const fresh=(at,ms,now)=>Number.isFinite(at)&&now-at>=0&&now-at<ms;
function roster(root){return require('../registry/topology').roster(root);}
function read(root,file){try{return JSON.parse(fs.readFileSync(path.join(root,file)));}catch{return null;}}
function source(root,now=Date.now()){
 const r=require('../registry/topology').peer(root,'vps',now),config=roster(root),expected=config.members.filter(m=>m.machine==='vps');
 return r?.machine==='vps'&&fresh(r.at,15000,now)&&Array.isArray(r.members)&&r.members.length<=expected.length&&r.members.every(m=>expected.some(e=>e.slot===m.slot&&e.charName===m.charName))?r:null;
}
function primary(root,now=Date.now()){
 const s=read(root,'logs/fleet/tum.json');if(s?.machine!=='tum'||!fresh(s.at,15000,now))return null;
 return {at:s.at,build:s.build,workboard:s.workboard||null,tradeWorkflow:s.tradeWorkflow||null,workflow:s.workflow||null,dailyActivities:s.dailyActivities||null};
}
function receivedPrimary(root,now=Date.now()){
 const s=read(root,'logs/fleet/primary.json');if(!s||!fresh(s.at,15000,now)||typeof s.build!=='string')return null;
 return {at:s.at,build:s.build,workboard:s.workboard||null,tradeWorkflow:s.tradeWorkflow||null,workflow:s.workflow||null,dailyActivities:s.dailyActivities||null};
}
function apply(i,intent,now=Date.now()){
 const build=i.catalog().build,old=i.teamTradeIntent;
 if(intent?.build===build&&fresh(intent.at,15000,now)){
  i.teamWorkboard=intent.workboard?.build===build&&fresh(intent.workboard.at,15000,now)?intent.workboard:null;
  const name=i.character?.name||i.credentials?.charName,parties=old?.offer?[old.offer.donor,old.offer.receiver]:[];
  // Every actor receives the coordinator feed. A known other pair cannot
  // own this actor's queue: it never opens a journal or receives its receipt.
  // Unknown identities retain the existing conservative ownership guard.
  const involved=!name||!parties.every(n=>typeof n==='string'&&n.length>0)||parties.includes(name);
  const trade=intent.tradeWorkflow,active=involved&&old?.offer&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(old.phase)&&!['CONFIRMED','CANCELLED','UNCERTAIN'].includes(i.tradeJournal?.phase);
  // Keep one owner until its timeout/receipt; never replace an active transfer.
  if(!active||trade?.id===old.id)i.teamTradeIntent=trade||null;
 }else{i.teamWorkboard=null;/* Owned old trade expires through its no-replay protocol. */}
}
function sources(root,now=Date.now(),exclude=[]){return require('../registry/topology').feeds(root,now,exclude);}
module.exports={roster,source,sources,primary,receivedPrimary,apply,fresh};
