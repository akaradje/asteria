'use strict';
function roomPolicy(room){const lab=/^bt(?:#[0-9]+)?$/.test(room||''),dungeon=lab||/^(?:tw|dx|gd|pv)(?:[#\d_-]|$)/.test(room||'');return {room,dungeon,...(lab?{lab:true}:{}),kind:lab?'build_lab':/^pv(?:[#\d_-]|$)/.test(room||'')?'arena':dungeon?'dungeon':'field',allowTown:!dungeon,allowInvestment:!dungeon,allowTravel:!dungeon,allowQuest:!dungeon};}
function currentRoom(i,now=Date.now()){return i.livePos&&now-i.livePos.at<10000?i.livePos.room:i.lastSave?.mapId;}
function isGuildHall(room){return /^gh(?:#[0-9]+)?$/.test(room||'');}
function sameGatherRoom(room,kind){return kind==='guild'?isGuildHall(room):room==='town';}
module.exports={roomPolicy,currentRoom,isGuildHall,sameGatherRoom};
