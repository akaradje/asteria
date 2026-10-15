'use strict';
const fs=require('fs'),path=require('path');
class BrainMemory {
  constructor(root,slot){this.file=path.join(root,'data','learning',`brain-${slot}.json`);this.data={blocked:{},deaths:{},failures:{}};const history=require('./runtime/preserved-history').read(this.file,x=>{if(!x||typeof x!=='object'||['blocked','deaths','failures'].some(k=>x[k]!=null&&(typeof x[k]!=='object'||Array.isArray(x[k]))))throw Error('Brain history schema');return [x];});if(history.corrupt)throw Error('Brain history quarantined; do not reset death/advice evidence');const saved=history.rows[0];if(saved){for(const k of ['blocked','deaths','failures','strategy','decisions','travelDeaths','adviceExposure'])if(saved[k]&&typeof saved[k]==='object')this.data[k]=saved[k];this.data.dead=!!saved.dead;}this.dead=!!this.data.dead;}
  blocked(now=Date.now()){return Object.fromEntries(Object.entries(this.data.blocked).filter(([,v])=>v.until>now));}
  allows(map,now=Date.now()){return !(this.data.blocked[map]?.until>now);}
  setStrategy(action,reason,now=Date.now(),duration=900000,proposal=null,options={}) {
    if(!Number.isSafeInteger(duration)||duration<1000||duration>900000)throw Error('Strategy exposure exceeds bounded advice');
    const operational=options.mode==='operational';
    if(operational&&(!Object.hasOwn(require('./character-brain').FOCUSES,action)||proposal?.version!==2||proposal.maxSpend!==0||!proposal.actorId||!proposal.build||!Number.isFinite(proposal.expiresAt)||proposal.expiresAt<=now||proposal.stopRule?.stopOnUncertain!==true||proposal.stopRule?.maxDeaths!==0||!Number.isSafeInteger(proposal.stopRule?.maxActiveMs)||duration>proposal.stopRule.maxActiveMs||!Array.isArray(options.uncertainBaseline)))throw Error('Invalid operational strategy');
    if(proposal){const check=require('./learning/advice-exposure').allow(this.data,action,proposal,now,operational);if(!check.allowed)throw Error(check.reason);}
    this.data.strategy={action,reason:String(reason||'').slice(0,1200),at:now,until:now+duration,proposal,activeMs:0,lastSampleAt:null,...(operational?{mode:'operational',uncertainBaseline:options.uncertainBaseline,uncertainBaselineVersion:require('./learning/strategy-scope').version}:{} )};
    this.data.decisions=[this.data.strategy,...(this.data.decisions||[])].slice(0,12);this.save();
  }
  strategy(now=Date.now()){return this.data.strategy?.until>now?this.data.strategy:null;}
  observeStrategy(i,now=Date.now()){
    const s=this.data.strategy,active=i.status==='playing'&&Number.isFinite(i.lastSaveAt)&&now>=i.lastSaveAt&&now-i.lastSaveAt<30000&&i.v2?.sourceCoherence?.matches===true&&!i.recycling&&!i.healthRecovery;
    const exposure=require('./learning/advice-exposure'),usage=exposure.sample(this.data,now,active,!!(s?.proposal&&s.mode!=='operational'&&s.until>now));if(!s?.proposal||s.until<=now){if(now-(this.exposureSavedAt||0)>=30000){this.exposureSavedAt=now;this.save();}return null;}
    const p=s.proposal,rows=i.v2?.journal?.rows||[],unknown=rows.some(r=>['UNCERTAIN','OBSERVED'].includes(r.status)&&!r.closedSessionEvidence)||['unresolved','spent_without_change'].includes(i.developmentLedger?.pending?.()?.status)||i.teamTradeStatus?.phase==='UNCERTAIN';
    const newUnknown=s.mode==='operational'?require('./learning/strategy-scope').uncertainty(i).some(k=>!(s.uncertainBaseline||[]).includes(k)):unknown;
    const reason=i.actorIdentity?.actorId!==p.actorId?'actor_changed':i.catalog?.().build!==p.build?'build_changed':i.livePos?.dead?'death':s.mode==='operational'&&s.uncertainBaselineVersion!==require('./learning/strategy-scope').version?'strategy_scope_updated':newUnknown?'uncertain_paid':i.bossWindow?.departAt&&now>=i.bossWindow.departAt?'personal_return_deadline':s.mode!=='operational'&&usage.exploration>=usage.active*.1?'rolling_exploration_budget':null;
    if(reason){s.until=now;s.stopReason=reason;s.stoppedAt=now;exposure.failed(this.data,s.action,p,reason,now);this.save();return reason;}
    if(active&&s.lastSampleAt!==null&&now>=s.lastSampleAt&&now-s.lastSampleAt<=10000)s.activeMs+=now-s.lastSampleAt;
    s.lastSampleAt=active?now:null;
    if(s.activeMs>=p.stopRule.maxActiveMs){s.until=now;s.stopReason='active_time_budget';s.stoppedAt=now;this.save();return s.stopReason;}
    if(now-(s.persistedAt||s.at)>=30000){s.persistedAt=now;this.save();}return null;
  }
  block(map,reason,duration,now=Date.now()){if(!map||map==='town')return;this.data.blocked[map]={reason,until:now+duration};this.save();}
  position(p,now=Date.now(),travelTarget=null){
    const changed=!!p.dead!==this.dead;
    const edge=!!p.dead&&!this.dead;this.dead=!!p.dead;
    if(changed){this.data.dead=this.dead;this.save();}
    if(!edge||!p.room||p.room==='town')return false;
    let travelBlocked=false;
    if(travelTarget&&travelTarget!==p.room&&!/^(tw|dx|gd|pv)/.test(p.room)){
      this.data.travelDeaths ||= {};
      const attempts=(this.data.travelDeaths[travelTarget]||[]).filter(at=>now-at<900000);attempts.push(now);this.data.travelDeaths[travelTarget]=attempts;
      if(attempts.length>=2){this.block(travelTarget,'เสียชีวิตระหว่างเดินทางไปเป้าหมาย 2 ครั้งใน 15 นาที',1800000,now);travelBlocked=true;}
    }
    const deaths=(this.data.deaths[p.room]||[]).filter(at=>now-at<300000);deaths.push(now);this.data.deaths[p.room]=deaths;
    if(deaths.length>=2){this.block(p.room,'เสียชีวิตซ้ำ 2 ครั้งใน 5 นาที',900000,now);return true;}this.save();return travelBlocked;
  }
  travelFailure(map,now=Date.now()){
    const f=this.data.failures[map]||{count:0,at:0};f.count=now-f.at>600000?1:f.count+1;f.at=now;this.data.failures[map]=f;
    if(f.count>=3){this.block(map,'เดินทางไม่ถึง 3 ครั้ง',1800000,now);f.count=0;this.save();return true;}this.save();return false;
  }
  arrived(map){if(this.data.failures[map]){delete this.data.failures[map];this.save();}}
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
}
function chooseGate(gates,level,goal,blocked={}) {
  const safe=Object.entries(gates).filter(([id,g])=>g.levelMin<=level&&!blocked[id]);
  const desired=goal&&goal[0]+'1';
  return safe.find(([id])=>id===desired)||safe.sort((a,b)=>b[1].levelMin-a[1].levelMin)[0]||null;
}
module.exports={BrainMemory,chooseGate};
