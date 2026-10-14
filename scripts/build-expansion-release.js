'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'logs/system-audit/expansion-release.tar.gz');
const list=['src','scripts','assets','package.json','package-lock.json','.gitignore','.zcodeignore','AGENTS.md',...fs.readdirSync(path.join(root,'data')).filter(n=>fs.statSync(path.join(root,'data',n)).isFile()&&n.endsWith('.json')).map(n=>'data/'+n),...['fleet.json','fleet-client-release.json','expansion.json','equipment-goal.json','daily-team-activities.json','windows/config.json','tum/config.json','vps/config.json'].map(n=>'machines/'+n)];
const build=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'))).build;
// Public acceptance specifications are required by the delivery evidence index.
list.push('ASTERIA-AI-BRAIN-ARCHITECTURE.md','ASTERIA-AI-BRAIN-DELIVERY-PLAN.md','ASTERIA-GAME-DNA-AND-MARKET-ARCHITECTURE.md');
for(const name of ['_root.json','asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js']){const file='cache/'+build+'/asteria-online.io/'+name;if(!fs.existsSync(path.join(root,file)))throw Error('Current client source missing: '+name);list.push(file);}
for(const d of JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'))).dependencies||[]){const file='cache/'+build+'/'+require('../src/assetcache').keyFor(d.url).replace(/\\/g,'/');if(!fs.existsSync(path.join(root,file)))throw Error('Staged boot dependency missing');list.push(file);}
// Wiki routes may deliberately retain their last verified build while live
// assets are staged. Bundle that exact public dependency, never relabel it.
const wikiBuild=JSON.parse(fs.readFileSync(path.join(root,'data/wiki.json')))?._source?.verifiedBuild;
if(wikiBuild&&wikiBuild!==build){
 if(!/^[a-f0-9]{7,64}$/.test(wikiBuild))throw Error('Invalid Wiki source build');
 for(const name of ['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js']){
  const file='cache/'+wikiBuild+'/asteria-online.io/'+name;
  if(!fs.existsSync(path.join(root,file)))throw Error('Verified Wiki source dependency missing: '+name);
  if(!list.includes(file))list.push(file);
 }
}
// Public historical sources are fixtures only; the live build remains explicitly pinned.
list.push('machines/tum/routes.js','machines/tum/runtime.js','machines/windows/runtime.js','machines/guild-goal.json','machines/runtime-v32.json','machines/topology-v32.json','machines/host-teams.json');
const fixtureNames=['asteria-online-visual-polish.html','asteria-world-system.js','asteria-net.js'];
const fixtureBuilds=new Set([build,wikiBuild]);
for(const name of fs.readdirSync(path.join(root,'scripts')).filter(name=>/^test-.*\.js$/.test(name))){
 const text=fs.readFileSync(path.join(root,'scripts',name),'utf8');
 for(const match of text.matchAll(/['"]([a-f0-9]{7,64})['"]|cache\/([a-f0-9]{7,64})\//g))fixtureBuilds.add(match[1]||match[2]);
}
for(const entry of fs.readdirSync(path.join(root,'cache'),{withFileTypes:true})){
 if(!entry.isDirectory()||!/^[a-f0-9]{7,64}$/.test(entry.name)||!fixtureBuilds.has(entry.name))continue;
 const fixtures=fixtureNames.map(name=>'cache/'+entry.name+'/asteria-online.io/'+name);
 if(!fixtures.every(file=>fs.existsSync(path.join(root,file))))continue;
 for(const file of fixtures)if(!list.includes(file))list.push(file);
}
fs.mkdirSync(path.dirname(out),{recursive:true});const result=cp.spawnSync('tar',['-czf',out,'--exclude=__pycache__',...list],{cwd:root,encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr||'Archive failed');
const entries=cp.execFileSync('tar',['-tzf',out],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
if(entries.some(p=>/^(?:\.env|team\.json|profiles|private|logs|data\/learning)(\/|$)/.test(p)||/(^|\/)__pycache__(\/|$)/.test(p)))throw Error('Operational/private state in release');
console.log(JSON.stringify({file:out,build,entries:entries.length,operationalStateExcluded:true}));
