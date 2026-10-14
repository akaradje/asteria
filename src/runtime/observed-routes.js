'use strict';
function loadedRoutes(root, build, identity) {
  const fs=require('fs'),path=require('path');
  const dir=path.join(root,'logs','game-knowledge');
  try {
    const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));
    const matches=f=>f?.build===build&&require('../knowledge/loaded-source').inspect(root,build,f.sourceHashes,{identity}).matches;
    if(matches(state.current))return state.current.routes;
    const facts=fs.readdirSync(dir).filter(name=>name.startsWith(build+'-')).map(name=>{
      try{return JSON.parse(fs.readFileSync(path.join(dir,name,'facts.json'),'utf8'));}catch{return null;}
    }).filter(matches).sort((a,b)=>b.at-a.at);
    return facts[0]?.routes;
  } catch { return null; }
}
function route(from, to,observed) {
  let graph={}; if(!observed)return null;
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
module.exports = { route, loadedRoutes };
