'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {OutcomeMonitor}=require('../src/outcome-monitor'),{GearImpact}=require('../src/gear-impact'),{FleetPerformance}=require('../src/fleet-performance'),{installBossReflex}=require('../src/boss-reflex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-feedback-'));
(async()=>{try{
 const o=new OutcomeMonitor(root,0);let r=o.begin('mana',{mp:5,count:2},{item:'Blue Potion'},100);
 const {choose}=require('../src/investment-plan'),cat={items:{w:{id:'w',name:'w',slot:'weapon',tier:1,stats:{atk:1}},better:{id:'better',name:'better',slot:'weapon',tier:1,stats:{atk:20}}}},wiki={crafting:{recipes:[{type:'gear',result:'better',resultId:'better',reqLv:1,cost:{Copper:100}}]},monsters:{monsters:[]}};
 let investment=choose({lv:10,job:'knight',equip:{weapon:'w'},coins:3000,materials:{'Iron Ore':10}},cat,wiki);assert.equal(investment.selected.kind,'craft');assert(investment.selected.cost<=investment.budget);
 investment=choose({lv:10,job:'knight',equip:{weapon:'w'},coins:1000,materials:{'Iron Ore':10}},cat,wiki);assert.equal(investment.selected,null,'never spend the reserve');
 o.observe({saveAt:99,mp:85,consumables:{'Blue Potion':1}},200);assert.equal(r.status,'pending');
 const recovered=new OutcomeMonitor(root,0);assert(!recovered.allowed('mana',200));recovered.observe({saveAt:300,mp:85,consumables:{'Blue Potion':1}},300);assert.equal(recovered.data.rows[0].status,'observed');
 r=o.begin('support',{hp:.2},{slot:1,room:'tw1'},400);o.observe({peers:[{slot:1,hp:1,room:'other',at:500}]},500);assert.equal(r.status,'pending');o.observe({},20000);assert.equal(r.status,'unconfirmed');assert(!o.allowed('support',20001));assert(o.allowed('support',60000));
 const g=new GearImpact(root,0);let now=100000,s={equip:{weapon:'a'},lv:50,job:'knight',exp:0,coins:0,bestiary:{m:0}};
 function samples(n,kills){for(let j=0;j<n;j++){now+=10000;s={...s,exp:s.exp+20,coins:s.coins+10,bestiary:{m:s.bestiary.m+kills}};g.observe(s,{room:'w1',at:now,dead:false},now);}}
 samples(32,2);assert(!g.view().ready);s={...s,equip:{weapon:'b'}};samples(32,1);assert(g.view().ready);assert.equal(g.view().focus,'focus_gear');s={...s,lv:51};samples(2,1);assert(!g.view().ready,'do not compare across levels');
 const meter=new FleetPerformance(root),bots=Array.from({length:6},()=>({status:'playing',lastSaveAt:now,lastFps:30,livePos:{room:'w1'}}));meter.sample(bots,6,1000,now);bots.forEach(i=>i.lastSaveAt=now+30000);meter.sample(bots,6,1000,now+30000);assert.equal(bots[0].adaptiveTickMs,8000);assert.equal(meter.data.allReadyMs,30000);bots[0].livePos.room='tw1';meter.sample(bots,6,3000,now+36000);assert.equal(bots[0].adaptiveTickMs,5000);
 let time=1000,auto=true,timer,keys=[];class Socket{constructor(){this.handlers={};}send(){}addEventListener(t,fn){this.handlers[t]=fn;}frame(m){this.handlers.message({data:JSON.stringify(m)});}}
 const button={getAttribute:()=>String(auto),click:()=>{auto=!auto;}};
 const context={window:{WebSocket:Socket,addEventListener(){},dispatchEvent:e=>keys.push(e)},document:{activeElement:{tagName:'BODY'},getElementById:id=>id==='autoBtn'?button:id==='panel'?{hidden:true}:null},KeyboardEvent:function(t,o){return {t,...o};},Date:{now:()=>time},setTimeout:fn=>{timer=fn;},Map,Proxy,Math,Number,JSON};
 vm.createContext(context);vm.runInContext('('+installBossReflex.toString()+')({skills:{boss:[{kind:"ground_aoe",radius:3}]},area:["ground_aoe"]})',context);
 const ws=new context.window.WebSocket('wss://game/ws');ws.send(JSON.stringify({t:'state',room:'tw1',x:0,z:0}));ws.frame({t:'mons',room:'tw1',list:[{n:1,id:'boss'}]});context.window.__afBoss.enabled=true;
 ws.frame({t:'mskill',n:1,i:0,x:0,z:0});assert.equal(keys[0].t,'keydown');assert.equal(auto,false);time=1500;ws.send(JSON.stringify({t:'state',room:'tw1',x:0,z:4}));timer();assert.equal(auto,true);assert.equal(keys.at(-1).t,'keyup');assert.equal(context.window.__afBoss.events[0].status,'outside_at_check');
 keys=[];time=3000;ws.frame({t:'mskill',n:1,i:0,x:0,z:0});assert.equal(keys.length,0,'ignore stale player position');
 const {GameInstance}=require('../src/instance');const i=Object.create(GameInstance.prototype);let used=0;
 Object.assign(i,{outcomes:new OutcomeMonitor(root,2),lastSaveAt:Date.now(),lastSave:{lv:50,job:'mage',mp:5,consumables:{'Blue Potion':2}},canDo:()=>true,openGamePanel:async()=>({ok:true}),closeGamePanel:async()=>{},eval:async js=>vm.runInNewContext(js,{document:{querySelector:q=>q.includes('data-f')?{click(){}}:q.includes('data-act')?{click(){used++;}}:null,querySelectorAll:()=>[{dataset:{k:'c:Blue Potion'},click(){}}]}})});
 await i.manageMana({mp:'5 / 100'});assert.equal(used,1);await i.manageMana({mp:'5 / 100'});assert.equal(used,1,'pending mana action must not repeat');
 console.log('PASS durable outcome correlation/backoff, comparable gear windows, fleet pressure hysteresis, real-frame boss evasion/key release/stale guard, MP pending guard');
}finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
