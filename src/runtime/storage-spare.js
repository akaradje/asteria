'use strict';
const count=(rows,id)=>(rows||[]).filter(r=>(typeof r==='string'?r:r?.id)===id).length;
// Native investment metadata is keyed by item ID. A duplicate is spare only
// when the entire ID has no investment/lock and every planned copy is retained.
function inspect(i,id,plan){
 const deny=reason=>({allowed:false,reason});
 if(!id||require('./personal-storage').protectedGear(i,id))return deny('protected-native-item-ID');
 const bag=i.lastSave?.bag;if(!Array.isArray(bag))return deny('native-bag-required');
 const rows=['equip','keep','give'].flatMap(k=>plan?.[k]||[]).filter(r=>r.id===id);
 let retained=0;
 for(const r of rows){const n=r.qty??1;if(!Number.isSafeInteger(n)||n<1)return deny('planned-copy-count-unknown');retained+=n;}
 const copies=count(bag,id),upgrade=require('../gear-value').compare(i.lastSave,i.catalog(),id).upgrade;
 if(upgrade&&!rows.some(r=>(plan.equip||[]).includes(r)))return deny('unreserved-equipment-upgrade');
 if(copies<=retained)return deny('no-spare-native-copy');
 return {allowed:true,copies,retained,protectedUids:rows.map(r=>r.uid).filter(u=>Number.isSafeInteger(u)).map(String)};
}
function candidate(i,row,plan){
 const p=inspect(i,row?.id,plan);
 return p.allowed&&(!Number.isSafeInteger(row?.uid)||!p.protectedUids.includes(String(row.uid)))?p:{allowed:false,reason:p.reason||'planned-instance-protected'};
}
module.exports={inspect,candidate,count};
