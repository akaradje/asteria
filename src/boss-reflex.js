'use strict';
// Runs in the game page: the verified client's AoE delay is only 650 ms.
// Observes ordinary websocket frames and presses ordinary movement keys; never edits game stats.
function installBossReflex(config){
 if(window.__afBoss)return;const b=window.__afBoss={events:[],lessons:config.lessons||{},enabled:false,until:0};let pos=null,room=null,monsters=new Map(),held=[],resume=false;
 const event=e=>{b.events.unshift({...e,at:Date.now()});b.events=b.events.slice(0,40);};
 const release=()=>{for(const code of held)window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));held=[];if(resume&&document.getElementById('autoBtn')?.getAttribute('aria-pressed')==='false')document.getElementById('autoBtn').click();resume=false;b.until=0;};
 window.addEventListener('blur',release);
 const Original=window.WebSocket;
 window.WebSocket=new Proxy(Original,{construct(Target,args){const ws=new Target(...args);if(!String(args[0]).includes('/ws'))return ws;
  const send=ws.send;ws.send=function(raw){try{const m=JSON.parse(raw);if(m.t==='state'&&Number.isFinite(m.x)&&Number.isFinite(m.z)){if(room!==m.room){monsters.clear();release();}room=m.room;pos={...m,at:Date.now()};}}catch{}return send.apply(this,arguments);};
  ws.addEventListener('close',()=>{pos=null;monsters.clear();release();});
  ws.addEventListener('message',ev=>{try{const m=JSON.parse(ev.data),now=Date.now();
   if(m.t==='mons'&&(!room||m.room===room)){room=m.room;monsters=new Map(m.list.map(x=>[x.n,x]));return;}
   if(m.t==='mspawn'&&m.r===room){monsters.set(m.m.n,m.m);return;}
   if(m.t==='mgone'||m.t==='mdie'){monsters.delete(m.n);return;}
   if(m.t!=='mskill'||!b.enabled||!pos||pos.dead||now-pos.at>1000||now<b.until||!/^tw|^dx/.test(room||''))return;
   const mon=monsters.get(m.n),skill=config.skills?.[mon?.id]?.[m.i];if(!skill||!config.area.includes(skill.kind))return;
   const radius=skill.radius||(skill.kind==='lightning'?1.2:3);if(!Number.isFinite(m.x)||!Number.isFinite(m.z)||Math.hypot(m.x-pos.x,m.z-pos.z)>Math.max(radius,skill.range||0)+1)return;
   if(document.getElementById('panel')?.hidden===false||/INPUT|TEXTAREA/.test(document.activeElement?.tagName||''))return;
   const lessonKey=mon.id+':'+skill.kind,lesson=b.lessons[lessonKey]||{attempts:0,outside:0,short:0};
   const start={...pos},dx=pos.x-m.x,dz=pos.z-m.z;
   // A failed displacement may be a wall: alternate axis on the next observed cast.
   const horizontal=(Math.abs(dx)>Math.abs(dz))!==!!(lesson.short%2);
   const code=horizontal?(dx>=0?'ArrowRight':'ArrowLeft'):(dz>=0?'ArrowDown':'ArrowUp');
   const button=document.getElementById('autoBtn');resume=button?.getAttribute('aria-pressed')==='true';if(resume)button.click();
   b.until=now+850;held=[code];window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
   event({boss:mon.id,skill:skill.kind,radius,status:'evading'});
   setTimeout(()=>{const distance=pos&&pos.room===start.room&&Date.now()-pos.at<1000?Math.hypot(pos.x-start.x,pos.z-start.z):null;lesson.attempts++;if(distance!==null){if(distance>radius)lesson.outside++;else lesson.short++;}b.lessons[lessonKey]=lesson;event({boss:mon.id,skill:skill.kind,radius,distance,status:distance===null?'unknown':distance>radius?'outside_at_check':'insufficient_distance'});release();},620);
  }catch{}});return ws;}});
}
function mastery(world,combat){const moves=Object.entries(world?.BOSS_MOVES||world?.MONSTER_SKILLS||{}).map(([id,skills])=>({id,skills:skills.map(s=>({kind:s.kind,trigger:s.trigger,interval:s.interval??null,threshold:s.threshold??null,radius:s.radius??null,range:s.range??null,damageScale:s.damageScale??s.dmg??null})),observed:(combat?.windows||[]).filter(w=>w.target===id).map(w=>({map:w.map,party:w.party,deaths:w.deaths,potionsPerMinute:w.potionsPerMinute,damageTakenPerSecond:w.damageTakenPerSecond,ttkMs:w.ttkMs})).slice(-8)}));return {moves,evidence:'native_public_moves_and_scoped_combat_history',dodgeTimingVerified:false,autoMovementPermission:false};}
module.exports={installBossReflex,mastery};
