'use strict';
// One-time, resumable campaign migration. Credentials remain local to each host.
const fs=require('fs'),path=require('path');
const api=require('../src/api');
const epoch='obt-2026-10-03';
const names={ExampleAccount2:'ExampleTankA',ExampleAccount8:'ExampleHealA',ExampleAccount10:'ExampleArcherA',ExampleAccount4:'ExampleRogue',ExampleAccount6:'ExampleMage',ExampleAccount12:'ExampleMonk'};
const stateDirs=['actions','activity-evidence','build-learning','campaign','competitive-gear','context-learning','farm-watchdog','fleet','goal-feedback','guild-development','mastery','personal-history','pvp','quest-outcomes','rankings','recovery','reservations','snapshots','trades','trials'];
const stateFiles=['ai-advice.json','ai-auto.json','dungeon-learning.json','guild-invite-request.json','plan.json','pvp-command.json','reports.json','status.json','team-room.json','tower-team.json','fleet-performance.json'];
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
function archive(root,machine){
 const dest=path.join(root,'logs','epochs',epoch,machine);fs.mkdirSync(dest,{recursive:true});
 const manifestFile=path.join(dest,'archive.json');let manifest;try{manifest=JSON.parse(fs.readFileSync(manifestFile));}catch{manifest={epoch,machine,at:new Date().toISOString(),moved:[],complete:false};}
 if(manifest.complete)return manifest;
 const targets=[...stateDirs.map(n=>'logs/'+n),...stateFiles.map(n=>'logs/'+n),'data/learning'];
 for(const n of fs.readdirSync(path.join(root,'logs')))if(/^(development(?:-equipment)?|gear-impact|outcomes)-\d+\.json$/.test(n))targets.push('logs/'+n);
 for(const rel of targets){
  const source=path.resolve(root,rel),target=path.resolve(dest,rel),prefix=path.resolve(root)+path.sep;
  if(!source.startsWith(prefix)||!target.startsWith(path.resolve(dest)+path.sep))throw Error('Archive path outside workspace');
  if(!fs.existsSync(source))continue;
  if(fs.lstatSync(source).isSymbolicLink())throw Error('Archive refuses symbolic link: '+rel);
  if(fs.existsSync(target))throw Error('Archive destination already exists: '+rel);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(source,target);manifest.moved.push(rel);write(manifestFile,manifest);
 }
 manifest.complete=true;write(manifestFile,manifest);return manifest;
}
function activeFarms(){
 if(process.platform==='win32'){
  const code="Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'scripts[\\\\/]+run\\.js' } | ForEach-Object { $_.ProcessId }";
  return require('child_process').execFileSync('powershell.exe',['-NoProfile','-Command',code],{encoding:'utf8',windowsHide:true}).trim().split(/\s+/).filter(Boolean);
 }
 return fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n)).filter(n=>{try{return /scripts[\\/]+run\.js/.test(fs.readFileSync('/proc/'+n+'/cmdline','utf8'));}catch{return false;}});
}
async function setup(root,machine,{service=api,assertStopped=()=>{if(activeFarms().length)throw Error('Stop external Asteria farms before campaign migration');}}={}){
 if(!['windows','tum'].includes(machine))throw Error('Unknown machine');assertStopped();
 const fleetFile=path.join(root,'machines/fleet.json'),teamFile=path.join(root,'team.json');
 const fleet=JSON.parse(fs.readFileSync(fleetFile)),team=JSON.parse(fs.readFileSync(teamFile));
 const assigned=fleet.members.filter(m=>m.machine===machine);if(assigned.length!==3)throw Error('Expected three local assignments');
 const receiptFile=path.join(root,'logs/system-audit','obt-setup-'+machine+'.json');let receipt;try{receipt=JSON.parse(fs.readFileSync(receiptFile));}catch{receipt={epoch,machine,phase:'preflight',members:[]};}
 if(receipt.epoch!==epoch)throw Error('Unexpected campaign receipt');
 const work=[];
 // Validate all local accounts and the reset before moving history or creating anything.
 for(const a of assigned){
  const old=Object.keys(names).find(n=>n===a.charName||names[n]===a.charName),desired=names[old];
  if(!desired)throw Error('Unrecognized campaign character');
  const m=team.members.find(m=>m.slot===a.slot&&(m.charName===old||m.charName===desired));if(!m)throw Error('Local slot assignment differs');
  const storageSlot=m.storageSlot??m.slot,account=JSON.parse(fs.readFileSync(path.join(root,'profiles','slot-'+String(storageSlot).padStart(2,'0'),'account.json')));
  const token=account.token||m.token;const me=await service.whoami(token);if(!me)throw Error('Account authentication needs repair for '+desired);
  const chars=await service.listChars(token);if(!Array.isArray(chars.chars)||chars.chars.some(c=>c.name!==desired))throw Error('Reset not confirmed: unexpected existing character for '+desired);
  if(chars.chars.length>1)throw Error('Duplicate character for '+desired);
  if(!chars.chars.length){const save=await service.api('/api/save',{token});if(!save.ok||save.json.save!==null)throw Error('Server save not reset for '+desired);}
  work.push({m,token,desired,chars});
 }
 receipt.build=(await service.health())?.build;receipt.resetVerifiedAt=new Date().toISOString();write(receiptFile,receipt);
 receipt.archive=archive(root,machine);receipt.phase='provisioning';write(receiptFile,receipt);
 for(const w of work){
  let c=w.chars.chars[0],row=receipt.members.find(r=>r.name===w.desired);
  if(!row){row={name:w.desired,slot:w.m.slot,role:w.m.job,state:'not_started'};receipt.members.push(row);}
  if(!c){
   if(row.state==='create_pending')throw Error('Unresolved creation: check server result before retrying '+w.desired);
   row.state='create_pending';write(receiptFile,receipt);
   // Never replay a creation after an unknown network result.
   c=await service.createChar(w.token,w.desired);
  }
  if(!c?.id||c.name!==w.desired)throw Error('Unexpected created character');
  row.charId=c.id;row.state='select_pending';write(receiptFile,receipt);
  await service.selectChar(w.token,c.id);
  const check=await service.listChars(w.token);if(!check.chars.some(x=>x.id===c.id&&x.name===w.desired)||check.active!==c.id)throw Error('Selection not confirmed for '+w.desired);
  w.m.charName=w.desired;w.m.charId=c.id;w.m.token=w.token;
  write(teamFile,team);try{fs.chmodSync(teamFile,0o600);}catch{}
  row.state='selected';row.verifiedAt=new Date().toISOString();row.native={lv:c.lv??null,job:c.job??null};write(receiptFile,receipt);
 }
 for(const m of fleet.members)m.charName=names[m.charName]||m.charName;
 fleet.leader=names[fleet.leader]||fleet.leader;require('../src/federation').validate(fleet);write(fleetFile,fleet);
 team.meta={...team.meta,campaignEpoch:epoch};write(teamFile,team);try{fs.chmodSync(teamFile,0o600);}catch{}
 receipt.phase='ready';receipt.completedAt=new Date().toISOString();write(receiptFile,receipt);
 return {epoch,machine,phase:receipt.phase,build:receipt.build,members:receipt.members};
}
if(require.main===module)setup(path.resolve(__dirname,'..'),process.argv[2]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={setup,archive,names,epoch};
