'use strict';
function readyBuild(fleet){
 const a=fleet.machines?.windows?.build,b=fleet.machines?.tum?.build;
 return typeof a==='string'&&a===b&&fleet.complete&&fleet.online===6&&fleet.members?.length===6&&new Set(fleet.members.map(m=>m.key)).size===6&&fleet.members.every(m=>m.online&&m.detailsFresh&&m.details?.fpsFresh)?a:null;
}
function developmentSample(member,startedAt){
 const p=member.detailsFresh?member.details?.developmentProgress:null;
 if(!p)return null;
 return {at:p.at,saveAt:p.saveAt,stage:p.stage,target:p.target?.name||null,current:p.current,
  missing:(p.missing||[]).map(m=>({name:m.name,have:m.have,want:m.want})),emptySlots:p.emptySlots,
  confirmed:(p.confirmed||[]).filter(r=>Number.isFinite(r.at)&&r.at>=startedAt).map(r=>({kind:r.kind,target:r.target,at:r.at,evidence:r.evidence}))};
}
module.exports={readyBuild,developmentSample};
