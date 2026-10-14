'use strict';
const assert=require('assert/strict'),runtime=require('../src/runtime/capped-campaign'),e=require('../src/economy');
(async()=>{const root=process.cwd(),cat=e.loadCatalog(root,JSON.parse(require('fs').readFileSync('machines/fleet-client-release.json')).build),now=Date.now();const save={lv:cat.world.MAX_LV,job:'starweaver',jobLv:50,coins:300000,materials:{...cat.world.ASCEND.items,'Tyrant Ember':0},equip:{},bag:[]};
 const pet=cat.world.MONSTERS.find(m=>m.kind==='normal').id;Object.assign(save,{pets:{[pet]:0},petActive:pet,potions:20,bestiary:{ignar_the_flame_tyrant:1}});
 const i={root,lastSave:save,lastSaveAt:now,vitals:{at:now,hp:1},catalog:()=>cat,campaignGoal:{sideWork:true},bossWindow:{phase:'side-work',boss:null},canDo:()=>false,brain:{blocked:()=>({})},livePos:{room:'town',at:now},socialLast:async()=>({_receivedAt:now,now,list:[{id:'ignar_the_flame_tyrant',map:'n3',up:true,next:0}]})};
 assert(await runtime.routeExpired(i),'new server boss interrupts an outbound side job even when the job started without a boss timetable');
 i.teamControl=true;assert.equal(await runtime.routeExpired(i),false,'team control retains ownership');i.teamControl=false;i.campaignRouteCheck=null;i.socialLast=async()=>({_receivedAt:now-60000,now,list:[]});assert(await runtime.routeExpired(i),'stale board aborts outbound movement rather than trusting old timing');
 console.log('PASS outbound side job deadline: newly live boss preemption, protected team ownership, stale-board interruption');
})().catch(e=>{console.error(e);process.exitCode=1;});
