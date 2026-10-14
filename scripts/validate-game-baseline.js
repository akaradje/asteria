'use strict';
// Baseline a tested legacy adapter; this does not certify server mechanics or bosses.
const fs=require('fs'),path=require('path');
const {CapabilityPolicy}=require('../src/knowledge/capability-policy');
const root=path.resolve(__dirname,'..'),state=JSON.parse(fs.readFileSync(path.join(root,'logs/game-knowledge/state.json'),'utf8'));
const requested=process.argv.find(a=>a.startsWith('--build='))?.slice(8);
if(!requested||requested!==state.current?.build)throw Error('Specify the exact collected --build= before validation');
const {extract}=require('../src/game-knowledge');
const dir=path.join(root,'logs/game-knowledge',state.current.id),html=fs.readFileSync(path.join(dir,'client.html'),'utf8'),world=fs.readFileSync(path.join(dir,'world.js'),'utf8');
const facts=extract(html,world);
if(Object.keys(facts.routes.townGates).length<5||Object.keys(facts.routes.links).length<10)throw Error('Route schema incomplete');
if(!/weaponOpts/.test(html)||!/EQUIPMENT/.test(world)||!/MONSTERS/.test(world))throw Error('Legacy item schema incomplete');
const {spawnSync}=require('child_process');
for(const script of ['test-game-knowledge.js','test-runtime-v2.js','test-enchant-action.js','test-team-development.js']){const r=spawnSync(process.execPath,[path.join(root,'scripts',script)],{stdio:'inherit'});if(r.status!==0)throw Error('Adapter regression failed');}
new CapabilityPolicy(root).baseline(state,requested,'Known legacy schema plus adapter fixture regressions; outcome confirmation still required; bosses not enabled');
console.log('Legacy adapter baseline recorded for '+requested+'; new mechanics remain gated');
