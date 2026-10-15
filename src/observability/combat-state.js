'use strict';
// Connection-local observations only. An offered heal is never an applied heal.
class CombatState {
 constructor(){this.reset(0);}
 reset(generation){this.generation=generation;this.hp=null;this.events=[];this.sequence=0;this.gap=false;this.command=null;this.forge=null;this.conflict=false;this.deathAt=null;}
 sent(m,at){if(m?.t!=='ench')return;if(this.command)this.conflict=true;this.command={at,id:m.id,kind:m.kind,locks:m.locks?.slice(),rune:m.rune,star:m.star};}
 receive(m,at){
  if(m?.t==='pdie')this.deathAt=at;
  if(m?.t==='php'&&Number.isFinite(m.hp)&&m.hp>=0){this.hp={at,hp:m.hp,dead:m.dead===true,generation:this.generation};return;}
  if(m?.t==='forge'&&m.op==='ench'){this.forge={...structuredClone(m),at,generation:this.generation,sequence:++this.sequence,command:!this.conflict&&this.command?.at<=at?this.command:null};this.command=null;return;}
  if(!['psup','psupok','pheal','pdie','puse','phit'].includes(m?.t))return;
  const e={at,generation:this.generation,sequence:++this.sequence,t:m.t};
  for(const k of ['sk','from','name','k'])if(typeof m[k]==='string'&&m[k].length<=100)e[k]=m[k];
  for(const k of ['n','amt','lv','d','ps','rev'])if(Number.isFinite(m[k])&&m[k]>=0)e[k]=m[k];
  if(m.ok===true||m.ok===1)e.ok=true;
  this.events.push(e);if(this.events.length>256){this.events.shift();this.gap=true;}
 }
 view(){return {generation:this.generation,hp:this.hp,sequence:this.sequence,events:this.events.slice(-8),authority:'server_socket',gap:this.gap};}
}
module.exports={CombatState};
