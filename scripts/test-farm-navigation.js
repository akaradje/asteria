'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {GameInstance}=require('../src/instance'),{BrainMemory}=require('../src/brain-memory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-navigation-'));
(async()=>{try{
 const buttons={autoBtn:{on:false},qGo:{on:true}};
 for(const b of Object.values(buttons)){b.getAttribute=()=>String(b.on);b.click=()=>{b.on=!b.on;};}
 const i=Object.create(GameInstance.prototype);i.goal={mapId:'c3'};i.eval=async code=>vm.runInNewContext(code,{document:{getElementById:id=>buttons[id]||null}});
 await i.enableAuto();assert(buttons.autoBtn.on);assert(!buttons.qGo.on,'farm arrival must not activate competing quest navigation');
 i.goal=null;i.questNavBlockedUntil=Date.now()+60000;await i.enableAuto();assert(!buttons.qGo.on,'quest cooldown survives travel');
 i.questNavBlockedUntil=0;await i.enableAuto();assert(buttons.qGo.on,'quest driver remains available without a farming goal');
 i.eval=async()=>null;i.livePos={at:Date.now(),room:'c1',x:0,z:0,dead:true};i.page={keyboard:{down(){throw Error('Walking while dead');},up:async()=>{}}};const walk=await i.walkTo(5,5);assert.equal(walk.reason,'dead');assert(!walk.ok);
 const b=new BrainMemory(root,0),now=Date.now();b.position({room:'c1',dead:true},now,'c3');b.position({room:'town',dead:false},now+1000);assert(!b.blocked(now+1000).c3);b.position({room:'c2',dead:true},now+360000,'c3');assert(b.blocked(now+360000).c3,'different transit maps count against the same failed destination');assert(new BrainMemory(root,0).data.travelDeaths.c3.length===2);assert(!b.blocked(now+2200000).c3,'destination cooldown expires');
 console.log('PASS exclusive farm/quest navigation, retained quest cooldown, stop walking on death, cross-map travel death memory and expiry');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
