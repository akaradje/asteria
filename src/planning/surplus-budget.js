'use strict';
const fresh=require('../runtime/freshness').fresh;
// Reserve one native maximum recipe bill per actor, plus current durable claims
// and complete workboard demand. Every known recipe remains covered separately.
function portfolio(i){
 const cat=i.catalog(),wiki=require('../economy').withNativeRecipes(require('../economy').loadWiki(i.root),cat),recipes=wiki?.crafting?.recipes;
 if(!Array.isArray(recipes)||!recipes.length)return null;
 const bill={Copper:require('../upgrade-reserve').reserve(i.lastSave,cat.world),'Rune Dust':1000,'Guild Token':100};
 const maximum={};for(const r of recipes){if(!r.cost||typeof r.cost!=='object')return null;for(let [k,n]of Object.entries(r.cost)){k=({coins:'Copper',runeDust:'Rune Dust',tokens:'Guild Token'})[k]||k;if(!Number.isSafeInteger(n)||n<0)return null;maximum[k]=Math.max(maximum[k]||0,n);}}
 for(const[k,n]of Object.entries(maximum))bill[k]=(bill[k]||0)+3*n;
 // Refine/class cores and all currently claimed resources remain unavailable.
 for(const k of require('../upgrade-reserve').cores)bill[k]=Math.max(bill[k]||0,3);
 const held=require('../runtime/paid-actions').heldResources(i);
 for(const[k,n]of Object.entries(held)){if(!Number.isSafeInteger(n)||n<0)return null;bill[k]=(bill[k]||0)+n;}
 for(const p of i.teamPeers?.()||[])for(const[k,n]of Object.entries(require('../runtime/paid-actions').heldResources(p))){if(!Number.isSafeInteger(n)||n<0)return null;if(p!==i)bill[k]=(bill[k]||0)+n;}
 return bill;
}
function team(i,now=Date.now()){
 const board=i.teamWorkboard,host=i.machine,peers=i.teamPeers?.();
 const policy=require('./host-team-scope').team(i.root,host);if(!policy||!Array.isArray(peers)||peers.length!==3)return null;
 if(new Set(peers.map(p=>p.actorIdentity?.actorId)).size!==3||peers.some(p=>p.machine!==host||!p.actorIdentity?.actorId||!policy.members.some(m=>m.charName===p.credentials?.charName)||p.catalog().build!==i.catalog().build||!fresh(p.lastSaveAt,30000,now)||p.status!=='playing'||p.v2?.sourceCoherence?.matches!==true))return null;
 if(!board||board.complete!==true||board.build!==i.catalog().build||!fresh(board.at,15000,now))return null;
 return {host,peers};
}
function available(i,cost,now=Date.now()){
 const bill=portfolio(i);if(!bill)return {allowed:false,reason:'complete_native_recipe_reserves_required'};
 const s=i.lastSave,have={...s.materials,...s.keyItems,...s.consumables,Copper:s.coins,'Rune Dust':s.runeDust||0,'Guild Token':s.tokens||0};
 const missing=Object.entries(cost).filter(([k,n])=>!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(have[k])||have[k]-(bill[k]||0)<n);
 return {allowed:!missing.length,bill,reason:missing.length?'preserve_supply_main_craft_refine_and_team_holds':null};
}
// Caller verified native surplus after ALL holds. ResourceReservations then
// subtracts its own holds once, leaving exactly the approved one-attempt bill.
function reservationWindow(i,cost){const held=i.v2.reservations.totals(i.catalog().build),window={};for(const[k,n]of Object.entries(cost)){const total=n+(held[k]||0);if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(total)||total<0)throw Error('bounded reservation amount required');window[k]=total;}return window;}
module.exports={portfolio,team,available,reservationWindow};
