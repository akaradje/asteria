'use strict';
// Dashboard projection only; raw runtime journals and learning remain untouched.
const fs=require('fs'),path=require('path'),model=require('./adaptive-model');
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const text=v=>typeof v==='string'?v.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+|(?:password|token|secret|cookie|authorization)\s*[:=]\s*\S+/gi,'[redacted]').slice(0,240):null;
const fresh=(at,now,ttl=60000)=>number(at)!==null&&at<=now&&now-at<=ttl;
function project(m,now){
 const d=m.details||{},p=d.levelProgress||{},r=p.trainingRoute||{},e=r.routeEvidence||{},co=d.runtimeV2?.sourceCoherence;
 const coherent=co?.matches===true&&fresh(co.at,now)&&typeof co.loadedBuild==='string'&&co.loadedBuild===co.liveBuild;
 const build=typeof r.build==='string'?r.build:null;
 const buildMatches=coherent&&build&&(build===co.loadedBuild||build.startsWith(co.loadedBuild+'-'));
 const blockers=[];
 if(m.online!==true||m.detailsFresh!==true)blockers.push('สถานะตัวละครหรือ snapshot ยังไม่สด');
 if(!fresh(d.lastSaveAt,now,30000))blockers.push('เซฟเกิน 30 วินาทีหรือไม่มีเวลาเซฟ');
 if(!fresh(r.at,now))blockers.push('เหตุผลเลือกเส้นทางเกิน 60 วินาทีหรือยังไม่มี');
 if(!fresh(e.at,now))blockers.push('ผลวัดเส้นทางเกิน 60 วินาทีหรือยังไม่มี');
 if(!r.selected||e.route!==r.selected)blockers.push('ผลวัดไม่ตรงเป้าหมายที่เลือก');
 if(!p.build||!build||!(build===p.build||build.startsWith(p.build+'-'))||p.lv!==d.lv)blockers.push('รุ่น/เลเวลของผลวัดไม่ตรงตัวละคร');
 if(co&&(!buildMatches||p.build!==co.loadedBuild))blockers.push('หลักฐานรุ่นที่โหลดกับรุ่นปัจจุบันไม่ตรงหรือไม่สด');
 // Remote public snapshots may omit source proof. Their observations can be
 // charted with an explicit unverified label, never authorized as decisions.
 const valid=blockers.length===0;
 const ledgerAvailable=Array.isArray(d.runtimeV2?.purchases),purchases=ledgerAvailable?d.runtimeV2.purchases:[];
 const pending=ledgerAvailable?purchases.some(x=>['STARTED','WAITING_CONFIRMATION','UNCERTAIN','DISPATCHING'].includes(x.status)):null;
 const rate=valid&&e.confidence==='observational'&&e.samples>=10&&e.ms>=300000&&e.knownMs>=0&&e.knownMs<=e.ms&&e.knownMs/e.ms>=.9&&number(e.netExp)!==null?e.netExp*3600000/e.ms:null;
 // No exact equipment context or full candidate pool is published by this feed.
 // Do not manufacture a safe recommendation from a single aggregate.
 const shadow=model.assess(r.selected?[{id:text(r.selected),context:null,at:e.at,coherent:!!buildMatches,pending,safe:null,ms:e.ms,knownMs:e.knownMs,samples:e.samples,netExp:e.netExp,deaths:e.deaths,expLossEvents:e.expLossEvents}]:[],null,now);
 return {key:text(m.key),name:text(m.charName),machine:text(m.machine),online:m.online===true,lv:number(d.lv),job:text(d.job||m.job),map:text(d.livePos?.room||m.map||m.goal?.mapId),build:text(build),saveAt:number(d.lastSaveAt),at:number(e.at),decisionAt:number(r.at),fresh:valid,
  route:text(r.selected),reason:text(r.reason),rate,fieldPct:valid?number(e.fieldPct):null,fps:m.online===true&&m.detailsFresh===true&&fresh(d.fpsAt,now,15000)?number(d.fps):null,
  coveragePct:valid?number(e.coveragePct):null,measuredRoutes:number(r.measuredRoutes),eligibleRoutes:number(r.eligibleRoutes),
  cost:valid?Object.fromEntries(['fieldMs','townMs','travelMs','recoveryMs','unconfirmedMs','ms','knownMs'].map(k=>[k,number(e[k])])):null,
  pending,ledgerAvailable,blockers,incidents:(d.runtimeV3?.incidents?.open||[]).map(r=>({reason:text(r.reason),remedy:text(r.remedy),deadline:number(r.deadline)})),progression:d.runtimeV3?.progression||null,sourceVerified:!!buildMatches,shadow,verification:'observed_client_data_not_server_receipt',
  purchases:purchases.slice(0,8).map(x=>({id:text(x.id),at:number(x.observedAt)||number(x.at),status:['CONFIRMED','UNCERTAIN','WAITING_CONFIRMATION','CANCELLED','STARTED'].includes(x.status)?x.status:'UNKNOWN',item:text(x.target?.item),evidence:x.evidence==='outgoing_client_save'?'outgoing_client_save':'other_or_unknown'})),
  trial:r.lastResult?{at:number(r.lastResult.at),accepted:r.lastResult.accepted===true,baselineRate:number(r.lastResult.baselineRate),candidateRate:number(r.lastResult.candidateRate),coveragePct:number(r.lastResult.coveragePct)}:null};
}
class Store{
 constructor(file){this.file=file;this.rows={};this.lastWrite=0;this.writeError=false;try{const d=JSON.parse(fs.readFileSync(file,'utf8'));if(d.version===1)this.rows=d.rows||{};}catch{}}
 observe(members,now=Date.now()){
  const view=[];
  for(const m of members){if(!['windows','tum','vps'].includes(m.machine)||typeof m.key!=='string')continue;
   const p=project(m,now);let h=this.rows[p.key];
   if(!h||h.name!==p.name)h=this.rows[p.key]={name:p.name,points:[],events:[],lastDecision:null,lastTrial:null};
   // Chart history samples the feed, never treats repeated saves as new evidence.
   const last=h.points.at(-1),sampleId=p.fresh&&p.rate!==null?p.at:null;
   if((sampleId&&(!last||last.sourceAt===null||sampleId>last.sourceAt||last.build!==p.build))||(!sampleId&&last?.rate!==null)){
    h.points.push({at:now,sourceAt:sampleId,build:p.build,route:p.route,rate:p.rate,fps:p.fps,fieldPct:p.fieldPct});
   }
   if(m.detailsFresh===true&&fresh(p.decisionAt,now)&&p.reason){const signature=JSON.stringify([p.build,p.route,p.reason]);if(h.lastDecision!==signature){h.events.push({at:p.decisionAt,kind:'decision',route:p.route,reason:p.reason,build:p.build});h.lastDecision=signature;}}
   if(p.fresh&&p.trial?.at&&p.trial.at!==h.lastTrial){h.events.push({at:p.trial.at,kind:'trial',reason:p.trial.accepted?'governor รายงานรับผลทดลอง; ไม่ใช่หลักฐานเหตุและผล':'governor รายงานไม่รับผลทดลอง',build:p.build});h.lastTrial=p.trial.at;}
   h.points=h.points.filter(x=>fresh(x.at,now,7200000)).slice(-240);h.events=h.events.filter(x=>fresh(x.at,now,86400000)).slice(-60);
   view.push({...p,points:h.points,events:h.events.slice(-15).reverse()});
  }
  const allowed=new Set(view.map(x=>x.key));this.rows=Object.fromEntries(Object.entries(this.rows).filter(([k])=>allowed.has(k)));
  if(now-this.lastWrite>=15000){try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,rows:this.rows}));fs.renameSync(this.file+'.tmp',this.file);this.lastWrite=now;this.writeError=false;}catch{this.writeError=true;}}
  return {version:1,at:now,mode:'read_only_shadow',authorizesActions:false,collection:'dashboard_requests_only_gaps_are_unknown',historyPersisted:!this.writeError,members:view};
 }
}
let store;
function observe(members,now){store ||=new Store(path.resolve(__dirname,'../../logs/adaptive-lab/history.json'));return store.observe(members,now);}
module.exports={project,Store,observe};
