'use strict';
function view(i,snapshot,now=Date.now()){
 const build=snapshot.levelProgress?.build||i.catalog?.()?.build||null,name=i.character?.name||i.credentials?.charName,row=i.reports?.data?.slots?.[i.slot];
 const buckets=build&&typeof name==='string'&&row&&row.name===name?(row.buckets||[]).filter(b=>b.build===build&&b.at<=now&&now-b.at<3600000):[];
 const sum=k=>buckets.reduce((n,b)=>n+(Number.isFinite(b[k])?b[k]:0),0),observedMs=sum('observedMs'),netMaterials={};
 for(const b of buckets)for(const [key,n]of Object.entries(b.materialNet||{}))if(Number.isFinite(n))netMaterials[key]=(netMaterials[key]||0)+n;
 const q=snapshot.questOutcomes,questRows=q?.build===build?(q.rows||[]).filter(r=>r.at<=now&&now-r.at<3600000&&['main_quest','board_reward'].includes(r.kind)):[];
 const fresh=!!build&&Number.isFinite(i.lastSaveAt)&&now>=i.lastSaveAt&&now-i.lastSaveAt<30000;
 return {at:now,saveAt:i.lastSaveAt||null,build,fresh,grandmaster:require('../runtime/grandmaster').view(i,now),windowMinutes:60,observedMs,expPerHour:fresh?snapshot.levelProgress?.expPerHour??null:null,kills:sum('kills'),killsPerHour:fresh&&observedMs>=300000?Math.round(sum('kills')*3600000/observedMs):null,deaths:sum('deaths'),netMaterials:Object.entries(netMaterials).filter(([,n])=>n!==0).map(([key,n])=>({key,net:n})),questTransitionsObserved:questRows.length,lastQuestAt:questRows[0]?.at||null,stage:snapshot.developmentProgress?.stage||null,blockReason:snapshot.developmentProgress?.pending?.reason||snapshot.developmentProgress?.reason||null,evidence:'native_save_deltas_and_outgoing_quest_transitions_not_server_reward_receipts',serverVerified:false};
}
module.exports={view};
