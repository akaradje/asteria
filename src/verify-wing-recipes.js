'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const canonical=o=>JSON.stringify(Object.entries(o||{}).sort(([a],[b])=>a.localeCompare(b)));
function verify(root,build,wings,recipes){
 let costs,levels;
 try{const text=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');const match=/for \(const \[id, w\] of Object\.entries\(WINGS\)\) EXCHANGE\.push\(RX\('wing',[\s\S]*?w\.from\s*\?\s*(\{[\s\S]*?\})\s*:\s*(\{[\s\S]*?\})/.exec(text);levels=/reqLv:\s*w\.tier\s*>=\s*6\s*\?\s*(\d+)\s*:\s*(\d+)/.exec(text);if(!match||!levels)throw Error('Client wing recipe format is unknown');costs=[match[2],match[1]].map(code=>vm.runInNewContext('('+code+')',{w:{from:'__prerequisite__'}},{timeout:1000}));}catch(e){return (recipes||[]).filter(r=>r.type==='wing').map(r=>({...r,verified:false,verificationError:e.message}));}
 return (recipes||[]).filter(r=>r.type==='wing').map(r=>{
  const w=wings[r.resultId];let expected;
  try{if(!w)throw Error('Wing missing from loaded game build');const raw=costs[w.from?1:0];expected={};for(const[k,v]of Object.entries(raw)){const name=k==='coins'?'Copper':k.startsWith('item:')?wings[w.from]?.name:k;if(!name)throw Error('Unknown prerequisite wing');expected[name]=v;}const ok=canonical(expected)===canonical(r.cost)&&r.reqLv===Number(levels[w.tier>=6?1:2])&&r.result===w.name;return {...r,verified:ok,verificationBuild:build,verificationError:ok?null:'Wiki differs from loaded client recipe'};}catch(e){return {...r,verified:false,verificationBuild:build,verificationError:e.message};}
 });
}
module.exports={verify};
