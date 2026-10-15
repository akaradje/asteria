'use strict';
const path=require('path');
const {GameKnowledge}=require('../src/game-knowledge');
const knowledge=new GameKnowledge(path.resolve(__dirname,'..'),{log:console.log});
const fs=require('fs');
let loadedBuild=process.argv.find(a=>a.startsWith('--build='))?.slice(8);
if(!loadedBuild)try{loadedBuild=JSON.parse(fs.readFileSync(path.join(knowledge.root,'logs/status.json'))).gameKnowledge?.systemVersion?.build;}catch{}
if(!require('../src/knowledge/build-id').valid(loadedBuild))throw Error('Use --build=<staged build> or a current loaded-build status snapshot');
knowledge.poll(loadedBuild).then(result=>{if(!result)process.exitCode=1;else console.log(JSON.stringify({build:result.build,changed:result.changed,townGates:Object.keys(result.routes.townGates),evidence:result.evidence,wiki:knowledge.state.wiki,sourceCoherence:knowledge.state.sourceCoherence}));});
