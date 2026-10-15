'use strict';
function classify(room){return /^(tw#|gd#|dx|dg#)|#/.test(room||'')?'scaled_instance':'field';}
function reference(room,monster,native){
 // Instance spawn ak may itself be an authored base stat. No multiplier
 // contract is currently verified, so even that value cannot certify scaling.
 if(classify(room)!=='field')return null;
 const atk=Number.isFinite(native?.atk)&&native.atk>0?native.atk:monster?.atk;
 return Number.isFinite(atk)&&atk>0?atk:null;
}
function distribution(values=[]){const a=values.filter(n=>Number.isFinite(n)&&n>=0).sort((x,y)=>x-y),q=p=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:null;return {samples:a.length,p50:q(.5),p90:q(.9),p95:q(.95),max:a.at(-1)??null};}
module.exports={classify,reference,distribution};
