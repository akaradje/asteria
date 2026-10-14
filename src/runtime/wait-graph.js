'use strict';
// Only explicit dependencies create edges. Elapsed time never invents a blocker.
function analyze(rows){
 const nodes=new Map();for(const r of (rows||[]).slice(0,128)){if(typeof r.id!=='string'||r.id.length>120)continue;nodes.set(r.id,{...r,waitsFor:(r.waitsFor||[]).filter(x=>typeof x==='string').slice(0,16)});}
 const index=new Map(),low=new Map(),stack=[],on=new Set(),cycles=[];let cursor=0;
 function visit(id){index.set(id,cursor);low.set(id,cursor++);stack.push(id);on.add(id);
  for(const next of nodes.get(id).waitsFor){if(!nodes.has(next))continue;if(!index.has(next)){visit(next);low.set(id,Math.min(low.get(id),low.get(next)));}else if(on.has(next))low.set(id,Math.min(low.get(id),index.get(next)));}
  if(low.get(id)!==index.get(id))return;const group=[];let next;do{next=stack.pop();on.delete(next);group.push(next);}while(next!==id);
  if(group.length>1||nodes.get(id).waitsFor.includes(id)){const soft=group.map(k=>nodes.get(k)).filter(n=>n.cancellable===true&&n.committed!==true).sort((a,b)=>(a.priority??5)-(b.priority??5)||a.id.localeCompare(b.id));cycles.push({nodes:group.sort(),remedy:soft[0]?{owner:soft[0].owner,node:soft[0].id,action:'cancel_uncommitted_and_replan'}:{owner:'reconciler',action:'obtain_native_evidence',reason:'Committed or unknown outcome cannot be cancelled by expiry'}});}
 }
 for(const id of nodes.keys())if(!index.has(id))visit(id);return {nodes:[...nodes.values()],cycles};
}
function forActor(i,t){
 const rows=t.nodes.map(n=>({id:n.id,waitsFor:n.depends.filter(k=>t.nodes.find(x=>x.id===k)?.state!=='verified'),owner:'character-tick',committed:false}));
 if(t.free!==null&&t.free<2){
  rows.find(r=>r.id==='space').waitsFor.push('inventory-work');rows.push({id:'inventory-work',waitsFor:['storage'],owner:'character-tick'});
  const trade=i.teamTradeIntent,r=i.tradeJournal,name=i.character?.name||i.credentials?.charName;
  const blocked=require('./personal-storage').gate(i).reason==='storage-trade-awaiting-reconciliation';
  rows.push({id:'storage',waitsFor:blocked?['trade-result']:[],owner:'character-tick'});
  const uncommitted=trade?.phase==='GATHERING'&&trade.offer?.kind==='gear'&&trade.offer.receiver===name&&r?.id===trade.id&&require('./team-trade').noDispatch(r);
  rows.push({id:'trade-result',waitsFor:uncommitted?['space']:[],owner:'trade',committed:!uncommitted,cancellable:uncommitted,priority:0});
 }
 const deps=i.progressionDependencies;
 if(Array.isArray(deps))for(const d of deps.slice(0,32))if(d.evidence&&d.build===t.build)rows.push(d);
 return analyze(rows);
}
module.exports={analyze,forActor};
