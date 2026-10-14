'use strict';
// Only a native current-budget rebase narrows an old unknown craft to its
// original item. It never confirms that payment or permits its replay.
function rebased(row,scope){
 const p=row?.currentBudgetRevalidation?.build===scope?.build?row.currentBudgetRevalidation:row?.reconciliation;
 return row?.kind==='craft'&&row.status==='reconciled_craft_unknown'&&typeof row.target?.id==='string'&&row.target.id.length>0&&/^actor-[a-f0-9]{32}$/.test(scope?.actorId||'')&&scope.build&&p?.build===scope.build&&require('./native-reservation-result').result(row,scope.actorId)==='RECONCILED'&&require('./native-reservation-result').result({...row,reconciliation:p},scope.actorId)==='RECONCILED';
}
function scope(i,targetId){const catalog=i.catalog();return {actorId:i.actorIdentity?.actorId,build:catalog.build,catalog,targetId};}
function independent(row,s){return typeof s?.targetId==='string'&&s.targetId!==row?.target?.id&&s.catalog?.build===s.build&&!!s.catalog.items?.[s.targetId]&&rebased(row,s);}
function blockedTargets(i){const s=scope(i);return new Set((i.developmentLedger?.rows||[]).filter(r=>rebased(r,s)).map(r=>r.target.id));}
function profileOptions(i){return {blockedCraftIds:blockedTargets(i)};}
function investmentOptions(i){return {...profileOptions(i),craftBlocked:id=>!!blocking(i,id),blockedKinds:Object.fromEntries(['refine','enchant'].map(k=>[k,!!i.developmentLedger?.blocking(k)]))};}
function blocking(i,targetId){
 const l=i.developmentLedger;if(!l)return;
 const active=i.activeDevelopmentAttempt,own=l.rows?.find(r=>active?.kind==='craft'&&r.id===active.id&&r.kind==='craft'&&r.status==='pending'&&r.target?.id===targetId&&r.context?.actorId===i.actorIdentity?.actorId&&r.context?.build===i.catalog().build&&r.context?.sessionStartedAt===i.bagSessionStartedAt&&r.context?.generation===i.socialInbox?.generation);
 // Only the current internal executor may exclude its own durable pending
 // attempt from its final preflight. Planning/new attempts exclude nothing.
 return l.blocking.call(own?{rows:l.rows.filter(r=>r!==own)}:l,'craft',scope(i,targetId));
}
function target(i,name){const matches=Object.entries(i.catalog().items||{}).filter(([,it])=>it.name===name);return matches.length===1?matches[0][0]:null;}
module.exports={rebased,scope,independent,blockedTargets,profileOptions,investmentOptions,blocking,target};
