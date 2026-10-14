'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{provision}=require('./create-expansion-team');
async function run(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-new-team-'));
 try{
  fs.mkdirSync(path.join(root,'machines'));const registry=JSON.parse(fs.readFileSync('machines/expansion.json'));const original=registry.members.slice(0,3);fs.writeFileSync(path.join(root,'machines/expansion.json'),JSON.stringify({...registry,members:original}));
  const accounts=new Map(),chars=new Map(),active=new Map(),notes=[];let registerCount=0,creates=0,crashRegister=true,crashChar=true;
  const service={register:async(u,p)=>{registerCount++;accounts.set(u,p);throw Error('unknown register response');},login:async(u,p)=>({ok:accounts.get(u)===p,token:u}),whoami:async t=>accounts.has(t)?{}:null,listChars:async t=>({chars:chars.get(t)||[],active:active.get(t)}),createChar:async(t,name)=>{creates++;const c={id:'c'+creates,name,lv:1};chars.set(t,[c]);if(crashChar){crashChar=false;throw Error('unknown char response');}return c;},selectChar:async(t,id)=>active.set(t,id)};
  await assert.rejects(()=>provision(root,{service,wait:async()=>{},note:r=>notes.push(r)}),/unknown/);
  assert.equal(registerCount,1);const journal=JSON.parse(fs.readFileSync(path.join(root,'private/vps-registration.json')));assert.equal(journal.rows[0].phase,'uncertain');
  service.register=async(u,p)=>{registerCount++;accounts.set(u,p);return {ok:true,token:u};};
  await assert.rejects(()=>provision(root,{service,wait:async()=>{}}),/unknown char/);
  assert.equal(registerCount,1,'uncertain registration reconciles via original generated credentials');
  const result=await provision(root,{service,wait:async()=>{},note:r=>notes.push(r)});
  assert.equal(result.members.length,3);assert.equal(registerCount,3);assert.equal(creates,3,'created character after timeout is listed, never duplicated');
  await provision(root,{service,wait:async()=>{}});assert.equal(registerCount,3);assert.equal(creates,3);
  assert(!JSON.stringify(notes).match(/username|password|token/));assert(!JSON.stringify(result).match(/username|password|token/));
  fs.writeFileSync(path.join(root,'machines/expansion.json'),JSON.stringify(registry));
  const originalLogin=service.login,originalWhoami=service.whoami;let oldReads=0;
  service.login=async(u,p)=>{if([...accounts.keys()].slice(0,3).includes(u))oldReads++;return originalLogin(u,p);};
  service.whoami=async(t)=>{if([...accounts.keys()].slice(0,3).includes(t))oldReads++;return originalWhoami(t);};
  const appended=await provision(root,{service,onlyNew:true,wait:async()=>{}});assert.equal(appended.members.length,registry.members.length);assert.equal(registerCount,registry.members.length);assert.equal(creates,registry.members.length);assert.equal(oldReads,0,'append never touches original live accounts');
  await provision(root,{service,onlyNew:true,wait:async()=>{}});assert.equal(registerCount,registry.members.length);assert.equal(oldReads,0);
  const team=JSON.parse(fs.readFileSync(path.join(root,'team.json')));assert(team.members.every(m=>active.get(m.token)===m.characterId));
  team.members.push({slot:9,charName:'ExampleTankA'});fs.writeFileSync(path.join(root,'team.json'),JSON.stringify(team));
  await assert.rejects(()=>provision(root,{service,wait:async()=>{}}),/unrelated/);assert.equal(registerCount,registry.members.length);
  console.log('PASS new-account isolation, durable uncertain registration/character recovery, idempotence and credential-free public results');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
