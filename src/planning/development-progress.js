'use strict';
const economy=require('../economy');
function view(i,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),reserved=require('../runtime/paid-actions').heldResources(i),p=require('../character-brain').profile(s,cat,economy.loadWiki(i.root),{reserved,...require('../runtime/craft-scope').profileOptions(i)}),craft=p.craft;
 const recent=(i.developmentLedger?.view()||[]).slice(0,12);
 const summary=r=>({kind:r.kind,target:r.target,at:r.finishedAt||r.at,evidence:r.evidence||null});
 const observed=recent.filter(r=>r.status==='change_observed').map(summary);
 const confirmed=recent.filter(r=>r.status==='server_confirmed'&&r.evidence==='server_accepted_exact_save_revision'&&r.serverReceipt?.actorId===i.actorIdentity?.actorId&&r.context?.actorId===i.actorIdentity?.actorId&&i.actorIdentity?.actorId).map(summary);
 const pending=recent.find(r=>r.status==='pending'||r.status==='unresolved'&&r.kind==='craft');
 const fence=kind=>{const r=kind==='craft'?require('../runtime/craft-scope').blocking(i,craft?.id):i.developmentLedger?.blocking(kind);return r?{kind:r.kind,status:r.status,target:r.target?.id||null,evidence:r.evidence||null,transactionId:r.id,at:r.at}:null;};
 const targetIds=[...new Set([i.investmentPlan?.selected?.kind==='refine'?i.investmentPlan.selected.id:null,...(i.investmentPlan?.blocked||[]).map(r=>r.target),...(i.refinementGates?.blocked||[]).map(r=>r.target)].filter(Boolean))].slice(0,8);
 const targetGates=targetIds.map(id=>require('../runtime/refinement-gates').check(i,id));
 const executionGates={craft:fence('craft'),refine:fence('refine')||targetGates.find(g=>!g.allowed)||null,refineTargets:targetGates,unknownReplayAllowed:false};
 const stale=!Number.isFinite(i.lastSaveAt)||now-i.lastSaveAt<0||now-i.lastSaveAt>30000;
 const campaign=i.endgameCampaign?.phase?i.endgameCampaign:require('./capped-campaign').plan(i);
 const equipmentWork=require('./campaign-equipment').profile(i)?.craftPortfolio||null;
 const empty=(i.equipmentCeiling?.rows||[]).filter(r=>!r.id).map(r=>r.slot);
 let stage='gather',reason='เก็บของตามแหล่งที่ยืนยันและทำงานคั่นเมื่อแหล่งหลักยังไม่พร้อม';
 if(stale){stage='waiting';reason='รอเซฟสดก่อนตัดสินใจหรือจ่ายทรัพยากร';}
 else if(pending){stage='verify';reason='รอผลรายการเดิมจากเซฟ ไม่ส่งคำสั่งจ่ายเงินซ้ำ';}
 else if(i.survivalRecovery||s.developmentDefensive||i.goal?.kind==='survival'){stage='survival';reason=i.goal?.reason||'พักฟื้นและเติมยาให้พร้อมก่อนล่า';}
 else if(campaign.active&&campaign.phase!=='complete'){stage='campaign';reason=campaign.reason||'พัฒนาคลาส/ปีกก่อนคิวอุปกรณ์ปลายทาง';}
 else if(!p.milestones.equipmentAllowed){stage=p.milestones.stage;reason=p.milestones.reason+' · '+(campaign.reason||'ฟาร์มเงื่อนไขที่ขาดต่อโดยไม่แทรกอุปกรณ์');}
 else if(!p.progression.capped){stage='training';reason='เลเวลยังไม่เต็ม · ใช้อุปกรณ์พร้อมใช้และฝึกต่อ โดยกันทรัพยากรคลาส/ปีก';}
 else if(craft?.ready&&executionGates.craft){stage='craft-blocked';reason='สูตรพร้อมแต่รายการเดิมยังไม่ทราบผล ห้ามคราฟซ้ำ · ตรวจงานอิสระโดยกันทรัพยากรเดิม';}
 else if(craft?.ready){stage='craft';reason='สูตรและทรัพยากรพร้อม กลับเมืองแล้วคราฟหนึ่งครั้งและตรวจเซฟ';}
 else if(['OFFERED','OPEN','CONFIRMING','UNCERTAIN'].includes(i.teamTradeStatus?.phase)){stage='trade';reason='ประสานเทรดตามคิวทีมและรอการยืนยัน';}
 else if(i.goal?.kind==='gear-hunt'){stage='hunt';reason=i.goal.reason;}
 else if(['craft-work','development-side'].includes(i.goal?.kind)){stage='side-work';reason=i.goal.reason+(i.progressionWork?.blocked?.length?' · ขั้นหลักติดบอสที่ยังไม่ผ่านเงื่อนไข':'');}
 else if(i.goal?.kind==='craft-wait'){stage='boss-window';reason=i.goal.reason;}
 const campaignOwns=campaign.active&&campaign.phase!=='complete';
 const target=campaignOwns?{id:campaign.target||null,name:campaign.wing?.name||campaign.target||'รอเงื่อนไขคลาส / ปีก',slot:campaign.phase==='class'?'class':'wing',ready:!!campaign.ready,missing:campaign.missing||[]}:craft?{id:craft.id,name:craft.name,slot:craft.slot,ready:craft.ready,cost:craft.cost,missing:craft.missing,acquisition:craft.acquisition,recipeEvidence:craft.recipeEvidence}:null;
 const personalBrain={at:now,saveAt:i.lastSaveAt||null,build:cat.build,actorId:i.actorIdentity?.actorId||null,milestones:p.milestones,combatObjective:p.combatObjective,role:p.role,progression:p.progression,reserve:p.reserve,coins:p.coins,lowFunds:p.lowFunds,craft:p.craft,gearTargets:p.gear.slice(0,3),availableFocuses:stale?[]:p.availableFocuses,strategy:i.brain?.strategy?.()||null,nightTraining:require('./night-training').view(i,now),recentDecisions:(i.brain?.data?.decisions||[]).slice(0,3)};
 return {personalBrain,combatObjective:p.combatObjective,milestones:p.milestones,reservedResources:reserved,budgetBreakdown:require('./budget-breakdown').project(i,craft,now),at:now,saveAt:i.lastSaveAt||null,build:cat.build,stage,reason,current:i.goal?.label||'รอเป้าหมายสด',emptySlots:empty,equipmentMaintenance:i.equipmentMaintenanceStatus||null,
  target,missing:target?.missing||[],executionGates,paymentRecovery:i.paidOutcomeRecovery||null,craftPortfolio:campaignOwns?null:p.craftPortfolio,equipmentWork,work:i.progressionWork?{at:i.progressionWork.at,primary:i.progressionWork.primary,blocked:i.progressionWork.blocked,reason:i.progressionWork.reason,aiStrategy:i.progressionWork.aiStrategy||null}:null,confirmed,observed,pending:pending?{kind:pending.kind,target:pending.target,status:pending.status}:null,
  steps:['หาแหล่งของ','ฟาร์ม/แลกในทีม','คราฟหนึ่งครั้ง','สวม','ตรวจเซฟและผลจริง'],
  caveat:'change_observed คือผลเปลี่ยนในเซฟที่เกมส่งออก; คะแนนอุปกรณ์เป็นค่าประเมิน ไม่ใช่ DPS จริง'};
}
module.exports={view};
