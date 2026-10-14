'use strict';
// Verified against tum's cached client build c9549bc, 2026-09-30.
const town = { w1: [115.5, 0], s1: [160, 33.5], e1: [204.5, 0],
  n1: [130, -34.5], d1: [190, -34.5], r1: [200, -18], c1: [126, 25] };
const regions = [['w1','w2','w3'], ['s1','s2','s3'], ['e1','e2','e3'],
  ['n1','n2','n3'], ['d1','d2','d3','d4'], ['r1','r2','r3','r4'], ['c1','c2','c3','c4']];
const gates = { town: Object.entries(town).map(([target, [x,z]]) => ({ target, x, z })) };
for (const region of regions) region.forEach((id, i) => {
  gates[id] = [{ target: 'town', x: 0, z: 40 }];
  if (i) gates[id].push({ target: region[i-1], x: -38, z: -2 });
  if (i + 1 < region.length) gates[id].push({ target: region[i+1], x: 16, z: -42 });
});
function route(from, to,observed) {
  let graph=gates;
  if(observed){
    const {townGates,links,fieldGates}=observed;
    if(!fieldGates?.home||!fieldGates.previous||!fieldGates.next||!Object.keys(townGates||{}).length)return null;
    const coordinates=[...Object.values(townGates),...Object.values(fieldGates)];
    if(coordinates.some(g=>!Number.isFinite(g.x)||!Number.isFinite(g.z)||Math.abs(g.x)>1000||Math.abs(g.z)>1000))return null;
    graph={town:Object.entries(townGates).map(([target,g])=>({target,...g}))};
    for(const[id,link]of Object.entries(links||{})){
      graph[id]=[{target:'town',...fieldGates.home}];
      if(link.prev)graph[id].push({target:link.prev,...fieldGates.previous});
      if(link.next)graph[id].push({target:link.next,...fieldGates.next});
    }
  }
  const queue = [[from, []]], seen = new Set([from]);
  for (const [room, path] of queue) {
    if (room === to) return path;
    for (const gate of graph[room] || []) if (!seen.has(gate.target)) {
      seen.add(gate.target); queue.push([gate.target, [...path, gate]]);
    }
  }
  return null;
}
module.exports = { route };
