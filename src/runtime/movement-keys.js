'use strict';
// Native blur clears movement keys independently of Playwright's held-key state.
// Reassert only while the owned walker wants movement; always release on exit.
function movementKeys(keyboard,{now=Date.now,reassertMs=1000}={}){
 const held=new Map();
 return {
  async set(key,want){
   if(want){if(!held.has(key)||now()-held.get(key)>=reassertMs){await keyboard.down(key);held.set(key,now());}}
   else if(held.has(key)){await keyboard.up(key);held.delete(key);}
  },
  async release(){for(const key of [...held.keys()]){try{await keyboard.up(key);}catch{}finally{held.delete(key);}}},
 };
}
// Keyboard events are delivered inside the owned page, independent of which
// Chromium tab has focus. These are the native client's WASD input handlers;
// no player coordinates, movement flags or game state are written.
function pageMovementKeyboard(actor){
 const page=actor.page;
 const codes={w:'KeyW',s:'KeyS',a:'KeyA',d:'KeyD'};
 const send=(type,key)=>{
  if(!codes[key])throw Error('Unsupported walking key');
  if(actor.page!==page)return Promise.reject(Error('Walking page replaced'));
  const code=`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{code:${JSON.stringify(codes[key])},key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`;
  // Releasing held input is cleanup, not a new action. Retain the normal eval
  // watchdog, but a cancelled navigation owner must still be able to stop keys.
  const context=actor.v2?.scheduler?.context;
  return type==='keyup'&&context?context.exit(()=>actor.eval(code)):actor.eval(code);
 };
 return {down:key=>send('keydown',key),up:key=>send('keyup',key)};
}
module.exports={movementKeys,pageMovementKeyboard};
