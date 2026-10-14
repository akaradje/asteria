'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fresh=(at,ms,now)=>Number.isFinite(at)&&now>=at&&now-at<ms;
function limits(root,build,kind){
 const type=kind==='guild'?'guild':kind==='tower'?'daily-activity':'activity',proof=require('../knowledge/adapter-source').inspect(root,build,type);
 if(!proof.allowed)return {known:false,reason:'native activity adapter requires review'};
 const text=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
 if(kind==='guild'&&text.includes('ชวนสมาชิกลงได้ถึง 12 คน'))return {known:true,max:12,proof:proof.fingerprint,evidence:'reviewed_native_guild_capacity',minimumBasis:'conservative_operator_cohort'};
 const section=kind==='tower'?text.slice(text.indexOf('Tower of Asteria (server/tower.js'),text.indexOf('Tower of Asteria (server/tower.js')+15000):text.slice(text.indexOf('dg-facts')-100,text.indexOf('dg-facts')+1000);
 return section.includes('<b>1–6</b>')?{known:true,min:1,max:6,proof:proof.fingerprint,evidence:'reviewed_native_activity_capacity'}:{known:false,reason:'capacity not observed in current native source'};
}
function select(root,config,sources,build,kind,now=Date.now(),minimum=3){
 const cap=limits(root,build,kind),type=kind==='guild'?'gd':kind==='tower'?'tw':'dg',allowed=new Map(config.members.map(r=>[r.machine+':'+r.slot,r]));
 const ready=[];
 for(const s of sources){if(s?.build!==build||!fresh(s.at,15000,now))continue;
  for(const m of s.members||[]){const assigned=allowed.get(s.machine+':'+m.slot),a=m.activityState?.[type];
   if(!assigned||assigned.charName!==m.charName||m.status!=='playing'||m.recycling||!fresh(m.lastSaveAt,30000,now)||!m.identity?.actorId||!a||a.build!==build||!fresh(a.at,45000,now)||!Number.isInteger(a.left)||a.left<1||!Number.isInteger(a.minLv)||m.lv<a.minLv||a.run&&!a.run.done||kind==='rift'&&!a.open)continue;
   ready.push({...assigned,actorId:m.identity.actorId,policyRevision:m.identity.policyRevision,epoch:m.identity.epoch,realm:m.identity.realm,party:s.party,native:m});
  }
 }
 if(!cap.known)return {ready:false,reason:cap.reason,members:[],cap};
 let candidates=[],leader=null;
 if(kind==='guild'){
  const owners=ready.filter(m=>['leader','officer'].includes(m.native.activityState.gd.rank)&&m.native.activityState.gd.guildLeft>0).sort((a,b)=>(a.charName===config.leader?-1:0)-(b.charName===config.leader?-1:0));
  for(const owner of owners){const group=ready.filter(m=>m.native.activityState.gd.guildId===owner.native.activityState.gd.guildId&&m.realm===owner.realm&&m.epoch===owner.epoch);if(group.length>=minimum){candidates=group;leader=owner.charName;break;}}
 }else{
  for(const party of sources.map(s=>s.party).filter(p=>p&&fresh(p.checkedAt,30000,now))){const group=ready.filter(m=>m.native.teamPartyId===party.id&&party.members.includes(m.charName));if(group.some(m=>m.charName===party.leader)&&group.length>=minimum){candidates=group;leader=party.leader;break;}}
 }
 const members=candidates.slice(0,cap.max).map(({native,party,...m})=>m);
 if(!leader||members.length<minimum||!members.some(m=>m.charName===leader))return {ready:false,reason:'รอกลุ่มที่มีตัวตน โควต้า และหัวหน้าจาก native พร้อม · ตัวอื่นพัฒนาต่อ',members:[],cap};
 const revision=crypto.createHash('sha256').update(JSON.stringify([build,kind,leader,members.map(m=>[m.actorId,m.machine,m.slot,m.policyRevision])])).digest('hex');
 return {ready:true,members,leader,revision,cap,reason:'กลุ่ม '+members.length+' คนพร้อมตามข้อมูลจริง ไม่รอเครื่องที่ปิด'};
}
module.exports={limits,select};
