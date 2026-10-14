'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),{execFile}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),config=require('../machines/fleet.json');
const loadedIdentity=require('./knowledge/system-version').inventory(ROOT),controllerStartedAt=Date.now();
const flights=new Map(),cache=new Map();
const read=file=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));}catch{return null;}};
function clean(v){if(Array.isArray(v))return v.map(clean);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['password','token','username','account','credentials','logFile'].includes(k)).map(([k,x])=>[k,clean(x)]));return v;}
function call(machine,route,slot,control){
 const host=require('./registry/topology').read(ROOT).hosts[machine];if(!host)throw Error('Unregistered controller');
 if(host.adapter==='registered_private_bridge')return require('./registry/host-adapter').request(ROOT,machine,route,{slot});
 if(machine==='vps')return require('./expansion-dashboard').call(route,slot);
 if(!['windows','tum'].includes(machine))throw Error('Registered host adapter missing');
 const key=machine+':'+route+':'+slot+(control?':'+JSON.stringify(control):''),ttl=route==='status'?10000:5000;
 if(!control&&!['start','stop'].includes(route)&&cache.has(key)&&Date.now()-cache.get(key).at<ttl)return Promise.resolve(cache.get(key).value);
 if(flights.has(key))return flights.get(key);
 const promise=new Promise((resolve,reject)=>{
  if(machine==='windows'){
   if(route==='progress'){resolve(require('./reports').summary(read('logs/reports.json')||{}));return;}
   if(route==='status'){
    const req=http.get('http://127.0.0.1:4711/api/panel-health',res=>{let out='';res.on('data',b=>out+=b);res.on('end',()=>{try{
     const health=JSON.parse(out);if(health.service!=='asteria-panel')throw Error('Unexpected panel service');
     const command="$rows=@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'scripts[/\\\\]run\\.js' }); if($rows.Count -eq 1){[DateTimeOffset]::new($rows[0].CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds()}";
     execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:5000},(err,start)=>{
      const snapshot=read('logs/status.json')||{},telemetry=read('logs/fleet/local.json')||{},os=require('os'),startedAt=err?null:Number(start.trim())||null;
      resolve(clean({...snapshot,controllerProof:health,running:!!health.running,...Object.fromEntries(['operatorStopped','intentAuthority','intentAt','intentRevision','intentRequestedAt'].map(k=>[k,health[k]])),error:health.running?null:'Windows farm is not running',snapshotAt:snapshot.at,startedAt,snapshotRunVerified:startedAt!==null,game:{build:telemetry.build},host:{freeMb:Math.round(os.freemem()/1048576),totalMb:Math.round(os.totalmem()/1048576),cpus:os.cpus().length}}));
     });
    }catch(e){reject(e);}});});req.setTimeout(3000,()=>req.destroy(Error('Panel health timeout')));req.on('error',reject);return;
   }
   if(['start','stop'].includes(route)){require('./runtime/panel-client').request(route,{n:config.members.filter(m=>m.machine==='windows').length,god:true,nodraw:true}).then(x=>resolve(clean(x)),reject);return;}
   const body=['start','stop'].includes(route)?JSON.stringify({n:config.members.filter(m=>m.machine==='windows').length,god:true,nodraw:true}):null;
   const req=http.request({host:'127.0.0.1',port:4711,path:'/api/'+route+(route==='char'?'?slot='+slot:''),method:body?'POST':'GET',timeout:body?90000:15000,headers:body?{'Content-Type':'application/json'}:{}},res=>{let out='';res.on('data',b=>out+=b);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('Panel request failed');resolve(clean(JSON.parse(out)));}catch(e){reject(e);}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Panel timeout')));req.end(body);
  }else{
   const bridge=config.ssh.exchange.replace(/fleet-exchange\.py$/,'fleet-panel-bridge.py');
   require('./runtime/fleet-transport').sshCapture(['-n','-o','BatchMode=yes','-o','ConnectTimeout=5',config.ssh.host,'python3',bridge,Buffer.from(JSON.stringify({route,slot,...(control?{control}:{})})).toString('base64')],{windowsHide:true,timeout:['start','stop'].includes(route)?90000:18000,maxBuffer:2000000},(err,out)=>{if(err)return reject(Error('tum connection unavailable'));try{resolve(clean(require('./runtime/fleet-transport').decode(out)));}catch{reject(Error('Invalid tum response'));}});
  }
 }).then(value=>{if(route==='progress'){if(machine==='tum')value=require('./reports').summary(value);const roster=config.members.filter(r=>r.machine===machine);const assigned=row=>roster.some(r=>r.slot===row.slot&&r.charName===row.name);value.rows=value.rows.filter(assigned);value.series=value.series.filter(assigned);value.events=value.events.filter(e=>roster.some(r=>r.slot===e.slot));value.meta={machine,fetchedAt:Date.now(),snapshotAt:value.at?new Date(value.at).toISOString():null};}else if(machine==='windows'&&route!=='status'){const source=read('logs/status.json'),i=source?.instances?.find(i=>i.slot===slot);value.meta={machine,fetchedAt:Date.now(),snapshotAt:source?.at||null,lastSaveAt:i?.lastSaveAt||null};if(route==='char'&&i)Object.assign(value,{runtimeV3:require('./runtime/v3-projection').project(i.runtimeV3),identity:i.identity||null,astral:i.astral||null,astralObjective:i.astralObjective||null,observations:i.observations||null,workContinuity:i.workContinuity,resourceHealth:i.resourceHealth,characterJourney:i.characterJourney,runtimeHealth:i.runtimeHealth,runtimeCost:i.runtimeCost,actualProgress:i.actualProgress,dailyActivities:i.dailyActivities,teamCooperation:i.teamCooperation,guildDevelopment:i.guildDevelopment,activePetPlan:i.activePetPlan,petActive:i.petActive,mainQuest:i.mainQuest,endgameCampaign:i.endgameCampaign,teamTradeStatus:i.teamTradeStatus,memory:i.memory,recovery:i.recovery,freshness:i.freshness,levelProgress:i.levelProgress||null,levelTrainingStatus:i.levelTrainingStatus||null,developmentProgress:i.developmentProgress||null,equipmentCeiling:i.equipmentCeiling,investmentPlan:i.investmentPlan,gearImpact:i.gearImpact,runtimeV2:i.runtimeV2,development:i.development,questOutcomes:i.questOutcomes,personalBrain:i.personalBrain,wing:publicWing(i)});}if(machine==='windows'&&route==='plan'){const state=read('logs/status.json');value.rows=(value.rows||[]).map(r=>{const i=state?.instances?.find(i=>i.slot===r.slot&&i.char===r.char);return i?{...r,wing:publicWing(i)}:r;});}if(route==='char'){const e=require('./economy'),b=value.equipmentCeiling?.build||value.endgameCampaign?.build||read('logs/fleet/local.json')?.build||e.newestBuild(ROOT),cat=e.loadCatalog(ROOT,b);value.equip=(value.equip||[]).map(row=>{const item=cat.items[row.id];return item?.rarityEvidence==='reviewed_native_generator'?{...row,rarity:item.rarity,tier:item.tier,stats:item.stats}:row;});}if(route==='char'&&value.wing)value.wing=require('./wing-recipes').publicPlan(value.wing);if(route==='plan')value.rows=(value.rows||[]).map(r=>({...r,wing:require('./wing-recipes').publicPlan(r.wing)}));cache.set(key,{at:Date.now(),value});return value;}).finally(()=>flights.delete(key));flights.set(key,promise);return promise;
}
function publicWing(i){
 const e=require('./economy'),build=read('logs/reports.json')?.build||e.newestBuild(ROOT),cat=e.loadCatalog(ROOT,build),wiki=e.loadWiki(ROOT);
 const p=e.wingPlan({job:i.job,lv:i.lv,coins:i.coins||0,materials:i.materials||{},held:e.ownedNames(i),world:cat.world,items:cat.items,wings:e.loadWings(ROOT,build),recipes:wiki?.crafting?.recipes||[]});
 if(p&&(!i.lastSaveAt||Date.now()-i.lastSaveAt>30000||Date.now()-i.lastSaveAt < -5000)){p.craftable=false;p.blockedReason='ข้อมูลตัวละครเก่า ต้องรับ save ใหม่ก่อนคราฟ';}
 return require('./wing-recipes').publicPlan(p);
}
function memberEvidence(state,rich,live,fresh,currentRun,detailAge,now){
 const recent=at=>Number.isFinite(at)&&now-at>=-5000&&now-at<30000;
 const snapshotFresh=!!(state?.running&&currentRun&&rich&&detailAge!==null&&detailAge>=-5000&&detailAge<45000&&recent(rich.lastSaveAt));
 const row=fresh?live:snapshotFresh?rich:null;
 const online=!!(state?.running&&row?.status==='playing'&&!row.recycling&&recent(row.lastSaveAt));
 const known=!!row&&(row.status!=='playing'||online);
 return {online,known,status:row?.status||'stale',evidenceSource:fresh?'fleet_telemetry':snapshotFresh?'controller_snapshot':'unavailable'};
}
function assemble(states,now=Date.now()){
 const telemetry={windows:read('logs/fleet/local.json'),tum:read('logs/fleet/tum.json')};
 const members=config.members.map(r=>{
  const state=states[r.machine],source=telemetry[r.machine];
  const rich=state?.instances?.find(i=>i.slot===r.slot&&(i.identity?.actorId||i.char===r.charName));
  const live=source?.machine===r.machine&&source?.members?.find(i=>i.slot===r.slot&&(i.identity?.actorId||i.charName===r.charName));
  const age=source?now-source.at:null,fresh=age!==null&&age>=-5000&&age<15000;
  const detailAge=state?.snapshotAt?now-Date.parse(state.snapshotAt):null;
  const currentRun=state?.snapshotRunVerified!==false&&(!state?.running||Date.parse(state.snapshotAt)>=state.startedAt);
  const evidence=memberEvidence(state,rich,live,fresh,currentRun,detailAge,now);
  const display=fresh?live:evidence.evidenceSource==='controller_snapshot'?rich:null;
  return {...r,charName:display?.identity?.actorId?(display.charName||display.char||r.charName):r.charName,key:display?.identity?.actorId||rich?.identity?.actorId||r.machine+':'+r.slot,transportKey:r.machine+':'+r.slot,details:rich?{...clean(rich),...require('./runtime/metric-freshness').screenMetrics(rich,now,fresh?live?.performance:null)}:null,detailsAgeMs:detailAge,detailsFresh:!!(currentRun&&rich&&detailAge!==null&&detailAge>=-5000&&detailAge<60000),ageMs:age,fresh,...evidence,lv:display?.lv??null,job:display?.job??null,map:display?.livePos?.room||display?.mapId||null,partyId:display?.teamPartyId??null,goal:display?.goal||null,vitals:display?.vitals||null};
 });
 const view=read('logs/fleet/view.json'),viewFresh=view&&now-view.at<15000&&now-view.at>=-5000;
 return {at:now,expected:config.members.length,online:members.filter(m=>m.online).length,unknown:members.filter(m=>!m.known).length,complete:!!(viewFresh&&view.complete&&members.every(m=>m.online)),dailyActivities:viewFresh?clean(view.dailyActivities):null,workboard:viewFresh?clean(view.workboard):null,party:viewFresh?view.party:null,director:viewFresh?view.director||null:null,members,machines:Object.fromEntries(['windows','tum'].map(m=>[m,{build:telemetry[m]?.build||null,running:states[m]?.running||false,...Object.fromEntries(['operatorStopped','intentAuthority','intentAt','intentRevision','intentRequestedAt'].map(k=>[k,states[m]?.[k]])),host:states[m]?.host||null,governor:states[m]?.governor||null,error:states[m]?.error||null,snapshotAt:states[m]?.snapshotAt||null,version:states[m]?.gameKnowledge?.systemVersion?Object.fromEntries(['at','build','sourceRevision','loadedSystemRevision','aligned'].map(k=>[k,states[m].gameKnowledge.systemVersion[k]])):null}])),linkError:viewFresh?view.linkError:'รอข้อมูลการเชื่อมทีม'};
}
function start(port=4712,{activityCall=(control)=>call('tum','activity-control',undefined,control)}={}){
 const controls=new(require('./runtime/control-gateway').ControlGateway)(ROOT);
 const server=http.createServer(async(req,res)=>{
  let controlId=null;
  const send=(code,value)=>{if(controlId)controls.finish(controlId,code,value);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/control-policy'&&req.method==='GET'){for(const machine of [...new Set(controls.rows.filter(r=>['PENDING','UNCERTAIN'].includes(r.state)).map(r=>r.machine))]){try{cache.delete(machine+':status:undefined');const state=machine==='vps'?await require('./expansion-dashboard').call('status'):await call(machine,'status');controls.reconcile(machine,state.controllerProof);}catch{}}return send(200,{...controls.policy(),pending:controls.view()});}
   if(req.method==='POST'&&['/api/start','/api/stop'].includes(url.pathname)){
    const localPort=server.address()?.port||port;if(![`http://127.0.0.1:${localPort}`,`http://localhost:${localPort}`].includes(req.headers.origin))return send(403,{error:'Local control Origin required'});
    let attempt;try{attempt=controls.begin(req.headers,{route:url.pathname.split('/').at(-1),machine:url.searchParams.get('machine')});}catch(e){return send(409,{error:e.message});}
    if(attempt.duplicate)return send(202,{ok:true,duplicate:true,control:attempt.row});controlId=attempt.row.id;
   }
   if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'public/fleet.html')));}
   if(['/registry-v32.js','/fleet-dom.js','/fleet-expansion.js','/fleet-extra.js','/fleet-activities.js','/academy-ui.js','/fleet-layout.js','/fleet-layout.css','/progress-charts.js','/progress-charts.css','/adaptive-model.js','/adaptive-lab.js','/adaptive-lab.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'public',url.pathname.slice(1))));}
   if(url.pathname==='/registry'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'public/registry-v32.html')));}
   if(url.pathname==='/api/registry-status'&&req.method==='GET')return send(200,require('./registry/diagnostics').view(ROOT));
   if(url.pathname==='/api/health')return send(200,{service:'asteria-fleet-dashboard',loadedRevision:loadedIdentity.fullRevision,loadedFarmRevision:loadedIdentity.revision,loadedWebRevision:loadedIdentity.components.web.revision,startedAt:controllerStartedAt});
   if(url.pathname==='/api/activity-control'){
    if(req.method==='GET')return send(200,await activityCall());
    if(req.method!=='POST')return send(405,{error:'POST required'});
    const activePort=server.address()?.port||port;
    if(req.headers.origin!==`http://127.0.0.1:${activePort}`&&req.headers.origin!==`http://localhost:${activePort}`)return send(403,{error:'Use the local dashboard to send commands'});
    let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>2048)return send(413,{error:'Command too large'});}
    let body;try{body=JSON.parse(text);}catch{return send(400,{error:'Invalid JSON'});}
    if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'Invalid activity command'});
    const result=await activityCall(body);cache.clear();return send(result.ok===false?409:200,result);
   }
   if(url.pathname==='/api/encyclopedia'&&req.method==='GET'){
    const service=require('./knowledge/mastery-service'),build=read('logs/reports.json')?.build||require('./economy').newestBuild(ROOT),book=service.getBook(ROOT,build);
    return send(200,{...service.summary(book),matches:require('./knowledge/encyclopedia').query(book,{q:url.searchParams.get('q')||'',domain:url.searchParams.get('domain')||'',limit:30})});
   }
   if(url.pathname==='/api/academy'&&req.method==='GET'){
    const results=await Promise.allSettled(['windows','tum'].map(m=>call(m,'status'))),states=Object.fromEntries(results.map((r,i)=>[['windows','tum'][i],r.status==='fulfilled'?r.value:{error:r.reason.message}])),fleet=assemble(states),service=require('./knowledge/mastery-service'),build=read('logs/reports.json')?.build||require('./economy').newestBuild(ROOT),book=service.getBook(ROOT,build);
    return send(200,{at:Date.now(),knowledge:service.summary(book),members:fleet.members.map(m=>({character:m.charName,machine:m.machine,slot:m.slot,status:m.status,mastery:m.details?.runtimeV2?.mastery||null,masteryFresh:!!(m.detailsFresh&&m.details?.runtimeV2?.mastery&&Date.now()-m.details.runtimeV2.mastery.at<120000),techniques:m.details?.runtimeV2?.techniques||[],operations:m.details?.runtimeV2||null,learningRevision:m.details?.runtimeV2?.learningRevision||null}))});
   }
   if(url.pathname==='/api/soak'&&req.method==='GET')return send(200,read('logs/system-audit/fleet-soak.json')||{status:'not_started',longTermVerified:false});
   if(url.pathname==='/api/expansion'&&req.method==='GET')return send(200,require('./expansion-dashboard').view());
   if(url.pathname==='/api/fleet'&&req.method==='GET'){
    const expData=require('./public/exp-data'),expReads=Promise.all([expData.remote('tum'),expData.remote('vps')]);
    const results=await Promise.allSettled([...['windows','tum'].map(m=>call(m,'status')),require('../scripts/tum-extra-view').view()]);
    const states=Object.fromEntries(results.map((r,i)=>[['windows','tum'][i],r.status==='fulfilled'?r.value:{error:r.reason.message}])),primary=assemble(states),expansion=require('./expansion-dashboard').view();
    const tumExtra=results[2].status==='fulfilled'?results[2].value:require('../scripts/tum-extra-view').project(null);
    const [tumExp,vpsExp]=await expReads;
    expData.attach(primary.members.filter(m=>m.machine==='windows'),{build:primary.machines.windows.build,snapshotAt:states.windows.snapshotAt,rows:(states.windows.instances||[]).map(i=>({slot:i.slot,char:i.char,lv:i.lv,exp:i.exp,lastSaveAt:i.lastSaveAt,levelProgress:i.levelProgress}))});
    expData.attach(primary.members.filter(m=>m.machine==='tum'),tumExp);
    expData.attach(expansion?.members,vpsExp);
    const adaptiveLab=require('./public/adaptive-data').observe([...primary.members,...(expansion?.members||[])]);
    return send(200,{...primary,expansion,tumExtra,adaptiveLab,systemExpected:primary.expected+(expansion?.expected||0)+(tumExtra.state==='paused'?0:tumExtra.expected),systemPaused:(tumExtra.state==='paused'?tumExtra.expected:0)+(expansion?.paused||0),systemOnline:primary.online+(expansion?.online||0)+tumExtra.online});
   }
   const route=url.pathname.replace('/api/',''),machine=url.searchParams.get('machine'),slot=Number(url.searchParams.get('slot'));
   if(machine==='vps'){
    if(!['char','plan','progress','map','team-brain','start','stop'].includes(route))return send(404,{error:'Unknown VPS endpoint'});
    if(['start','stop'].includes(route)){
     if(req.method!=='POST')return send(405,{error:'POST required'});
     const localPort=server.address()?.port||port;
     if(![`http://127.0.0.1:${localPort}`,`http://localhost:${localPort}`].includes(req.headers.origin))return send(403,{error:'Use the local dashboard to send commands'});
    }else if(req.method!=='GET')return send(405,{error:'GET required'});
    if(route==='char'&&!require('./expansion-dashboard').registry().members.some(m=>m.slot===slot))return send(400,{error:'Unknown VPS character'});
    const result=await require('./expansion-dashboard').call(route,route==='char'?slot:undefined);
    if(route==='char')result.expProgress=require('./public/exp-data').progress({...result,lastSaveAt:result.levelProgress?.saveAt},result.levelProgress?.build,{snapshotAt:result.levelProgress?.at});
    return send(200,route==='progress'?require('./reports').summary(result):{...result,meta:{machine:'vps',expected:require('./expansion-dashboard').registry().members.length,fetchedAt:Date.now(),snapshotAt:result.at||null}});
   }
   if(!['windows','tum'].includes(machine)||!['char','plan','reports','progress','map','team-brain','advice','start','stop'].includes(route))return send(404,{error:'Unknown endpoint'});
   if(['start','stop'].includes(route)){
    if(req.method!=='POST')return send(405,{error:'POST required'});
    if(req.headers.origin!==`http://127.0.0.1:${port}`&&req.headers.origin!==`http://localhost:${port}`)return send(403,{error:'Use the local dashboard to send commands'});
   }else if(req.method!=='GET')return send(405,{error:'GET required'});
   if(route==='char'&&!config.members.some(r=>r.machine===machine&&r.slot===slot))return send(400,{error:'Unknown character'});
   const result=await call(machine,route,slot);if(route==='char')result.expProgress=require('./public/exp-data').progress({...result,lastSaveAt:result.meta?.lastSaveAt||result.levelProgress?.saveAt},result.levelProgress?.build,{snapshotAt:result.meta?.snapshotAt||result.levelProgress?.at});if(['start','stop'].includes(route))cache.clear();return send(200,result);
  }catch(e){send(503,{error:e.message});}
 });server.listen(port,'127.0.0.1',()=>console.log('Fleet dashboard: http://127.0.0.1:'+port));return server;
}
if(require.main===module)start();
module.exports={assemble,clean,start,memberEvidence,call};
