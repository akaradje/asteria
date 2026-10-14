'use strict';
// List scheduling with exclusive actor/resources. Unknown duration is not zero;
// a dependent task's completion remains unknown. This is an estimate, not an SLA.
function estimate(nodes){
 if(!Array.isArray(nodes)||nodes.length>256)throw Error('Bounded dependency graph required');
 const byId=new Map();for(const n of nodes){if(!n||typeof n.id!=='string'||!n.id||byId.has(n.id)||!Array.isArray(n.depends)||!Array.isArray(n.resources)||n.resources.some(r=>typeof r!=='string'||!r)||!(n.durationMs===null||Number.isFinite(n.durationMs)&&n.durationMs>=0))throw Error('Invalid dependency node');byId.set(n.id,n);}
 for(const n of nodes)if(n.depends.some(id=>!byId.has(id)))throw Error('Unknown dependency');
 const done=new Map(),locks=new Map(),remaining=[...nodes];
 while(remaining.length){const index=remaining.findIndex(n=>n.depends.every(id=>done.has(id)));if(index<0)return {state:'cycle',etaMs:null,nodes:[],blockedIds:remaining.map(n=>n.id),estimated:true};const n=remaining.splice(index,1)[0];const parents=n.depends.map(id=>done.get(id).finishMs),resources=[...new Set(n.resources)].map(r=>locks.has(r)?locks.get(r):0);const unknown=parents.includes(null)||resources.includes(null);const startMs=unknown?null:Math.max(0,...parents,...resources),finishMs=startMs===null||n.durationMs===null?null:startMs+n.durationMs;
 const row={id:n.id,startMs,finishMs,durationMs:n.durationMs,unknown:n.durationMs===null||unknown};done.set(n.id,row);for(const r of new Set(n.resources))locks.set(r,finishMs);
 }
 const rows=[...done.values()],known=rows.every(r=>r.finishMs!==null);return {state:known?'estimated':'unknown',etaMs:known?Math.max(0,...rows.map(r=>r.finishMs)):null,nodes:rows,unknownIds:rows.filter(r=>r.unknown).map(r=>r.id),estimated:true,method:'dependency_and_exclusive_resource_list_schedule'};
}
module.exports={estimate};
