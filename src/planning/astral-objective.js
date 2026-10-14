'use strict';
function plan(i,now=Date.now()){
 const cat=i.catalog(),w=cat.world||{},view=i.socialInbox?.astral.view(now),a=view?.state;
 const out={version:1,at:now,build:cat.build,actorId:i.actorIdentity?.actorId||null,active:false,state:'waiting_evidence',reason:'รอข้อมูลดาวเต็มจากเซิร์ฟเวอร์',action:null};
 if(!w.ASTRAL||!w.HIGH_CLASSES?.[i.lastSave?.job]||i.lastSave.lv<w.MAX_LV)return {...out,state:'ineligible',reason:'ต้องเป็นไฮคลาสและถึงเพดานเลเวลตามกฎปัจจุบัน'};
 if(!view?.fresh||view.completeness!=='full'||!Number.isInteger(a?.s)||!a.p||!Number.isFinite(a.exp)||!Number.isFinite(a.need))return out;
 const p=w.astralPts(a),left=a.s-Object.values(p).reduce((n,v)=>n+v,0),capability=require('../knowledge/capability-registry').registry(cat).astral;
 const executionBlock=require('./astral-path').enabled(i,'asbt');
 const result={...out,executionBlock,active:true,star:a.s,points:p,unspent:left,grade:a.gn||null,progress:view.progress,revision:capability.revision,minMonsterLevel:w.ASTRAL.minMonLv,rejection:view.rejection,roadmap:require('./astral-path').roadmap(w,a.s,a.bt||0,a.exp)};
 const base=require('../economy').jobChain(i.lastSave.job,w).find(j=>Object.hasOwn(require('../economy').BASE_TO_PROMOTED,j)),order=base==='priest'?['heal','red','hp','sexp','mp','dmg']:base==='knight'?['red','hp','dmg','sexp','boss']:['dmg','sexp','aspd','boss','red','hp','cdmg'];
 const ranked=require('../equipment-goal').policy(cat).dynamicProgression?w.ASTRAL.nodes.map(n=>({id:n.id,gain:(p[n.id]||0)<n.max?require('./combat-roi').delta({...i.lastSave,astral:a},{...i.lastSave,astral:{...a,p:{...p,[n.id]:(p[n.id]||0)+1}}},cat):null})).filter(n=>Number.isFinite(n.gain)&&n.gain>0).sort((a,b)=>b.gain-a.gain).map(n=>n.id):[];
 const node=[...ranked,...order,...w.ASTRAL.nodes.map(n=>n.id)].map(id=>w.ASTRAL.nodes.find(n=>n.id===id)).find(n=>n&&(p[n.id]||0)<n.max);
 const draft=node&&left>0?{...p,[node.id]:(p[node.id]||0)+Math.min(require('../equipment-goal').policy(cat).dynamicProgression?1:left,node.max-(p[node.id]||0))}:null;
 const pointGoal=draft?{state:'points_ready',action:'aspt',draft,increments:Object.fromEntries(Object.entries(draft).map(([k,n])=>[k,n-(p[k]||0)]).filter(([,n])=>n>0)),executionBlock:require('./astral-path').enabled(i,'aspt'),reason:'ลงแต้มที่เหลือเพื่อพลังต่อสู้ · เก็บเงื่อนไขทะลุขีดควบคู่',allocationBasis:'role heuristic; benefit not yet measured'}:null;
 if(a.s>=w.ASTRAL.max&&pointGoal)return {...result,...pointGoal};
 if(a.s>=w.ASTRAL.max)return {...result,state:'complete',reason:'ระดับดาวถึงเพดานที่ยืนยันจากกฎเกมและไม่มีแต้มที่ลงได้'};
 if(a.gate){
  const bill=w.ASTRAL.gate(Math.floor(a.s/w.ASTRAL.gateEvery)),held={...i.lastSave.materials,...i.lastSave.keyItems},missing=[];
  if((a.wbNeed||w.astralWbGate?.(a.s))&&!a.wb)missing.push({kind:'proof',id:'world_boss_participation'});
  if((a.bsNeed||w.astralBossGate?.(a.s))&&!a.bs)missing.push({kind:'proof',id:'regional_boss_damage_share',targets:w.ASTRAL.bossIds,share:w.ASTRAL.bossShare});
  if((a.wtNeed||w.astralWbTopGate?.(a.s))&&!a.wt)missing.push({kind:'proof',id:'world_boss_top10'});
  const count=ids=>ids.reduce((n,id)=>n+(held[id]||0),0);
  if(count(w.ASTRAL.bossCores)<bill.boss)missing.push({kind:'material',alternatives:w.ASTRAL.bossCores,want:bill.boss,have:count(w.ASTRAL.bossCores)});
  if(count(w.ASTRAL.miniCores)<bill.mini)missing.push({kind:'material',alternatives:w.ASTRAL.miniCores,want:bill.mini,have:count(w.ASTRAL.miniCores)});
  if((held['Starforged Ore']||0)<bill.ore)missing.push({kind:'material',id:'Starforged Ore',want:bill.ore,have:held['Starforged Ore']||0});
  if(i.lastSave.coins<bill.copper)missing.push({kind:'currency',id:'Copper',want:bill.copper,have:i.lastSave.coins});
  return {...result,gate:true,state:missing.length?'gate_blocked':'gate_ready',bill,missing,action:missing.length?null:'asbt',reason:missing.length?'หาเงื่อนไขทะลุขีด ไม่ฟาร์มเกจที่เต็มแล้ว':'เงื่อนไขพร้อม ตรวจงบและสิทธิ์ก่อนทะลุขีด',...pointGoal};
 }
 return {...result,...pointGoal,state:draft?'points_ready':'training',action:draft?'aspt':null,draft,reason:draft?'ลงแต้มตามบทบาทจากโหนดและเพดาน native':'ฟาร์ม EXP ดาวจากมอนที่มีสิทธิ์จริง',allocationBasis:'role heuristic; benefit not yet measured'};
}
module.exports={plan};
