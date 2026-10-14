'use strict';
const fs=require('node:fs'),path=require('node:path'),{select}=require('./activity-cohort');
function reconcile(d,sources,activity,build,{tradeActive=false}={}){
 const now=d.now(),controls=d.reloadControls(activity),request=controls.request,manual=request&&['PENDING','WAITING'].includes(request.status)&&request.expiresAt>now&&request.build===build;
 const terminal=['IDLE','COMPLETE','FINISHED','WITHDRAWN'].includes(activity.state.phase),day=new Date(now+7*3600000).toISOString().slice(0,10);
 d.saved.runs ||= [];
 if(activity.state.id&&terminal&&activity.state.phase!=='IDLE'&&!d.saved.runs.some(r=>r.id===activity.state.id)){d.saved.runs.push({id:activity.state.id,kind:activity.state.kind,day:activity.state.day||day,build:activity.state.build,runId:activity.state.runId,at:now,phase:activity.state.phase,cleared:activity.state.phase==='COMPLETE'&&activity.state.evidence==='participant_server_completion_rewards',participants:activity.state.participants||[],evidence:activity.state.evidence||null});d.saved.runs=d.saved.runs.slice(-120);}
 let reason='ทำงานพัฒนาต่อระหว่างรอกลุ่มพร้อม',selection=null,next=null;
 if(!terminal)reason='กำลังทำ '+activity.state.kind+' · '+activity.state.phase;
 else if(tradeActive)reason='รอเทรดที่เปิดแล้วจบ · ไม่แย่งเจ้าของงาน';
 else if(controls.autoEnabled||manual)for(const kind of manual?[request.kind]:d.policy.activities){const retry=require('./activity-retry').retry(d.saved.runs,{kind,build,day,now,manual});if(!retry.allowed){reason=retry.reason;continue;}selection=select(d.root,d.config,sources,build,kind,now,d.policy.minimumReadyMembers||3);reason=selection.reason;if(selection.ready){next=kind;break;}}
 else reason='พักกิจกรรมทีมตามคำสั่ง · ทำงานส่วนตัวต่อ';
 const quotas=[];for(const s of sources)for(const m of s.members||[]){if(!d.config.members.some(r=>r.machine===s.machine&&r.slot===m.slot&&r.charName===m.charName))continue;const known=x=>x?.build===build&&Number.isFinite(x.at)&&now>=x.at&&now-x.at<45000;quotas.push({name:m.charName,machine:s.machine,guild:{known:known(m.activityState?.gd),left:known(m.activityState?.gd)?m.activityState.gd.left:null},tower:{known:known(m.activityState?.tw),left:known(m.activityState?.tw)?m.activityState.tw.left:null}});}
 if(next&&activity.begin(next,build,{enabled:true,day,requestId:manual?request.id:null,participants:selection.members,leader:selection.leader,cohortRevision:selection.revision})){if(manual)require('./activity-control').acknowledge(d.root,request.id,'STARTED',reason,now);}
 else if(manual)require('./activity-control').acknowledge(d.root,request.id,'WAITING',reason,now);
 else if(request&&['PENDING','WAITING'].includes(request.status))require('./activity-control').acknowledge(d.root,request.id,request.build!==build?'CANCELLED':'EXPIRED','Request build or deadline changed; resume personal progression',now);
 else if(request?.status==='STARTED'&&request.id===activity.state.requestId&&terminal)require('./activity-control').acknowledge(d.root,request.id,activity.state.phase==='COMPLETE'?'COMPLETE':'FINISHED',activity.state.reason||activity.state.phase,now);
 d.view={version:2,at:now,day,build,enabled:controls.autoEnabled,required:activity.state.participants?.length||selection?.members.length||null,participants:activity.state.participants||[],cohortRevision:activity.state.cohortRevision||null,reason,quotas,controls:require('./activity-control').state(d.root,d.policy,now),workflow:activity.view(),quotaComplete:quotas.length>0&&quotas.every(q=>q.guild.known&&q.tower.known&&q.guild.left===0&&q.tower.left===0),cleared:{guild:false,tower:false}};
 d.view.runs=d.saved.runs.filter(r=>r.day===day&&r.build===build);d.view.retry=Object.fromEntries((d.policy.activities||[]).map(kind=>[kind,require('./activity-retry').retry(d.saved.runs,{kind,build,day,now})]));d.view.cleared={guild:d.view.runs.some(r=>r.kind==='guild'&&r.cleared),tower:d.view.runs.some(r=>r.kind==='tower'&&r.cleared)};
 d.view.workPolicy=require('./daily-work-policy').dailyWorkPolicy(d.view,activity.state,build,now);d.saved.view=d.view;fs.mkdirSync(path.dirname(d.file),{recursive:true});fs.writeFileSync(d.file+'.tmp',JSON.stringify(d.saved));fs.renameSync(d.file+'.tmp',d.file);return d.view;
}
module.exports={reconcile};
