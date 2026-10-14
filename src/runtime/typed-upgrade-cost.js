'use strict';
const currencies={Copper:'coins','Guild Token':'tokens','Rune Dust':'runeDust','Boar Leaf':'leaves'};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
function gear(s,id){
 if(!Array.isArray(s?.bag)||!s.equip||typeof s.equip!=='object')return null;
 return s.bag.filter(x=>(typeof x==='string'?x:x?.id)===id).length+Object.values(s.equip).filter(x=>x===id).length;
}
function resolve(cost,state,catalog){
 if(!cost||!Object.keys(cost).length)return null;
 const out={};for(const [name,n]of Object.entries(cost)){
  if(!Number.isSafeInteger(n)||n<0)return null;
  if(currencies[name]){out[name]={group:'currency',key:currencies[name]};continue;}
  const candidates=[];
  if(own(state?.materials,name))candidates.push({group:'materials',key:name});
  if(own(state?.consumables,name))candidates.push({group:'consumables',key:name});
  if(own(state?.keyItems,name))candidates.push({group:'keyItems',key:name});
  for(const [id,item]of Object.entries(catalog?.items||{}))if(item.name===name)candidates.push({group:'gear',key:id});
  if(candidates.length!==1)return null;out[name]=candidates[0];
 }return out;
}
function amount(s,type){
 if(type?.group==='gear')return gear(s,type.key);
 const n=type?.group==='currency'?s?.[type.key]:['materials','keyItems','consumables'].includes(type?.group)?s?.[type.group]?.[type.key]??0:null;
 return Number.isSafeInteger(n)&&n>=0?n:null;
}
function matches(before,after,cost,types){
 if(!types||!cost||!Object.keys(cost).length)return false;
 return Object.entries(cost).every(([name,n])=>{const a=amount(before,types[name]),b=amount(after,types[name]);return Number.isSafeInteger(n)&&n>=0&&a!==null&&b!==null&&a-b===n;});
}
module.exports={resolve,matches,gear,amount};
