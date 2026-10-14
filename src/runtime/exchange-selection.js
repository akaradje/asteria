'use strict';
// Runs in the native page. Decorative labels are not part of the item name;
// equal output names can have different bills, so match every cost as well.
function select(document,want,expected,singleQuantityRequired=false){
 const same=(a,b)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
 const matches=[];
 for(const button of document.querySelectorAll('#pBody [data-ex]')){
  const row=button.closest('.ex-row'),name=row?.querySelector('.iname')?.cloneNode(true);
  if(!name)continue;
  name.querySelectorAll('.ex-tag').forEach(n=>n.remove());
  if(name.textContent.trim().toLowerCase()!==want.toLowerCase())continue;
  const cost={};let valid=true;
  for(const chip of row.querySelectorAll('.ex-cost .chip')){
   const key=chip.getAttribute('title'),quantity=chip.querySelector('small')?.textContent.replace(/^\s*\//,'')??chip.querySelector('b')?.textContent;
   const n=Number(String(quantity??'').replace(/,/g,'').trim());
   if(!key||!Number.isSafeInteger(n)||n<=0||Object.hasOwn(cost,key)){valid=false;break;}cost[key]=n;
  }
  if(valid&&Object.keys(cost).length&&same(cost,expected))matches.push(button);
 }
 if(matches.length!==1)return {ok:false,reason:matches.length?'ambiguous-exact-recipe':'exact-recipe-name-and-cost-not-listed'};
 const hit=matches[0];if(hit.disabled)return {ok:false,reason:'native-recipe-disabled'};
 const quantity=hit.closest('.ex-row')?.querySelector('.ex-go .buyq input');
 if(quantity&&typeof quantity.value==='string'&&typeof quantity.dispatchEvent==='function'){
  if(quantity.closest('.buyq')?.dataset.exq!==hit.dataset.ex)return {ok:false,reason:'native-quantity-owner-mismatch'};
  quantity.value='1';quantity.dispatchEvent(new (document.defaultView?.Event||Event)('change',{bubbles:true}));
  if(Number(quantity.value)!==1)return {ok:false,reason:'native-single-quantity-not-confirmed'};
 }else if(singleQuantityRequired){
  // Gear rows may intentionally have no quantity picker: exMax must return1
  // and exQty's default is1. Require the native button's own bounded row.
  if(hit.closest('.ex-row')?.querySelector('.ex-go .buyq'))return {ok:false,reason:'native-quantity-control-unavailable'};
 }
 hit.click();return {ok:true,i:hit.dataset.ex};
}
module.exports={select};
