'use strict';
// A provider outage must not disable the existing zero-spend route reviewer.
// This is a narrow policy, not a single-model calibration or payment approval.
const contract=require('./proposal-contract');
function eligibleStrategy(m,choice){
 return !!m&&/^actor-[a-f0-9]{32}$/.test(m.actorId||'')&&!!m.build&&m.status==='playing'&&Number.isFinite(m.saveAgeSeconds)&&m.saveAgeSeconds>=0&&m.saveAgeSeconds<=30&&m.system?.sourceMatches!==false&&
  choice?.slot===m.slot&&Object.hasOwn(require('../character-brain').FOCUSES,choice.action)&&Number.isFinite(choice.confidence)&&choice.confidence>=.9&&require('./autonomous-policy').feasibleFocus(choice.action,m)&&m.personalBrain?.availableFocuses?.includes(choice.action);
}
function eligible(m,choice){
 return !!m&&/^actor-[a-f0-9]{32}$/.test(m.actorId||'')&&typeof m.build==='string'&&!!m.build&&
  m.status==='playing'&&!m.busy&&Number.isFinite(m.saveAgeSeconds)&&m.saveAgeSeconds>=0&&m.saveAgeSeconds<=30&&
  Number.isFinite(m.noProgressSeconds)&&m.noProgressSeconds>=300&&m.recovery?.needsDiagnosis===true&&
  !m.recovery.suppressedActions?.includes('replan')&&!m.recovery.suppressedActions?.includes('farm')&&
  !m.recovery.blockedNodes?.some(n=>['evidence','health','execute','native-result'].includes(n))&&
  !(m.development?.campaign?.ready&&['class','wing'].includes(m.development.campaign.phase))&&
  choice?.slot===m.slot&&choice.action==='review_route'&&Number.isFinite(choice.confidence)&&choice.confidence>=.9;
}
function select(result,state,now=Date.now()){
 const primary=result.plannerProvider||'openrouter';
 if(result.providers?.[primary]?.ok||!result.providers?.typesafe?.ok||result.providers.typesafe.model!=='jev-latest')return result;
 const at=Date.parse(result.snapshotAt);
 if(!Number.isFinite(at)||now<at||now-at>90000)return result;
 const members=[];
 for(const m of state.members){
  const choice=result.providers.typesafe.choices?.find(c=>c.slot===m.slot);
  const strategic=eligibleStrategy(m,choice);
  if(!strategic&&!eligible(m,choice))continue;
  const p={action:strategic?choice.action:'review_route',reason:strategic?'jev-latest เลือกกลยุทธ์ที่ทำได้; ตัววางแผนหลักไม่พร้อม; native ตรวจเจ้าของและผลเดิมก่อนทำ':'jev-latest เลือกทบทวนเส้นทางจากเป้าหมายติดขัด; ตัววางแผนหลักไม่พร้อม',
   evidenceIds:contract.facts(m).map(f=>f.id),effects:[{kind:'evidence',direction:'observe',basis:'proposal_only'}],
   stopRule:{maxActiveMs:180000,maxDeaths:0,stopOnUncertain:true}};
  const proposal=contract.verify(p,m,{snapshotAt:result.snapshotAt,now});
  if(strategic&&!require('./autonomous-policy').allowed(p.action,m,proposal,now))continue;
  members.push({slot:m.slot,action:p.action,reason:p.reason,proposal});
 }
 return members.length?{...result,plannerProvider:'typesafe',fallback:{mode:members.some(m=>m.action!=='review_route')?'bounded_zero_spend_strategy':'bounded_zero_spend_route_review',unavailableProvider:primary},
  plan:{summary:'กลยุทธ์จาก AI สำรองที่จำกัดขอบเขต; ให้ native ตรวจและดำเนินการ; ยังไม่ยืนยันผล',members}}:result;
}
function route(result,m,state){
 const member=state.members.find(x=>x.slot===m.slot),choice=result.providers?.typesafe?.choices?.find(x=>x.slot===m.slot);
 return {allowed:['bounded_zero_spend_route_review','bounded_zero_spend_strategy'].includes(result.fallback?.mode)&&(m.action==='review_route'?eligible(member,choice):eligibleStrategy(member,choice)&&require('./autonomous-policy').allowed(m.action,member,m.proposal))&&m.proposal?.actorId===member.actorId&&m.proposal?.build===member.build&&m.action===choice?.action,
  route:'bounded_jev_recovery',reason:'zero_spend_route_review; current actor gates and outcome verification remain required'};
}
module.exports={eligible,eligibleStrategy,select,route};
