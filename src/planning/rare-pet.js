'use strict';
const pets=require('./active-pet');
function assess(i,wiki,board,now=Date.now()){
 const s=i.lastSave||{},cat=i.catalog(),base={at:now,build:cat.build,method:'projected role utility, not measured DPS',candidate:null};
 if(!pets.reviewed(i.root,cat.build))return {...base,status:'blocked',reason:'pet source requires review',wishlist:[]};
 const monsters=cat.world.MONSTERS||[],elite=monsters.filter(m=>['boss','miniboss'].includes(m.kind));
 const virtual={...s,pets:Object.fromEntries(elite.map(m=>[m.id,1000]))},owned=pets.development(s,cat),ceiling=owned.projected[0]?.score||0;
 const wishlist=pets.rank(virtual,cat).slice(0,5).map(row=>{const m=elite.find(m=>m.id===row.id),need=m.kind==='boss'?50:30,kills=Math.max(0,Number(s.bestiary?.[m.id])||0);return {...row,kind:m.kind,level:m.level,owned:Object.hasOwn(s.pets||{},m.id),friendship:s.pets?.[m.id]??null,kills,unlockKills:need,remainingKills:Math.max(0,need-kills),projectedScore:row.score,improves:row.score>ceiling*1.05};});
 const result={...base,status:'waiting',wishlist,reason:'รอบอสที่เหมาะกับอาชีพและผ่านเงื่อนไขพร้อมรบ'};
 const fresh=at=>Number.isFinite(at)&&now-at>=0&&now-at<30000;
 if(!fresh(i.lastSaveAt)||!fresh(i.livePos?.at)||now-i.livePos.at>=10000||!fresh(i.vitals?.at)||now-i.vitals.at>=10000||!Number.isFinite(i.vitals.hp)||i.vitals.hp<.95||i.teamControl||i.recycling||i.choresBusy||i.pendingTravel||i.livePos.dead||i.survivalRecovery||i.survivalStatus?.deaths?.length||s.developmentDefensive||require('../runtime/survival').hpPots(s)<20||require('../runtime/room-policy').roomPolicy(i.livePos.room).dungeon)return {...result,reason:'รอข้อมูลสด HP 95% ยา 20 และไม่มีช่วงพักฟื้นหรือทีมควบคุม'};
 if(!board||!fresh(board._receivedAt))return {...result,reason:'รอตารางบอสสดจากเซิร์ฟเวอร์'};
 const blocked=i.brain?.blocked?.(now)||{},maps=wiki?.maps?.maps||[];
 // An unbeaten elite is a wishlist item, not evidence that solo farming it is safe.
 for(const target of wishlist.filter(t=>!t.owned&&t.improves&&t.kills>0&&t.remainingKills>0&&t.level<=s.lv-10)){
  const map=maps.find(m=>m.kind==='field'&&!blocked[m.id]&&m.levelMin<=s.lv&&(m.monsters?.[target.kind]||[]).includes(target.id)&&board.list?.some(b=>b.id===target.id&&b.map===m.id&&b.up&&!b.next));if(!map)continue;
  return {...result,status:'eligible',reason:'มีหลักฐานเคยสังหาร และบอสเกิดตามข้อมูลสด',candidate:{kind:'pet-unlock',mapId:map.id,mapName:map.name,monsterId:target.id,monsterKind:target.kind,monster:target.name,alive:true,score:1600,label:'ปลดสัตว์เลี้ยงหายาก: '+target.name+' '+target.kills+'/'+target.unlockKills,reason:'ล่าตัวศักยภาพสูงตามอาชีพ; คลาส ปีก เควสหลัก และเวลากลับบอสมีสิทธิ์ก่อน',petUnlockKills:target.unlockKills,expectedKills:target.remainingKills,expectedCombatGain:Math.max(0,target.projectedScore-ceiling)}};
 }
 return result;
}
module.exports={assess};
