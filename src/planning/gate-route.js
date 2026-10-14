'use strict';
// Wiki adjacency is metadata, never evidence of a native gate.
function route(from,to,wiki,native){
 if(from===to)return [];
 const g=native?.townGates?.[to];
 if(from==='town'&&g&&Number.isFinite(g.x)&&Number.isFinite(g.z))return [to];
 return require('../runtime/observed-routes').route(from,to,native)?.map(g=>g.target)||null;
}
module.exports={route};
