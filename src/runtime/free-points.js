'use strict';
// These functions run in the game page and use only the game's own UI handlers.
function stats(plan){
 const body=document.getElementById('pBody');if(!body?.querySelector('.rs-p[data-st], .st-plus[data-st]'))return {skip:'status panel did not open'};
 let raised=0;for(let pass=0;pass<80;pass++){let n=0;for(const k of plan){const b=body.querySelector('.rs-p[data-st="'+k+'"], .st-plus[data-st="'+k+'"]');if(b&&!b.disabled){b.click();n++;}}raised+=n;if(!n)break;}
 const confirm=body.querySelector('#stOk');if(raised&&confirm){if(confirm.disabled){body.querySelector('#stCancel')?.click();return {skip:'stat draft not confirmable'};}confirm.click();}
 const left=body.querySelector('#stPts b')||body.querySelector('#stPts');return {raised,left:left?Number(left.textContent):null};
}
function skills(plan){
 const body=document.getElementById('pBody');if(!body?.querySelector('[data-skview], .st-plus[data-sk]'))return {skip:'skills panel did not open'};
 body.querySelector('[data-skview="tree"]')?.click();let learned=0;const got={};
 for(let pass=0;pass<40;pass++){
  let hit=false;
  for(const id of plan){
   let b=body.querySelector('.skn-plus[data-sk="'+id+'"], .skd-up[data-sk="'+id+'"], .st-plus[data-sk="'+id+'"]');
   if(!b||b.disabled){const tabs=Array.from(body.querySelectorAll('[data-sktab]')).map(t=>t.dataset.sktab);for(const tab of tabs){body.querySelector('[data-sktab="'+tab+'"]')?.click();b=body.querySelector('.skn-plus[data-sk="'+id+'"], .skd-up[data-sk="'+id+'"], .st-plus[data-sk="'+id+'"]');if(b&&!b.disabled)break;}}
   if(b&&!b.disabled){b.click();learned++;got[id]=(got[id]||0)+1;hit=true;break;}
  }
  if(!hit)break;
 }
 if(learned)window.AsteriaNet?.handlers?.resave?.();
 const left=body.querySelector('.skt-pts b, .hpts b');return {learned,left:left?Number(left.textContent):null,got};
}
module.exports={stats,skills};
