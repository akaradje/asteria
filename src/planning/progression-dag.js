'use strict';
const economy=require('../economy');
function plan(i,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),milestones=require('./progression-priority').assess(s,cat);
 const fresh=require('../runtime/freshness').decisionGate(i,now).allowed&&i.v2?.sourceCoherence?.matches===true;
 const pending=!!i.v2?.journal?.pending()||!!i.developmentLedger?.view?.().some(r=>r.status==='pending');
 const nodes=[],add=(id,dependencies,verified,ready,reason,domain)=>{nodes.push({id,dependencies,state:verified?'verified':!fresh?'waiting_evidence':pending?'reconcile':ready?'ready':'blocked',reason,domain});return id;};
 add('pet',[],milestones.pet,true,milestones.pet?'สัตว์เลี้ยงใช้งานจริง':'ใช้ตัวที่เป็นเจ้าของจริงก่อน','pets');
 const promotion=require('./endgame').assess(s,cat,{});
 add('class',['pet'],!milestones.nextClass,milestones.pet&&promotion.promotionMissing.length===0,'ทวน native prerequisite ก่อนเลื่อนคลาส','class');
 const wingReady=i.v2?.objective?.next?.kind==='craft'&&i.v2.objective.next.ready===true&&cat.items?.[i.v2.objective.next.id]?.slot==='wing';
 add('wing',['class'],milestones.wing,milestones.pet&&!milestones.nextClass&&wingReady,'คราฟตามสูตร build แล้วตรวจสวมจริง','craft');
 const owned=new Set(economy.ownedNames(s)),available={...s.materials,...s.keyItems,Copper:s.coins,'Rune Dust':s.runeDust,'Guild Token':s.tokens};
 const objective=i.v2?.objective,items=new Map((objective?.nodes||[]).map(n=>[n.id,n]));let graphInvalid=false;
 const visiting=new Set(),complete=new Map();
 function acquire(id){
  if(complete.has(id))return complete.get(id);
  if(visiting.has(id)){graphInvalid=true;return 'invalid_recipe_cycle';}visiting.add(id);
  const item=items.get(id),dependencyIds=(item?.dependencies||[]).map(acquire);
  const missing=Object.entries(item?.cost||{}).filter(([k,n])=>!Number.isFinite(n)||n<0||!Number.isFinite(available[k])||available[k]<n).map(([name,want])=>({name,want,have:Number.isFinite(available[name])?available[name]:null}));
  const acquired=owned.has(id),ready=!!item?.cost&&!missing.length&&dependencyIds.every(k=>nodes.find(n=>n.id===k)?.state==='verified');
  const node='acquire:'+id;add(node,['wing',...dependencyIds],acquired,milestones.equipmentAllowed&&ready,acquired?'ของอยู่ในคลังจริง':missing.length?'ขาดทรัพยากรที่ยืนยันจาก save':'รอสูตร/แหล่งของที่ตรวจแล้ว','craft');nodes.at(-1).missing=missing;
  visiting.delete(id);complete.set(id,node);return node;
 }
 for(const target of objective?.targets||[]){
  const id=acquire(target.id),equipped=s.equip?.[target.slot]===target.id;
  add('equip:'+target.slot,[id],equipped,milestones.equipmentAllowed&&owned.has(target.id),'ตรวจ item ID/slot/class และ save หลังสวม','equipment');
  const refine=Number(s.refine?.[target.id])||0;
  if(require('../knowledge/refine-capability').support(target.slot,cat.world).state==='supported')add('refine:'+target.slot,['equip:'+target.slot],equipped&&refine>=10,milestones.equipmentAllowed&&equipped&&i.investmentPlan?.selected?.kind==='refine'&&i.investmentPlan?.selected?.ready===true,'กันเงินยา/วัตถุดิบหลัก ตีบวกหนึ่งขั้นแล้วทวนผลจริง','refine');
 }
 const verified=i.journeyMemory?.events?.filter(r=>r.build===cat.build).slice(-8)||[];
 return {version:3,at:now,saveAt:i.lastSaveAt,build:cat.build,milestones,fresh,pending,graphInvalid,nodes,selected:graphInvalid?null:nodes.find(n=>n.state==='ready')?.id||null,verified,executor:'existing_guarded_adapters',activitiesEnabled:i.activityAutomationPaused===false,complete:false,limits:'catalog target and outgoing-save milestones; no fabricated receipt, optimality or +10 guarantee'};
}
module.exports={plan};
