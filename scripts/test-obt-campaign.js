'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {setup,names}=require('./setup-obt-campaign');
async function run(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-obt-test-'));
 try{
  const old=Object.keys(names),fleet={version:1,leader:old[0],members:old.map((charName,i)=>({charName,machine:i<3?'tum':'windows',slot:i%3,baseJob:['knight','priest','ranger','assassin','mage','monk'][i]}))};
  const put=(f,v)=>{fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.writeFileSync(path.join(root,f),typeof v==='string'?v:JSON.stringify(v));};
  put('machines/fleet.json',fleet);put('team.json',{members:old.slice(3).map((charName,slot)=>({charName,slot,storageSlot:slot+7,job:fleet.members[slot+3].baseJob}))});
  for(let slot=0;slot<3;slot++)put('profiles/slot-'+String(slot+7).padStart(2,'0')+'/account.json',{token:'private-'+slot});
  put('logs/fleet/team-trade.json',{phase:'UNCERTAIN'});put('logs/actions/old.json',{pending:true});put('logs/reports.json',{old:true});put('data/learning/brain-7.json',{dead:true});put('data/wiki.json',{keep:true});put('logs/account-backup/keep.json','private');
  const chars=new Map(),active=new Map();let creates=0,failAfterCreate=true;
  const service={whoami:async()=>({valid:true}),health:async()=>({build:'obt-test'}),api:async()=>({ok:true,json:{save:null}}),listChars:async t=>({chars:chars.get(t)||[],active:active.get(t)||null}),createChar:async(t,name)=>{creates++;const c={name,id:'character-'+creates,lv:1,job:'novice'};chars.set(t,[c]);if(failAfterCreate){failAfterCreate=false;throw Error('unknown response');}return c;},selectChar:async(t,id)=>{active.set(t,id);}};
  await assert.rejects(setup(root,'windows',{service,assertStopped:()=>{throw Error('running');}}),/running/);assert.equal(creates,0);
  await assert.rejects(setup(root,'windows',{service,assertStopped:()=>{}}),/unknown response/);
  const result=await setup(root,'windows',{service,assertStopped:()=>{}});assert.equal(creates,3);assert.equal(result.phase,'ready');assert.equal(result.members.length,3);
  assert(fs.existsSync(path.join(root,'logs/epochs/obt-2026-10-03/windows/logs/actions/old.json')));assert(!fs.existsSync(path.join(root,'data/learning/brain-7.json')));
  assert.equal(fs.readFileSync(path.join(root,'logs/account-backup/keep.json'),'utf8'),'private');assert(fs.existsSync(path.join(root,'data/wiki.json')));
  put('logs/reports.json',{newOBT:true});await setup(root,'windows',{service,assertStopped:()=>{}});assert.equal(creates,3);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'logs/reports.json'))).newOBT,true);
  assert(!JSON.stringify(result).includes('private-'));
  chars.set('private-0',[{id:'unrelated',name:'UnexpectedCharacter'}]);await assert.rejects(setup(root,'windows',{service,assertStopped:()=>{}}),/unexpected existing/);
  console.log('OBT campaign: PASS (reset guard, stopped guard, uncertain response reconciliation, credentials retained, archive idempotency)');
 }finally{const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('asteria-obt-test-'));fs.rmSync(resolved,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
