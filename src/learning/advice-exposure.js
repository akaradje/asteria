'use strict';
const crypto=require('node:crypto');
const HOUR=3600000;
function key(action,p){return crypto.createHash('sha256').update(JSON.stringify([action,p.actorId,p.build,p.evidenceIds])).digest('hex');}
function policy(data,now){const d=data.adviceExposure ||= {version:1,samples:[],failed:{}};if(d.version!==1||!Array.isArray(d.samples)||typeof d.failed!=='object')throw Error('Preserve unreadable advice exposure');d.samples=d.samples.filter(r=>r.at>now-HOUR);for(const[k,v]of Object.entries(d.failed))if(v.until<=now)delete d.failed[k];return d;}
function totals(d){return d.samples.reduce((r,s)=>({active:r.active+s.ms,exploration:r.exploration+(s.exploration?s.ms:0)}),{active:0,exploration:0});}
function allow(data,action,p,now,operational=false){const d=policy(data,now),t=totals(d),id=key(action,p);if(d.failed[id]?.until>now)return {allowed:false,reason:'same_evidence_failed_advice'};if(!operational&&t.active<60000)return {allowed:false,reason:'eligible_active_time_required'};if(!operational&&t.exploration>=t.active*.1)return {allowed:false,reason:'rolling_exploration_budget'};return {allowed:true,id};}
function sample(data,now,active,exploring){const d=policy(data,now),prev=d.previous;d.previous=active?now:null;if(prev!=null&&active&&now>=prev&&now-prev<=10000&&now>prev){d.samples.push({at:now,ms:now-prev,exploration:exploring});if(d.samples.length>4000)d.samples=d.samples.slice(-4000);}return totals(d);}
function failed(data,action,p,reason,now){if(['death','uncertain_paid','personal_return_deadline','rolling_exploration_budget'].includes(reason))policy(data,now).failed[key(action,p)]={until:now+HOUR,reason};}
module.exports={allow,sample,failed};
