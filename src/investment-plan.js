'use strict';
const economy=require('./economy'),gear=require('./gear-value');
function choose(save,cat,wiki,{campaignComplete=false,reserved={},blockedKinds={},blockedCraftIds=new Set(),craftBlocked=()=>false,refineGate=()=>({allowed:true})}={}){
 wiki=economy.withNativeRecipes(wiki,cat);
 const reserve=require('./upgrade-reserve').reserve(save,cat.world),budget=Math.max(0,(save.coins||0)-reserve-(reserved.Copper||0)),candidates=[];
 const p=require('./character-brain').profile(save,cat,wiki,{reserved,blockedCraftIds});
 if(!p.milestones.equipmentAllowed)return {at:Date.now(),reserve,budget,selected:null,candidates:[],reason:p.milestones.reason,caveat:'Owned free swaps and prerequisite wing campaign remain available'};
 if(p.progression.capped&&!campaignComplete)return {at:Date.now(),reserve,budget,selected:null,candidates:[],reason:'เลเวลเต็ม: ให้แคมเปญเลื่อนคลาส → ปีกเป็นเจ้าของงานจ่ายเงิน กันงานตีบวก/คราฟอื่นแทรก',caveat:'Free equipment upgrades remain available; campaign confirms class/wing outcomes'};
 if(p.craft?.ready&&!blockedKinds.craft&&!craftBlocked(p.craft.id))candidates.push({kind:'craft',id:p.craft.id,name:p.craft.name,type:p.craft.type,goalPromotion:p.craft.goalPromotion,fillsEmpty:p.craft.fillsEmpty,tier:cat.items[p.craft.id]?.tier||0,cost:p.craft.coinCost,gain:p.craft.gain,value:p.craft.valuePerCopper});
 const legendaryBill=require('./planning/combat-priority').legendaryBill(p,cat.build);
 const refine=economy.refinePlan({equip:save.equip||{},refine:save.refine||{},materials:Object.fromEntries(Object.entries(save.materials||{}).map(([k,n])=>[k,Math.max(0,n-(reserved[k]||0)-(legendaryBill[k]||0))])),coins:Math.max(0,budget-(legendaryBill.Copper||0)),items:cat.items,world:cat.world,wiki,state:save});
 const blocked=[];
 const before=gear.totals(save,cat);
 if(!blockedKinds.refine&&!before.unknown.length)for(const step of refine.doable){const item=cat.items[step.id];
  if(p.progression.capped&&item?.rarity!=='legendary'&&Object.values(cat.items).some(it=>it.slot===item.slot&&it.rarity==='legendary'&&(it.reqLv||1)<=save.lv&&economy.canUse(it,save.job,cat.world)))continue;
  const gate=refineGate(step.id,{extraReserveCoins:legendaryBill.Copper||0,reservedMaterials:Object.fromEntries(Object.entries(legendaryBill).filter(([k])=>k!=='Copper'))});
  if(!gate.allowed){blocked.push({...gate,name:step.name,cost:step.coinCost});continue;}
  const after=gear.totals({...save,refine:{...save.refine,[step.id]:step.to}},cat),gain=Math.max(0,after.score-before.score)*step.chancePct/100;if(gain>0)candidates.push({kind:'refine',id:step.id,name:step.name,slot:step.slot,to:step.to,guaranteed:step.guaranteed,tier:step.tier,cost:step.coinCost,gain,value:gain/Math.max(1,step.coinCost)});}
 for(let i=candidates.length-1;i>=0;i--)if(candidates[i].cost>budget)candidates.splice(i,1);
 candidates.sort((a,b)=>b.value-a.value);
 const enchant=require('./enchant-plan').plan(save,cat.items,cat.world,wiki);
 // A ready replacement must finish before small cheap refinements can starve it.
 const readyReplacement=candidates.find(c=>c.kind==='craft'&&(c.goalPromotion||c.fillsEmpty||p.progression.capped&&campaignComplete&&c.tier>=6));
 const weaponFoundation=candidates.find(c=>c.kind==='refine'&&c.slot==='weapon'&&c.tier>=6&&c.to<=4&&c.guaranteed);
 let selected=candidates.find(c=>c.kind==='craft'&&c.type==='wing')||readyReplacement||weaponFoundation||candidates[0]||null;
 if(!selected&&!blockedKinds.enchant&&(!require('./equipment-goal').policy(cat).enabled||require('./equipment-goal').assess(save,cat).complete)&&enchant.ready&&enchant.cost.coins<=budget)selected={kind:'enchant',id:enchant.id,name:enchant.name,cost:enchant.cost.coins,value:null};
 if(selected?.kind==='refine'){selected.extraReserveCoins=legendaryBill.Copper||0;selected.reservedMaterials=Object.fromEntries(Object.entries(legendaryBill).filter(([k])=>k!=='Copper'));}
 return {at:Date.now(),reserve,budget,selected,candidates:candidates.slice(0,8),blocked:blocked.slice(0,8),reason:selected?selected===readyReplacement?'ทรัพยากรพร้อม: เติมช่องว่างหรือเปลี่ยนอุปกรณ์ปลายทางก่อนตีบวกย่อย แล้วตรวจคราฟและการสวมจากเซฟ':selected.kind==='craft'&&selected.type==='wing'?'ปีกมีสูตรที่ยืนยันและทรัพยากรพร้อม เลือกคราฟปีกก่อนตีบวกย่อย':selected.kind==='enchant'?'ไม่มีคราฟ/ตีบวกที่คำนวณผลเพิ่มและทำได้ เลือกออฟในงบจำกัดเดิม':'เลือกคะแนนเพิ่มคาดหวังต่อ Copper สูงสุดที่มีทรัพยากรพร้อม · ทำหนึ่งรายการต่อรอบ':blocked.length?'งานตีบวกมีทรัพยากรแต่ถูกบล็อก: '+blocked[0].reason:'เก็บเงินและฟาร์มทรัพยากรก่อน ยังไม่มีงานที่พร้อมและคุ้มตามเกณฑ์',caveat:'คะแนนเป็นค่าประเมิน ไม่รวมมูลค่าแร่; ออฟไม่มี expected gain ที่ยืนยัน จึงเป็นทางเลือกลำดับท้าย'};
}
module.exports={choose};
