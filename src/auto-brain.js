'use strict';
const fs=require('fs'),path=require('path');
const {FOCUSES}=require('./character-brain');
const {context,problemSlots,strategicSlots,REVIEW_MS}=require('./ai-advisor');
const {eligible,actionable:nativeActionable}=require('./runtime/ai-command');
const actionable=a=>a==='sync_game'||nativeActionable(a);
class AutoBrain {
  constructor(root,advisor,getFarm,dispatch,{systemRecovery}={}){this.root=root;this.advisor=advisor;this.getFarm=getFarm;this.dispatch=dispatch;this.systemRecovery=systemRecovery;this.file=path.join(root,'logs/ai-auto.json');this.data={enabled:true,nextAt:0,failures:0,history:[]};try{Object.assign(this.data,JSON.parse(fs.readFileSync(this.file,'utf8')));}catch{}this.busy=false;this.research=new(require('./learning/knowledge-research').KnowledgeResearch)(root);}
  save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  view(){return {...this.data,busy:this.busy,research:this.research.view(),intervalMinutes:5,authority:{role:'strategic_controller',priority:'operator_then_ai_then_local_execution',reviewMinutes:REVIEW_MS/60000,execution:'native_verified',fallback:'delegated_local_controller'}};}
  setEnabled(enabled){this.data.enabled=enabled;this.data.nextAt=enabled?Date.now():this.data.nextAt;this.save();}
  evaluate(state,farm,now){
    for(const past of this.data.history){
      const at=Date.parse(past.at);if(!Number.isFinite(at)||now-at<180000||now-at>1800000)continue;
      // Older one-shot records remain historical. New records observe each
      // actor separately at 3, 10 and 15 minutes; stale frames do not consume
      // a checkpoint and an unapplied intent is never evidence of failure.
      if(past.evaluatedAt&&!past.outcomeChecks)continue;
      past.outcomeChecks||={};
      past.outcomes=(past.decisions||[]).map(d=>{
        const before=past.baseline?.find(m=>m.slot===d.slot),after=state.members.find(m=>m.slot===d.slot);
        const checkpoint=[900000,600000,180000].find(ms=>now-at>=ms),previous=past.outcomeChecks[d.slot];
        if(previous?.checkpoint>=checkpoint)return past.outcomes?.find(o=>o.slot===d.slot)||{slot:d.slot};
        const receipt=after?.lastAIAction,commandId=d.commandId||past.at+':'+d.slot;
        const row={slot:d.slot,actorId:before?.actorId||null,elapsedMs:now-at,evidence:'observed_after_advice_not_proof_of_causation',execution:receipt?.id===commandId?{state:receipt.state||'unknown',at:receipt.at,status:receipt.status,evidence:receipt.evidence}: {state:'not_confirmed'}};
        if(past.farmId!==farm.id||!before||!after||(before.actorId||null)!==(after.actorId||null)||!before.build||before.build!==after.build||after.status!=='playing'||after.saveAgeSeconds<0||!Number.isFinite(after.saveAgeSeconds)||after.saveAgeSeconds>30)return {...row,status:'ยังประเมินไม่ได้: ตัวละคร รอบเกม รุ่นเกม หรือข้อมูลสดไม่ตรง'};
        let netExp=null;try{const curve=after.level===before.level?null:require('./economy').loadCatalog(this.root,after.build).world?.expToNext;netExp=require('./observability/level-progress').delta({lv:before.level,exp:before.exp},{lv:after.level,exp:after.exp},curve);}catch{}
        const outcome=require('./learning/advice-outcome').compare(before,after),confounders=[];
        if(before.job!==after.job)confounders.push('class_changed');
        if((before.goalMap||null)!==(after.currentGoal?.mapId||null))confounders.push('goal_changed');
        if(before.busy||after.busy)confounders.push('protected_work');
        const application=row.execution.state==='applied'&&Number.isFinite(row.execution.at)&&row.execution.at>=at&&row.execution.at<=now;
        const result={...row,...outcome,at:now,build:after.build,job:after.job,checkpoint,combatComparable:before.job===after.job,confounders,appliedForMs:application?now-row.execution.at:null,planAssessment:d.chain==='rejected'?'rejected_not_executed':d.commandId&&!application?'awaiting_application':outcome.effects.length?'observed_progress':'no_upgrade_observed_not_failure',levelsGained:after.level-before.level,netExp,status:outcome.effects.length?'พบผลพัฒนา '+outcome.effects.map(e=>e.kind).join(', '):netExp===null?'ยังคำนวณ EXP ไม่ได้':netExp>0?'พบ EXP เพิ่มหลังคำแนะนำ':'ยังไม่พบ EXP เพิ่มหลังคำแนะนำ'};
        past.outcomeChecks[d.slot]={checkpoint,at:now};past.evaluatedAt=now;
        if(before.actorId){this.data.outcomeMemory||=[];const key=commandId+':'+checkpoint;this.data.outcomeMemory=[{...result,key,action:d.action,farmId:farm.id},...this.data.outcomeMemory.filter(o=>o.key!==key&&Number.isFinite(o.at)&&now-o.at>=0&&now-o.at<86400000)].slice(0,192);}
        return result;
      });
    }
  }
  async tick(now=Date.now()){
    if(!this.data.enabled)return;
    // A provider outage cannot strand source/data repair. The same queue is
    // also available as the model's sync_game action; it never restarts here.
    if(this.systemRecovery)this.data.systemRecovery=this.systemRecovery();
    if(this.busy||this.advisor.busy||now<this.advisor.nextAt)return;
    const farm=this.getFarm();if(!farm?.ready)return;
    let state;try{state=context(this.root,now);}catch{this.data.nextAt=now+60000;this.data.lastSkip='รอข้อมูลสด ไม่เรียก API จากข้อมูลเก่า';this.save();return;}
    require('./learning/incident-lifecycle').reconcile(this.data,state,now);
    this.data.progressionRepairIncidents=require('./learning/progression-incidents').pending(this.root);
    this.data.repairQueue=require('./learning/repair-pipeline').queue(this.data.incidents);
    const incidents=state.members.filter(m=>m.actorId&&m.recovery?.needsDiagnosis&&m.recovery.incidentKey);
    const newIncident=incidents.some(m=>!(this.data.diagnoses||[]).some(d=>d.actorId===m.actorId&&d.build===m.build&&d.incidentKey===m.recovery.incidentKey));
    // Wake once for new evidence, never defeat provider backoff or user pause.
    this.evaluate(state,farm,now);
    if(now<this.data.nextAt&&!(newIncident&&!this.data.failures&&now-(this.data.lastRequestedAt||0)>=60000)){this.save();return;}
    // AI owns the strategic priority even during productive play. Local work
    // continues between reviews and while an existing strategy/owner is active.
    const problem=problemSlots(state),routine=strategicSlots(state,this.data.authorityReviews,now);
    const slots=[...new Set([...problem,...routine])];
    if(!slots.length){this.data.nextAt=now+60000;this.data.lastSkip='ทุกตัวกำลังคืบหน้าหรือทำงานเดิม รักษาแผนโดยไม่เรียก API';this.data.skippedRounds=(this.data.skippedRounds||0)+1;this.save();await this.research.tick(this.advisor,now,state);return;}
    this.busy=true;this.data.nextAt=now+300000;this.data.lastRequestedAt=now;this.data.lastSkip=null;this.save();
    try{
      await this.advisor.generate({slots,mode:'controller'});const result=require('./learning/ai-recovery-fallback').select(this.advisor.last,state);
      const record={at:result.at,snapshotAt:result.snapshotAt,farmId:farm.id,authority:'strategic_controller',routineSlots:routine,efficiency:result.efficiency||null,baseline:state.members.filter(m=>slots.includes(m.slot)).map(m=>({slot:m.slot,...require('./learning/advice-outcome').metrics(m),busy:m.busy,goalMap:m.currentGoal?.mapId||null})),thoughts:result.plan?.members||[],decisions:[],outcomes:[]};
      const reviewed=m=>{const before=state.members.find(x=>x.slot===m.slot);this.data.authorityReviews||={};this.data.authorityReviews[before.actorId+':'+before.build]={at:Date.now(),action:m.action};this.data.authorityReviews=Object.fromEntries(Object.entries(this.data.authorityReviews).sort((a,b)=>b[1].at-a[1].at).slice(0,96));};
      const planner=result.plannerProvider||'openrouter';
      for(const m of incidents.filter(m=>slots.includes(m.slot))){
        const diagnosis={at:now,actorId:m.actorId,build:m.build,incidentKey:m.recovery.incidentKey,
          blocker:m.recovery.reason,suppressedActions:m.recovery.suppressedActions,
          recommendation:result.plan?.members?.find(x=>x.slot===m.slot)?.reason||null,
          status:result.plan?'proposal_not_verified':'provider_unavailable',resolved:false};
        this.data.diagnoses=[diagnosis,...(this.data.diagnoses||[]).filter(d=>!(d.actorId===m.actorId&&d.build===m.build&&d.incidentKey===diagnosis.incidentKey))].slice(0,96);
      }
      const available=(['meta','openrouter'].includes(planner)||planner==='typesafe'&&['bounded_zero_spend_route_review','bounded_zero_spend_strategy'].includes(result.fallback?.mode))&&result.providers[planner]?.ok&&result.plan;
      record.plannerProvider=planner;record.fallback=result.fallback||null;
      if(!available){this.data.failures++;record.note='API ไม่ครบ ใช้สมองเดิมต่อ';}
      else{
        this.data.failures=0;
        for(const m of result.plan.members){
          const j=result.providers.typesafe?.choices?.find(x=>x.slot===m.slot);
          if(!slots.includes(m.slot))continue;
          if(!actionable(m.action)){if(routine.includes(m.slot)&&['continue','observe'].includes(m.action)&&this.data.enabled&&this.getFarm()?.id===farm.id){try{const fresh=context(this.root),before=state.members.find(x=>x.slot===m.slot),after=fresh.members.find(x=>x.slot===m.slot);if(after?.actorId===before.actorId&&after.build===before.build&&strategicSlots(fresh,this.data.authorityReviews).includes(m.slot))reviewed(m);}catch{}}record.decisions.push({slot:m.slot,action:m.action,status:'AI มอบหมายให้ทำแผนเดิม/เก็บข้อมูล'});continue;}
          const incident=this.data.incidents?.find(r=>!r.resolved&&r.actorId===m.proposal?.actorId&&r.build===m.proposal?.build);
          if(incident?.playbook&&m.action!=='sync_game'&&!Object.hasOwn(FOCUSES,m.action)){const gate=require('./learning/incident-playbooks').gate(incident.playbook,incident.attempts,now);if(!gate.allow){record.decisions.push({slot:m.slot,action:m.action,status:gate.reason,nextCheck:gate.nextCheck,fallback:gate.fallback});continue;}}
          const routing=require('./learning/provider-routing');const route=result.fallback?require('./learning/ai-recovery-fallback').route(result,m,state):routing.decision({planner:{...result.providers[planner],provider:planner},judge:{...j,ok:result.providers.typesafe?.ok===true},action:m.action,member:state.members.find(x=>x.slot===m.slot),proposal:m.proposal,benchmark:routing.load(this.root),now:Date.now()});if(!route.allowed){record.decisions.push({slot:m.slot,action:m.action,status:route.reason,route:route.route});continue;}
          if(!this.data.enabled||this.getFarm()?.id!==farm.id){record.decisions.push({slot:m.slot,status:'ยกเลิก: ปิด AI หรือรอบเกมเปลี่ยน'});continue;}
          let stillBlocked=false;try{const freshState=context(this.root),before=state.members.find(x=>x.slot===m.slot),after=freshState.members.find(x=>x.slot===m.slot),focus=Object.hasOwn(FOCUSES,m.action);stillBlocked=after?.actorId===before.actorId&&after.build===before.build&&(problemSlots(freshState).includes(m.slot)||focus&&routine.includes(m.slot)&&strategicSlots(freshState,this.data.authorityReviews).includes(m.slot))&&(!result.fallback||require('./learning/ai-recovery-fallback').route(result,m,freshState).allowed)&&(!(focus||route.route==='bounded_planner')||require('./learning/autonomous-policy').allowed(m.action,after,m.proposal,Date.now()));}catch{}
          if(!stillBlocked){record.decisions.push({slot:m.slot,action:m.action,status:'ไม่แทรกแซง: ข้อมูลเปลี่ยนหรือกลับมาคืบหน้าแล้ว'});continue;}
          const command={id:result.at+':'+m.slot,actorId:m.proposal?.actorId,proposal:m.proposal,build:state.members.find(r=>r.slot===m.slot)?.build,slot:m.slot,action:m.action,reason:m.reason,expiresAt:Date.parse(result.snapshotAt)+120000};
          const reply=await this.dispatch(command);if(reply.ok!==false&&Object.hasOwn(FOCUSES,m.action))reviewed(m);require('./learning/incident-lifecycle').dispatched(this.data,{actorId:command.actorId,build:command.build,action:command.action,commandId:command.id,result:reply,at:Date.now()});record.decisions.push({slot:m.slot,commandId:command.id,actorId:command.actorId,action:m.action,status:reply.status,route:route.route,judge:j||null,chain:reply.ok===false?'rejected':'accepted_not_confirmed',proposal:m.proposal});
        }
      }
      this.data.history.unshift(record);this.data.history=this.data.history.slice(0,12);
      this.data.lastError=null;
    }catch{this.data.failures++;this.data.lastError='ยังวิเคราะห์ไม่ได้ รอข้อมูลใหม่หรือบริการกลับมาพร้อม';}
    finally{this.data.nextAt=Date.now()+Math.min(1800000,300000*Math.pow(2,Math.min(this.data.failures,3)));this.busy=false;this.save();}
  }
}
module.exports={AutoBrain,eligible};
