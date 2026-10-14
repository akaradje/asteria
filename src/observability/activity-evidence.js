'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const cleanMap=o=>Object.fromEntries(Object.entries(o||{}).filter(([k,v])=>k.length<=100&&Number.isFinite(v)&&v>=0).slice(0,200));
class ActivityEvidence{
 constructor(root,identity,{now=Date.now}={}){this.now=now;this.file=path.join(root,'logs','activity-evidence',crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0,24)+'.json');try{this.data=JSON.parse(fs.readFileSync(this.file));if(!Array.isArray(this.data.rows)||!this.data.runs)throw Error('Invalid activity evidence');}catch(e){if(e.code!=='ENOENT')throw Error('Activity evidence unreadable; preserve original and reconcile');this.data={version:1,rows:[],runs:{}};}this.latest={};this.monsters=new Map();this.hits=new Map();}
 persist(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 receive(payload,build,room,depth=0){if(typeof payload==='string'){if(payload.length>200000)return;try{payload=JSON.parse(payload);}catch{return;}}const m=payload;if(!m||depth>3||!build)return;if(m.t==='b'&&Array.isArray(m.l)){for(const x of m.l.slice(0,1000))this.receive(x,build,room,depth+1);return;}
 const at=this.now();if(m.t==='welcome'){this.id=m.id;this.monsters.clear();this.hits.clear();this.latest={};return;}
 if(m.t==='mons'){this.monsters.clear();this.hits.clear();for(const x of (m.list||[]).slice(0,500))this.monsters.set(x.n,x.id);}
 if(m.t==='mspawn'){this.monsters.set(m.m?.n,m.m?.id);this.hits.delete(m.m?.n);}
 if(m.t==='mgone'){this.monsters.delete(m.n);this.hits.delete(m.n);}
 if(m.t==='dmgs'&&this.id!=null)for(const hit of (m.l||[]).slice(0,1000))if(Array.isArray(hit)&&String(hit[2])===String(this.id)&&hit[1]>0)this.hits.set(hit[0],at);
 if(['bossboard','wb','wbme','tw','dg','gd','guild','gw','wm','trinv','tropen','trstate','trclosed','trdone'].includes(m.t))this.latest[m.t]={at,build,state:m};
 const entered={twenter:'tower',dgenter:/^gd/.test(room||'')||m.guild?'guild':'dungeon'}[m.t];
 if(entered){this.data.runs[entered]={build,at,room:m.room||room,runId:m.id||m.run?.id||(this.latest[entered==='tower'?'tw':entered==='guild'?'gd':'dg']?.build===build&&at-this.latest[entered==='tower'?'tw':entered==='guild'?'gd':'dg'].at<45000?this.latest[entered==='tower'?'tw':entered==='guild'?'gd':'dg'].state.run?.id:null)||null};this.persist();}
 let activity={wbreward:'boss',twreward:'tower',dgreward:'dungeon',pvend:'guild-war',bloot:'boss',kill:'combat',twend:'tower',dgend:'dungeon'}[m.t];if(!activity)return;
 if(['dgreward','dgend'].includes(m.t)){const guild=this.data.runs.guild,dungeon=this.data.runs.dungeon;if(guild?.build===build&&(!dungeon||guild.at>=dungeon.at)&&(!m.runId||m.runId===guild.runId))activity='guild';}
 // mdie alone and inventory gains alone never certify a personal kill or reward.
 const loot=['wbreward','twreward','dgreward','bloot','kill'].includes(m.t),run=this.data.runs[activity],id=m.id||this.monsters.get(m.n)||null;
 const stateRun=this.latest[activity==='tower'?'tw':activity==='guild'?'gd':'dg']?.state?.run;
 const row={at,build,room,activity,type:m.t,monster:id,runId:m.runId||stateRun?.id||run?.runId||null,elapsedMs:run?.build===build?Math.max(0,at-run.at):null,evidence:'server_frame_received',reward:loot?{coins:Number.isFinite(m.coins)?m.coins:null,dust:Number.isFinite(m.dust)?m.dust:null,materials:cleanMap(m.mats),keys:cleanMap(m.keys),consumables:cleanMap(m.cons),tier:m.t==='wbreward'?m.tier:null}:null,rank:Number.isFinite(m.rank)?m.rank:null,contributionPct:Number.isFinite(m.pct)?m.pct:null,killed:m.killed===true,full:m.full===true,floor:Number.isInteger(m.floor)?m.floor:null,quit:!!m.quit,lost:!!m.lost,personalDamageObserved:m.n!=null&&at-(this.hits.get(m.n)||0)<120000};
 // Reward authorization and completion remain separate (bosses may reward an escape).
 row.completed=m.t==='wbreward'?m.killed===true:m.t==='dgreward'?m.full===true:m.t==='twreward'?m.floor===100:false;
 // Identical payloads are not identical events. Deduplicate only an explicit native event ID.
 const nativeEventId=typeof m.eventId==='string'&&m.eventId.length<=100?m.eventId:null;
 this.eventSession ||=crypto.randomUUID();this.eventSequence=(this.eventSequence||0)+1;
 row.id=crypto.createHash('sha256').update(JSON.stringify([build,m.t,nativeEventId||this.eventSession+':'+this.eventSequence])).digest('hex').slice(0,24);
 row.uniqueness=nativeEventId?'native_event_id':'local_receipt_sequence_not_verified_unique';
 if(this.data.rows.some(r=>r.id===row.id))return;this.data.rows.unshift(row);this.data.rows=this.data.rows.slice(0,300);this.persist();
 }
 mastery(build){const out={};for(const r of this.data.rows){if(r.build!==build||!r.completed)continue;if(r.activity==='boss'&&!out.boss)out.boss={build,confirmed:true,at:r.at,evidence:r.evidence,id:r.id};}return out;}
 view(build){const tradeFrames=Object.fromEntries(Object.entries(this.latest).filter(([k])=>k.startsWith('tr')).map(([k,v])=>[k,{at:v.at,id:v.state.id??null,idType:typeof v.state.id,with:typeof v.state.with==='string'?v.state.with:v.state.with?.name,rev:v.state.rev??null}]));const boss=this.latest.bossboard;const bossShape=boss?{at:boss.at,now:boss.state.now,list:(boss.state.list||[]).slice(0,100).map(b=>({id:typeof b.id==='string'?b.id:null,map:typeof b.map==='string'?b.map:null,upType:typeof b.up,up:!!b.up,nextType:typeof b.next,next:Number.isFinite(b.next)?b.next:null}))}:null;return {bossShape,tradeFrames,at:this.now(),build,rows:this.data.rows.filter(r=>r.build===build).slice(0,12),latest:Object.fromEntries(Object.entries(this.latest).map(([k,v])=>[k,{at:v.at,build:v.build}])),limits:'Server reward authorization; inventory application is checked separately. No party completion inferred from a personal reward.'};}
}
module.exports={ActivityEvidence};
