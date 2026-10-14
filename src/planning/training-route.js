'use strict';
const {key,routeContext,owned}=require('../learning/exp-route-evidence');
function measured(g,now){const e=g?.farmEvidence;return e?.confidence==='observational'&&e.samples>=10&&e.minutes>=5&&Number.isFinite(e.at)&&e.at<=now&&now-e.at<86400000&&Number.isFinite(e.expPerHour);}
function cycleMeasured(g,now){const e=g?.routeEvidence;return e?.confidence==='observational'&&e.samples>=10&&e.ms>=300000&&e.coveragePct>=90&&Number.isFinite(e.at)&&e.at<=now&&now-e.at<3600000&&Number.isFinite(e.expPerHour);}
const rate=(g,now)=>cycleMeasured(g,now)?g.routeEvidence.expPerHour:measured(g,now)?g.farmEvidence.expPerHour:null;
const deaths=(g,now)=>cycleMeasured(g,now)?g.routeEvidence.deaths||g.routeEvidence.expLossEvents||0:measured(g,now)?g.farmEvidence.deaths||0:0;
function novelAllowed(i,candidate,baseline,now){
 const s=i.lastSave,cat=i.catalog(),fresh=require('../runtime/freshness');
 const native=cat.world?.MONSTERS||[],m=native.find(m=>m.id===candidate.monsterId),b=native.find(m=>m.id===baseline.monsterId);
 const mp=['Blue Potion','Sapphire Potion','Starlight Potion'].reduce((n,k)=>n+(Number(s.consumables?.[k])||0),0);
 return candidate.kills===0&&i.v2?.sourceCoherence?.matches===true&&fresh.decisionGate(i,now).allowed&&fresh.fresh(i.vitals?.at,15000,now)&&i.vitals.hp>=.95&&s.autoOpt?.ph===true&&require('../runtime/survival').hpPots(s)>=30&&mp>=10&&!i.v2?.journal?.pending()&&fresh.fresh(i.lastFpsAt,10000,now)&&i.lastFps>=20&&
  [m,b].every(n=>n?.kind==='normal'&&Number.isFinite(n.hp)&&n.hp>0&&Number.isFinite(n.atk)&&n.atk>0)&&m.level<=s.lv-6&&m.hp<=b.hp*2&&m.atk<=b.atk*1.15&&(candidate.planningScore??candidate.score)>=(baseline.planningScore??baseline.score)*1.25;
}
function choose(i,rows,now=Date.now()){
 const build=i.v2?.learningRevision||i.catalog().build;
 const {ExperimentGovernor}=require('../learning/experiment-governor');
 i.trainingDecisionAt=now;
 const governor=i.v2?.trial?.view?.().version===3?i.v2.trial:(i.trainingGovernor ||= new ExperimentGovernor(i.root,i.credentials?.charName||'fixture',i.machine||process.platform,{now:()=>i.trainingDecisionAt}));
 if(i.v2)i.v2.trial=governor;
 const state=governor.data; i.trainingRouteMemory=state;
 const signature=routeContext(build,i.lastSave);
 if(state.signature!==signature){if(governor.active())governor.finish('version_interrupt','context changed');state.signature=signature;state.hold=null;governor.persist();}
 rows=rows.filter(g=>g.kind==='exp'&&g.monsterKind==='normal'&&!(state.cooldowns[key(g)]>now)&&!deaths(g,now)&&(rate(g,now)===null||rate(g,now)>0));
 const current=rows.find(g=>key(g)===key(i.goal)),observed=rows.filter(g=>cycleMeasured(g,now)&&!deaths(g,now)&&rate(g,now)>0).sort((a,b)=>rate(b,now)-rate(a,now));
 const field=rows.filter(g=>measured(g,now)&&!deaths(g,now)&&g.farmEvidence.expPerHour>0).sort((a,b)=>b.farmEvidence.expPerHour-a.farmEvidence.expPerHour);
 const prior=[...rows].sort((a,b)=>(b.planningScore??b.score)-(a.planningScore??a.score)||(a.travelMs||0)-(b.travelMs||0));
 let pick=observed[0]||field[0]||prior.find(g=>g.kills>0)||prior[0];
 let reason=observed.length?'เลือก EXP สุทธิต่อเวลารวมเดินทาง เมือง เติมยาและพักฟื้นที่วัดได้':field.length?'มีเฉพาะผลในสนาม ยังเก็บต้นทุนทั้งรอบไม่ครบ':'ใช้สูตรเกมเป็นประมาณการก่อน ยังไม่ยืนยันว่าเร็วที่สุด';
 const activeBefore=governor.active(),trialPick=governor.select(i,build,rows,now);
 const finished=activeBefore&&!governor.active();
 if(activeBefore){pick=trialPick||(activeBefore.status==='accepted'?activeBefore.candidateGoal:activeBefore.baselineGoal);reason=governor.active()?'ทดลอง A/B/A รวมต้นทุนจริง ภายใต้งบและเจ้าของเดียว':activeBefore.reason;}
 if(!governor.active()&&!finished&&current&&pick&&key(current)!==key(pick)&&rate(current,now)>0&&rate(pick,now)>0&&cycleMeasured(current,now)===cycleMeasured(pick,now)){
  const gain=(rate(pick,now)-rate(current,now))*600000,travelCost=rate(current,now)*(pick.travelMs||0);
  if(gain<=travelCost||rate(pick,now)<rate(current,now)*1.2){pick=current;reason='ผลเพิ่มยังไม่คืนต้นทุนย้ายใน10นาที คงแหล่งเดิม';}
 }
 if(!governor.active()&&!finished&&current&&i.livePos?.room===current.mapId){
  if(state.hold?.key!==key(current))state.hold={key:key(current),since:now};
  if(now-state.hold.since<300000&&!deaths(current,now)&&!cycleMeasured(current,now)&&!measured(current,now)){pick=current;reason='วัดแหล่งเดิมอย่างน้อย5นาทีก่อนเปลี่ยน';}
  const unknown=prior.find(g=>!cycleMeasured(g,now)&&!deaths(g,now)&&(g.kills>0||novelAllowed(i,g,current,now))&&key(g)!==key(current)&&Number.isFinite(g.travelMs)&&g.travelMs<=360000&&(g.planningScore??g.score)>=(current.planningScore??current.score)*.65);
  const safe=require('../runtime/freshness').fresh(i.vitals?.at,15000,now)&&i.vitals.hp>=.85&&require('../runtime/survival').hpPots(i.lastSave)>=20&&!i.survivalRecovery&&!owned(i)&&!i.choresBusy&&!i.pendingTravel;
  if(unknown&&safe&&cycleMeasured(current,now)&&!deaths(current,now)&&now-state.hold.since>=600000&&(state.lastProbeAt===null||now-state.lastProbeAt>=1800000)){
   const started=governor.beginRoute(i,build,unknown,current,now);state.denial=started.ok?null:started.reason;
   if(started.ok){pick=unknown;reason='ทดลองเส้นทางใหม่ผ่าน governor เดียว พร้อม baseline ทั้งรอบ';}
  }
 }
 const last=state.rows.find(r=>r.status!=='running');
 return {goal:pick||null,status:{version:3,at:now,build,reason,current:key(current),selected:key(pick),measuredRoutes:observed.length,fieldMeasuredRoutes:field.length,eligibleRoutes:rows.length,untestedRoutes:rows.filter(g=>!cycleMeasured(g,now)).length,selectedExpPerHour:cycleMeasured(pick,now)?pick.routeEvidence.expPerHour:null,selectedFieldExpPerHour:measured(pick,now)?pick.farmEvidence.expPerHour:null,routeEvidence:pick?.routeEvidence||null,trial:governor.active()||null,trialDenied:state.denial||null,lastResult:last?{...last,at:last.finishedAt,coveragePct:Number.isFinite(last.candidateCoverage)?Math.round(last.candidateCoverage*100):null,accepted:last.status==='accepted'}:null,globallyBestVerified:false,serverVerified:false,causalVerified:false}};
}
module.exports={choose,measured,cycleMeasured,novelAllowed};
