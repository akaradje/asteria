'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),{project,scrub,registry}=require('../src/expansion-dashboard');
const configured=registry(),r={...configured,activeCount:configured.members.length},now=1000000,party={id:99,leader:r.leader,checkedAt:now,members:r.members.map(m=>m.charName)};
const snapshot={running:true,snapshotAt:new Date(now).toISOString(),party,guild:{name:r.guild.name,checkedAt:now,members:party.members},instances:r.members.map(m=>({slot:m.slot,char:m.charName,status:'playing',lastSaveAt:now,lv:1,teamPartyId:99}))};
let p=project(snapshot,r,now);assert.equal(p.online,r.members.length);assert(p.complete&&p.guildReady);assert.equal(p.expected,r.members.length);
assert(!project({...snapshot,party:{...party,members:[...party.members,'ExampleTankA']}},r,now).complete,'foreign primary member cannot make a mixed party ready');
assert(!project({...snapshot,instances:snapshot.instances.map((i,n)=>({...i,teamPartyId:n===1?100:99}))},r,now).complete);
assert.equal(project({...snapshot,snapshotAt:new Date(now-45000).toISOString()},r,now).online,0);
assert.equal(project({...snapshot,snapshotAt:new Date(now+1).toISOString()},r,now).online,0);
assert.equal(project({...snapshot,running:false},r,now).online,0);
assert.equal(project({...snapshot,instances:snapshot.instances.map(i=>({...i,lastSaveAt:now-30000}))},r,now).online,0);
const reduced=project(snapshot,{...r,activeCount:3},now);assert.equal(reduced.expected,3);assert.equal(reduced.registered,6);assert.equal(reduced.online,3);assert.equal(reduced.paused,3);assert(reduced.complete);assert(reduced.members.slice(3).every(m=>m.status==='paused'&&!m.online&&!m.detailsFresh&&m.details===null));assert(project({...snapshot,party:{...party,members:party.members.slice(0,3)}},{...r,activeCount:3},now).complete);assert(!project({...snapshot,party:{...party,members:party.members.slice(0,2)}},{...r,activeCount:3},now).complete);
assert.deepEqual(scrub({char:'ExampleTankB',Password:'X',nested:{TOKEN:'X',OPENROUTER_API_KEY:'X',credentials:{password:'X'},lv:1}}),{char:'ExampleTankB',nested:{lv:1}});
let html='';const host={hidden:false},ctx={document:{getElementById:()=>host},Date:{now:()=>now},esc:v=>String(v??'–').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt:v=>Number.isFinite(v)?String(v):'–',age:()=>'',runtimeHealthLayout:()=>'',actualProgressLayout:()=>'',updateFleetDOM:(h,m)=>html=m};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/public/fleet-expansion.js','utf8'),ctx);p.members[0].charName='<img src=x onerror=alert(1)>';ctx.renderExpansion(p);assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('เริ่ม '+r.members.length+' ตัว'));assert.equal((html.match(/data-expansion-member=/g)||[]).length,r.members.length);ctx.renderExpansion(reduced);assert(html.includes('เริ่ม 3 ตัว'));assert(html.includes('พักเพื่อลดภาระ CPU'));assert(html.includes('พัก 3 ตัว'));ctx.renderExpansion(null);assert(host.hidden);
console.log('PASS independent assigned party, session/save/clock freshness, secret scrubbing and safe expansion cards');
async function polling(){
 let time=now,calls=0,pending;const mod={exports:{}},pollContext={module:mod,exports:mod.exports,Date:{now:()=>time,parse:Date.parse},require:n=>n==='./runtime/fleet-transport'?{encodeCompressed:()=>'',sshCapture:(args,options,done)=>{calls++;pending=done;},decode:JSON.parse}:n==='./planning/cross-party'?{primary:()=>({})}:require(n),__dirname:require('path').resolve('src')};
 vm.runInNewContext(fs.readFileSync('src/expansion-dashboard.js','utf8'),pollContext);
 const api=mod.exports,one=api.refresh();assert.equal(api.refresh(),one);assert.equal(calls,1,'one owned request while previous status is pending');pending(null,JSON.stringify(snapshot));await one;assert.equal(api.view().online,configured.activeCount);assert.equal(api.view().statusFetch.lastSuccessAt,time);
 time+=5001;const failure=api.refresh();pending(Error('transport failed'));await failure;assert.equal(api.view().running,true,'transport failure is not proof that the farm stopped');assert.match(api.view().error,/ยังไม่ยืนยัน/);assert.equal(api.view().statusFetch.busy,false,'failure releases subsequent polls');
 time+=45000;assert.equal(api.view().online,0,'old cached receipt never reports online beyond freshness limit');assert.equal(calls,3);pending(null,JSON.stringify({...snapshot,snapshotAt:new Date(time).toISOString(),instances:snapshot.instances.map(i=>({...i,lastSaveAt:time}))}));await api.refresh();assert.equal(api.view().online,configured.activeCount);assert.equal(api.view().statusFetch.error,null);
 console.log('PASS coalesced retry, honest stale state and recovery after failed transport');
}
polling().catch(e=>{console.error(e);process.exitCode=1;});
