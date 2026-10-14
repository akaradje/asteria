'use strict';
// One authorized operation: fund ExampleGuild, create it, invite YouLater.
// Requires the tum farm stopped. Never resumes an ambiguous payment.
const fs=require('fs'),path=require('path'),api=require('../src/api');
const exact=(side,coins)=>!!side&&side.coins===coins&&Array.isArray(side.gear)&&side.gear.length===0&&Array.isArray(side.stacks)&&side.stacks.length===0;
function validState(s,id,coins,donor){return !!s&&s.id===id&&!s.dropped?.length&&exact(s.me,donor?coins:0)&&exact(s.them,donor?0:coins);}
const receiptSide=s=>({coins:s?.coins||0,gear:s?.gear||[],stacks:s?.stacks||[]});
function validReceipt(r,id,partner,coins,donor){return !!r&&r.id===id&&r.with===partner&&Number.isInteger(r.rev)&&exact(receiptSide(r.gave),donor?coins:0)&&exact(receiptSide(r.got),donor?0:coins);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,ms=20000){const deadline=Date.now()+ms;while(Date.now()<deadline){const r=await fn();if(r)return r;await sleep(350);}throw Error(label+' confirmation unavailable');}
async function main(){
 if(process.platform==='win32')throw Error('Run on tum only');
 const root=path.resolve(__dirname,'..'),base=path.join(root,'logs/system-audit/guild-create-YouLater-2026-10-04.json'),continuing=process.argv.includes('--continue-confirmed-funding'),uncommitted=process.argv.includes('--continue-uncommitted-request'),createOnly=process.argv.includes('--create-only'),file=createOnly?base.replace('.json','-create-only.json'):uncommitted?base.replace('.json','-continue-2.json'):continuing?base.replace('.json','-continue-1.json'):base;
 if(fs.existsSync(file))throw Error('Existing operation: inspect evidence before any retry');
 const h=await api.health();if(h.build!=='5391707')throw Error('Game build changed; review required');
 const processes=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x));for(const pid of processes){try{if(fs.realpathSync('/proc/'+pid+'/cwd')===root&&fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes('scripts/run.js'))throw Error('Farm still running');}catch(e){if(e.message==='Farm still running')throw e;}}
 const native=fs.readFileSync(path.join(root,'cache',h.build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
 for(const marker of ["NET.social('gcreate', { name })","NET.social('ginv', { name })","coins: T.draft.coins","NET.social(a === 'lock' ? 'trlock' : 'trconfirm')"])if(!native.includes(marker))throw Error('Native action call site changed');
 const {GameInstance}=require('../src/instance'),{AssetCache}=require('../src/assetcache'),{BrowserPool}=require('../src/browserpool');
 const team=JSON.parse(fs.readFileSync(path.join(root,'team.json'))).members,cache=new AssetCache(root,h.build,{blockAudio:true,liteWorldArt:true}),pool=new BrowserPool({headless:true,noDraw:true,noGpu:true,softwareUi:true,log:()=>{}});
 let prior=null;
 if(createOnly){const p=JSON.parse(fs.readFileSync(base.replace('.json','-continue-2.json')));if(p.phase!=='FUNDING_RECONCILED_NOT_CREATED'||p.actions.some(x=>['gcreate','ginv'].includes(x.kind)))throw Error('Funding not reconciled before create-only');prior=p;}
 if(uncommitted){
  const previous=JSON.parse(fs.readFileSync(base.replace('.json','-continue-1.json')));if(previous.phase!=='STOPPED_NO_REPLAY'||previous.actions.length!==1||previous.actions[0].kind!=='trq')throw Error('Previous request cannot continue');
  for(const b of previous.funding.before){const m=team.find(m=>m.charName===b.name),account=JSON.parse(fs.readFileSync(path.join(root,'profiles','slot-'+String(m.storageSlot??m.slot).padStart(2,'0'),'account.json'))),r=await api.api('/api/save',{token:account.token});if(!r.ok)throw Error('Uncommitted request save unavailable');}
  previous.closedSessionEvidence='all standalone contexts closed; no offer/lock/confirm sent; request cannot move Copper; fresh balances are replanned';fs.writeFileSync(base.replace('.json','-continue-1.json'),JSON.stringify(previous,null,2));prior=previous;
 }
 if(continuing){
  prior=JSON.parse(fs.readFileSync(base));const fund=prior.funding?.transfers?.[0];
  if(prior.phase!=='STOPPED_NO_REPLAY'||prior.actions?.some(x=>['gcreate','ginv'].includes(x.kind))||prior.funding.transfers.length!==1||!fund?.sessionId)throw Error('Previous operation cannot continue');
  const balances=[];for(const name of [fund.receiver,fund.donor]){const m=team.find(m=>m.charName===name),account=JSON.parse(fs.readFileSync(path.join(root,'profiles','slot-'+String(m.storageSlot??m.slot).padStart(2,'0'),'account.json'))),r=await api.api('/api/save',{token:account.token});if(!r.ok)throw Error('Reconciliation save unavailable');balances.push({name,coins:r.json.save.coins,at:Date.now()});}
  if(balances[0].coins!==fund.before[0].coins+fund.coins||balances[1].coins!==fund.before[1].coins-fund.coins)throw Error('Previous funding outcome still ambiguous');
  fund.status='CONFIRMED_BY_NATIVE_STORED_BALANCES';fund.after=balances;fund.evidence='both_native_stored_balances_match_exact_transfer_after_sessions_closed';prior.phase='FUNDING_RECONCILED_NOT_CREATED';fs.writeFileSync(base,JSON.stringify(prior,null,2));
 }
 const a=[];const row={at:Date.now(),build:h.build,guildName:'ExampleGuild',inviteName:'YouLater',phase:'STARTING',previousEvidence:prior?path.basename(base):null,actions:[]};
 const save=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(row,null,2));};save();
 const action=async(i,kind,payload)=>{const r={at:Date.now(),name:i.character.name,kind,payload,status:'STARTED'};row.actions.push(r);save();const sent=await i.socialSend(kind,payload);if(!sent?.ok){r.status='NOT_SENT';save();throw Error(kind+' not dispatched');}r.status='CLIENT_DISPATCHED';save();return r;};
 const flush=async i=>{const ok=await i.eval(`(async()=>{const n=window.AsteriaNet;if(!n?.isConnected?.()||n.pause||n.fixed||n.kicked)return false;n.handlers.resave();await n.flush();return n.isConnected()&&!n.pause&&!n.fixed&&!n.kicked;})()`);if(!ok)throw Error('Session unavailable before mutation');};
 const readSave=async i=>{const token=JSON.parse(fs.readFileSync(path.join(root,'profiles','slot-'+String(i.credentials.storageSlot??i.slot).padStart(2,'0'),'account.json'))).token;const r=await api.api('/api/save',{token});if(!r.ok||!r.json.save)throw Error('Native save unavailable');return r.json.save;};
 try{
  for(const name of (createOnly?['ExampleTankA']:['ExampleTankA','ExampleArcherA','ExampleHealA'])){const cred=team.find(m=>m.charName===name);if(!cred)throw Error('Registered character missing');const i=new GameInstance({root,slot:cred.slot,credentials:cred,cache,browserPool:pool,headless:true,noDraw:true,noGpu:true,noAudio:true,liteTextures:true,sceneSyncMs:1000,framesDir:null,autoChores:false,log:()=>{}});a.push(i);await i.start();await i.expeditionAuto(false);if(i.character.name!==name)throw Error('Character differs');await i.closeGamePanel();const home=await i.returnToTown();if(!home.ok||i.livePos.room!=='town')throw Error('Town not confirmed');await i.walkTo(160,7,{timeoutMs:60000,tolerance:2});await flush(i);}
  const [founder,donor]=a,cat=founder.catalog(),rules=cat.world.GUILD;if(rules.CREATE_COST!==30000||rules.CREATE_LV!==20)throw Error('Guild price/level differs');
  let guild=await founder.guildState();if(guild?.id&&guild.name!==row.guildName)throw Error('Founder already in another guild');
  if(!guild?.id){
   const initial=await Promise.all(a.map(readSave));if(initial[0].lv<20)throw Error('Founder level insufficient');
   const reserve=1500;for(const s of initial)if((s.potions||0)+['Orange Potion','Yellow Potion','White Potion'].reduce((n,k)=>n+(s.consumables?.[k]||0),0)<20)throw Error('Confirmed HP supplies insufficient');
   if(initial.reduce((n,s)=>n+Math.max(0,s.coins-reserve),0)<30000)throw Error('Combined team Copper insufficient after reserves');
   row.funding={receiver:founder.character.name,reserve,transfers:[],before:initial.map((s,n)=>({name:a[n].character.name,coins:s.coins}))};save();
   for(const donor of a.slice(1)){
    const pair=[founder,donor],before=await Promise.all(pair.map(readSave)),need=Math.max(0,30000+reserve-before[0].coins),amount=Math.min(need,Math.max(0,before[1].coins-reserve));if(!need)break;if(!amount)continue;
    for(const i of pair){const open=await i.socialLast('tropen'),done=await i.socialLast('trdone'),closed=await i.socialLast('trclosed');if(open&&done?.id!==open.id&&closed?.id!==open.id)throw Error('Existing trade session');}
    const fund={donor:donor.character.name,receiver:founder.character.name,coins:amount,before:before.map((s,n)=>({name:pair[n].character.name,coins:s.coins})),at:Date.now()};row.funding.transfers.push(fund);save();
    row.phase='FUNDING';save();await action(donor,'trq',{name:founder.character.name});
    const invite=await wait(async()=>{const x=await founder.socialLast('trinv');return x?.name===donor.character.name&&x._receivedAt>fund.at?x:null;},'registered trade invite');
    await action(founder,'trans',{from:invite.from,ok:true});
    const opens=await Promise.all(pair.map((i,n)=>wait(async()=>{const x=await i.socialLast('tropen');return x?.with?.name===pair[1-n].character.name&&x._receivedAt>fund.at?x:null;},'trade session')));if(opens[0].id!==opens[1].id)throw Error('Session IDs differ');const id=opens[0].id;fund.sessionId=id;save();
    for(const [i,n]of pair.map((i,n)=>[i,n]))await action(i,'troffer',{sq:1,gear:[],ids:[],stacks:[],coins:n===1?amount:0});
    for(const [i,n]of pair.map((i,n)=>[i,n]))await wait(async()=>{const s=await i.socialLast('trstate');return validState(s,id,amount,n===1)?s:null;},'exact coin offer');
    for(const i of pair)await action(i,'trlock',{});
    for(const [i,n]of pair.map((i,n)=>[i,n]))await wait(async()=>{const s=await i.socialLast('trstate');return validState(s,id,amount,n===1)&&s.me.locked&&s.them.locked?s:null;},'both locked');
    for(const i of pair)await action(i,'trconfirm',{});
    const receipts=await Promise.all(pair.map((i,n)=>wait(async()=>{const r=await i.socialLast('trdone');if(r?.id===id){fund.rawReceiptFields??={};fund.rawReceiptFields[i.character.name]={id:r.id,with:typeof r.with==='string'?r.with:null,rev:r.rev,gave:receiptSide(r.gave),got:receiptSide(r.got),at:r._receivedAt};save();}return validReceipt(r,id,pair[1-n].character.name,amount,n===1)?r:null;},'matching coin receipt')));fund.receipts=receipts.map(r=>({id:r.id,with:r.with,gave:r.gave,got:r.got,rev:r.rev,at:r._receivedAt}));
    const after=await wait(async()=>{await Promise.all(pair.map(flush));const s=await Promise.all(pair.map(readSave));return s[0].coins===before[0].coins+amount&&s[1].coins===before[1].coins-amount?s:null;},'both stored coin balances');fund.after=after.map((s,n)=>({name:pair[n].character.name,coins:s.coins}));fund.status='CONFIRMED';save();
   }
   await flush(founder);const current=await readSave(founder);if(current.coins<30000+reserve||(await api.health()).build!==h.build)throw Error('Creation budget/build changed');
   row.phase='CREATING';row.creationBefore=current.coins;save();const sent=await action(founder,'gcreate',{name:row.guildName});
   guild=await wait(async()=>{const g=await founder.guildState(),created=await founder.socialLast('gcreated');return g?.id&&g.name===row.guildName&&g._receivedAt>=sent.at&&created?g:null;},'new guild');
   await flush(founder);const after=await readSave(founder);if(after.coins!==current.coins-30000)throw Error('Founding fee not verified');row.creationAfter=after.coins;row.creationStatus='CONFIRMED';save();
  }
  row.guild={id:guild.id,name:guild.name,members:(guild.members||[]).map(m=>m.name),checkedAt:guild._receivedAt};
  if(!(guild.members||[]).some(m=>m.name===row.inviteName)){await flush(founder);row.phase='INVITING';save();await action(founder,'ginv',{name:row.inviteName});await sleep(2000);row.inviteStatus='CLIENT_DISPATCHED_AWAITING_ACCEPTANCE';}else row.inviteStatus='ALREADY_MEMBER';
  row.phase='COMPLETE';row.finishedAt=Date.now();save();console.log(JSON.stringify({phase:row.phase,guild:row.guild,transfers:row.funding?.transfers?.map(f=>({donor:f.donor,coins:f.coins,status:f.status})),creationStatus:row.creationStatus,inviteStatus:row.inviteStatus}));
 }catch(e){row.diagnostics=[];for(const i of a){try{const sys=await i.socialFrames('sys',row.at),inv=await i.socialLast('trinv'),screen=await i.screen();row.diagnostics.push({name:i.character?.name,position:i.livePos,death:screen.death,sys:sys.map(m=>({text:m.text})),invite:inv?{name:inv.name,from:inv.from,at:inv._receivedAt}:null});}catch{}}row.phase='STOPPED_NO_REPLAY';row.reason=e.message;row.finishedAt=Date.now();save();throw e;}
 finally{for(const i of a)await i.stop().catch(()=>{});await pool.shutdown().catch(()=>{});}
}
module.exports={exact,validState,validReceipt};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
