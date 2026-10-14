'use strict';
const fs=require('fs'),path=require('path'),{fresh}=require('./team-workboard');
const terminal=p=>['IDLE','COMPLETE','FINISHED','WITHDRAWN'].includes(p);
class DailyActivities{
 constructor(root,config,{now=Date.now}={}){this.root=root;this.config=config;this.now=now;this.file=path.join(root,'logs/fleet/daily-activities.json');try{this.saved=JSON.parse(fs.readFileSync(this.file));}catch{this.saved={runs:[]};}try{this.policy=JSON.parse(fs.readFileSync(path.join(root,'machines/daily-team-activities.json')));}catch{this.policy={enabled:false};}}
 reloadControls(activity){try{this.policy=JSON.parse(fs.readFileSync(path.join(this.root,'machines/daily-team-activities.json')));}catch{this.policy={enabled:false};}const control=require('./activity-control');this.controls=control.state(this.root,this.policy,this.now());this.policy.enabled=this.controls.autoEnabled;if(activity)control.pauseUnopened(activity,this.controls);return this.controls;}
 gate(build,{manual=false,kind='tower'}={}){const proof=require('../knowledge/adapter-source').inspect(this.root,build,kind==='rift'?'activity':'daily-activity');return {allowed:(manual||this.policy.enabled===true)&&(require('../registry/registry').policy(this.root).dynamicActivities===true||this.policy.requiredMembers===6&&this.config.members.length===6)&&proof.allowed,reason:!manual&&!this.policy.enabled?'พักกิจกรรมทีม · ฟาร์มเลเวลและไอเทมส่วนตัวต่อ':proof.allowed?'ตรวจสมาชิกและโควต้าสดก่อนรวมทีม':'ต้องตรวจคำสั่งกิจกรรมของเกม build นี้',proof};}
 reconcile(sources,activity,build,{tradeActive=false}={}){
  if(require('../registry/registry').policy(this.root).dynamicActivities===true)return require('./dynamic-daily-activities').reconcile(this,sources,activity,build,{tradeActive});
  const now=this.now(),controls=this.reloadControls(activity),request=controls.request,manual=!!request&&['PENDING','WAITING'].includes(request.status)&&request.expiresAt>now&&request.build===build,gate=this.gate(build,{manual,kind:request?.kind}),rows=this.config.members.map(r=>{const s=sources.find(s=>s.machine===r.machine),m=s?.members?.find(m=>m.charName===r.charName&&m.slot===r.slot),online=s?.build===build&&fresh(s.at,15000,now)&&m?.status==='playing'&&!m.recycling&&fresh(m.lastSaveAt,30000,now);return {...r,online,lv:m?.lv,sourceBuild:s?.build||null,states:m?.activityState||{},result:m?.activityResult};});
  const day=new Date(now+7*3600000).toISOString().slice(0,10);
  if(activity.state.id&&['COMPLETE','FINISHED','WITHDRAWN'].includes(activity.state.phase)&&!this.saved.runs.some(r=>r.id===activity.state.id)){this.saved.runs.push({id:activity.state.id,kind:activity.state.kind,day:activity.state.day||day,build:activity.state.build,at:now,phase:activity.state.phase,runId:activity.state.runId,from:activity.state.from,cleared:activity.state.phase==='COMPLETE',results:rows.map(r=>({name:r.charName,result:r.result?.runId===activity.state.runId?r.result:null}))});this.saved.runs=this.saved.runs.slice(-120);}
  const quotas=rows.map(r=>({name:r.charName,machine:r.machine,online:r.online,...Object.fromEntries(['guild','tower'].map(kind=>{const s=r.states[kind==='guild'?'gd':'tw'],valid=s?.build===build&&fresh(s.at,45000,now);return [kind,{known:valid,left:valid?s.left:null,guildLeft:valid?s.guildLeft:null,at:s?.at||null}];}))}));
  let next=null,reason=gate.reason;const blocks=[];const mismatches=rows.filter(r=>r.sourceBuild&&r.sourceBuild!==build);const party=sources.map(s=>s.party).find(p=>p?.leader===this.config.leader&&fresh(p.checkedAt,30000,now));const partyReady=!!party&&rows.every(r=>party.members.includes(r.charName)&&sources.find(s=>s.machine===r.machine)?.members.find(m=>m.charName===r.charName)?.teamPartyId===party.id);
  if(!gate.allowed)reason='กิจกรรมประจำวันยังเปิดไม่ได้: '+reason;
  else if(!terminal(activity.state.phase))reason='กำลังทำ '+activity.state.kind+' · '+activity.state.phase;
  else if(tradeActive)reason='รอเทรดที่เปิดแล้วจบ ก่อนรับงานประจำวัน';
  else if(mismatches.length)reason='เกมคนละรุ่น: '+[...new Set(rows.map(r=>r.machine+'='+r.sourceBuild))].join(' · ')+' ต้องโหลด release เดียวกัน';
  else if(rows.some(r=>!r.online))reason='งานประจำวันรอทั้ง 6 คนออนไลน์ ข้อมูลสดและ build ตรงกัน';
  else if(!partyReady)reason='รอปาร์ตี้หัวหน้าและการยืนยันสมาชิกครบ 6 จากข้อมูลสด';
  else for(const kind of manual?[request.kind]:this.policy.activities){const type=kind==='guild'?'gd':kind==='rift'?'dg':'tw',states=rows.map(r=>r.states[type]);
   const retry=require('./activity-retry').retry(this.saved.runs,{kind,build,day,now,manual});if(!retry.allowed){blocks.push(kind+': '+retry.reason);continue;}
   if(states.some(s=>!s||s.build!==build||!fresh(s.at,45000,now)||!Number.isInteger(s.left)||s.left<0)){blocks.push(kind+': รอโควต้าสดของทั้ง 6');continue;}
   if(states.some(s=>s.run&&!s.run.done)){blocks.push(kind+': มี run เดิม ต้องกระทบยอดก่อนเปิด');continue;}
   if(kind==='rift'&&states.some(s=>s.open!==true)){blocks.push('rift: เซิร์ฟเวอร์ยังไม่เปิด Eclipse Rift · ฟาร์มต่อระหว่างรอ');continue;}
   if(states.some((s,n)=>!Number.isInteger(s.minLv)||s.minLv<1||!Number.isInteger(rows[n].lv)||rows[n].lv<s.minLv)){blocks.push(kind+': เลเวลยังไม่ถึงเงื่อนไขหรือรอข้อมูลเลเวลจากเซิร์ฟเวอร์ · เก็บเลเวลต่อก่อนรวมทีม');continue;}
   if(states.every(s=>s.left===0)){if(manual)blocks.push(kind+': โควต้าของทั้งทีมหมดแล้ว · ฟาร์มต่อ');continue;}
   if(states.some(s=>s.left===0)){blocks.push(kind+': โควต้าสมาชิกไม่เท่ากัน ลงครบ 6 ไม่ได้ ห้ามเปิดเดี่ยว');continue;}
   if(kind==='guild'){const leader=rows.find(r=>r.charName===this.config.leader)?.states.gd;if(!(leader.guildLeft>0)||!['leader','officer'].includes(leader.rank)||!leader.guildId||states.some(s=>s.guildId!==leader.guildId)){blocks.push('guild: กิลด์/สิทธิ์เปิด/รอบของกิลด์ไม่พร้อม');continue;}}
   next=kind;reason=(manual?'ระดมพลตามปุ่ม: ':'งานบังคับวันนี้: ')+(kind==='guild'?'ดันกิลด์':kind==='rift'?'Eclipse Rift':'หอคอย เป้าหมายชั้น 100')+' พร้อมตรวจรวมทีม';break;
  }
  const quotaComplete=quotas.every(q=>q.guild.known&&q.tower.known&&q.guild.left===0&&q.tower.left===0),runs=this.saved.runs.filter(r=>r.day===day&&r.build===build),cleared={guild:runs.some(r=>r.kind==='guild'&&r.cleared),tower:runs.some(r=>r.kind==='tower'&&r.cleared)};
  if(gate.allowed&&quotaComplete&&terminal(activity.state.phase)&&!manual){reason=cleared.guild&&cleared.tower?'ใช้โควต้าวันนี้ครบและมีหลักฐานผ่านทั้งสองกิจกรรม':'ใช้โควต้าหมดแล้ว แต่ยังไม่มีหลักฐานผ่านครบทั้งสองกิจกรรม';}
  else if(!next&&terminal(activity.state.phase)&&blocks.length)reason=blocks.join(' · ');
  const retry=Object.fromEntries((this.policy.activities||[]).map(kind=>[kind,require('./activity-retry').retry(this.saved.runs,{kind,build,day,now})]));
  const quotasKnown=quotas.every(q=>q.guild.known&&q.tower.known&&Number.isInteger(q.guild.left)&&q.guild.left>=0&&Number.isInteger(q.tower.left)&&q.tower.left>=0),leaderQuota=quotas.find(q=>q.name===this.config.leader)?.guild;
  const blockedUntilReset=quotasKnown&&!quotaComplete&&(quotas.some(q=>q.guild.left===0)||leaderQuota?.guildLeft===0)&&quotas.some(q=>q.tower.left===0);
  if(blockedUntilReset&&terminal(activity.state.phase))reason=reason+' · โควต้าปัจจุบันลงครบ6ไม่ได้ รอสิทธิ์รีเซ็ตจากเซิร์ฟเวอร์; ทำงานพัฒนาอื่นต่อ';
  if(!terminal(activity.state.phase))reason='กำลังทำ '+activity.state.kind+' · '+activity.state.phase+(!this.policy.enabled?' · จบรอบนี้แล้วกลับฟาร์ม':'');
  this.view={version:1,revision:'operator-rally-2026-10-03',at:now,day,build,enabled:this.policy.enabled===true,required:6,goalFloor:100,next,quotaComplete,blockedUntilReset,cleared,quotas,runs,retry,reason,blocks,controls,workflow:activity.view()};
  if(next&&activity.begin(next,build,{enabled:true,day,from:1,requestId:manual?request.id:null})){this.view.next=null;this.view.phase=activity.state.phase;this.view.workflow=activity.view();if(manual)require('./activity-control').acknowledge(this.root,request.id,'STARTED','รวมทีมผ่านเงื่อนไขเบื้องต้น · ตรวจยา/HP/MPก่อนเปิดจริง',now);}
  else if(request&&['PENDING','WAITING'].includes(request.status)){require('./activity-control').acknowledge(this.root,request.id,request.build!==build?'CANCELLED':request.expiresAt<=now?'EXPIRED':'WAITING',request.build!==build?'เกมเปลี่ยน build · กดระดมพลใหม่เมื่อข้อมูลตรงกัน':request.expiresAt<=now?'รอเกิน10นาที · ยกเลิกการเรียกและฟาร์มต่อ':reason+' · ฟาร์มส่วนตัวต่อระหว่างรอ',now);}
  else if(request?.status==='STARTED'&&activity.state.requestId===request.id&&terminal(activity.state.phase))require('./activity-control').acknowledge(this.root,request.id,activity.state.phase==='COMPLETE'?'COMPLETE':'FINISHED',activity.state.reason||activity.state.phase,now);
  this.view.controls=require('./activity-control').state(this.root,this.policy,now);
  this.view.workPolicy=require('./daily-work-policy').dailyWorkPolicy(this.view,activity.state,build,now);
  this.saved.view=this.view;fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.saved));fs.renameSync(this.file+'.tmp',this.file);
  return this.view;
 }
}
module.exports={DailyActivities,terminal};
