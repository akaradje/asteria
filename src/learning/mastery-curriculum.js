'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),economy=require('../economy');
const {context}=require('./context-learning');
const STAGES=[
 {id:'observe',name:'อ่านสถานะจริงและรักษาการเชื่อมต่อ',requires:[],focus:null},
 {id:'sustain',name:'รอดต่อเนื่องและมีงบยา',requires:['observe'],focus:'focus_income'},
 {id:'class-build',name:'อาชีพ สเตตัส และสกิล',requires:['sustain'],focus:'focus_growth'},
 {id:'loadout',name:'ชุดและอาวุธที่เหมาะกับระดับ',requires:['sustain'],focus:'focus_gear'},
 {id:'wing-chain',name:'ปีกและลำดับคราฟ',requires:['sustain','class-build'],focus:'focus_craft'},
 {id:'yield-trials',name:'ทดลองแผนหา EXP และเงิน',requires:['sustain','loadout'],focus:null},
 {id:'boss-mechanics',name:'ฝึกบอสและกลไกการต่อสู้',requires:['sustain','loadout'],focus:null},
 {id:'team-dungeons',name:'ทีม 6 อาชีพและดันเจี้ยน',requires:['boss-mechanics'],focus:null},
 {id:'guild-endgame',name:'กิลด์ หอคอย และชุดปลายทาง',requires:['team-dungeons'],focus:null},
];
const check=(label,value,evidence)=>({label,status:value==null?'unknown':value?'met':'missing',evidence});
function assess(i,cat,{build,now=Date.now(),bookRevision,contexts=[],contextBuild=build}={}){
 const s=i.lastSave||i,at=i.lastSaveAt||0,age=now-at,fresh=age>=0&&age<=30000,held=economy.ownedNames(s),reserve=require('../upgrade-reserve').reserve(s,cat.world);
 const equipment=['weapon','head','armor','boots'].map(slot=>{const it=cat.items?.[s.equip?.[slot]];return {slot,id:s.equip?.[slot]||null,reqLv:it?.reqLv||null,tier:it?.tier||null,appropriate:!!it&&(it.reqLv||1)>=Math.min(60,Math.max(1,(s.lv||1)*.5))};});
 const signature=context(contextBuild,s);
 const observed=contexts.filter(c=>c.build===contextBuild&&c.signature===signature&&c.confidence==='observational'&&c.elapsedMs>=300000&&c.samples>=10&&c.updatedAt<=now&&now-c.updatedAt<86400000&&c.deaths===0);
 const matched=new Map();for(const c of observed){const maps=matched.get(c.signature)||new Set();maps.add(c.map);matched.set(c.signature,maps);}const comparable=[...matched.values()].some(m=>m.size>=2);
 const wing=held.some(id=>cat.items?.[id]?.slot==='wing'&&economy.canUse(cat.items[id],s.job,cat.world)&&(cat.items[id].reqLv||1)<=(s.lv||1)),jobChain=economy.jobChain(s.job,cat.world),promoted=jobChain.some(j=>Object.values(economy.BASE_TO_PROMOTED).includes(j));
 const results=i.masteryEvidence||{},hpPotions=(s.potions||0)+['Orange Potion','Yellow Potion','White Potion'].reduce((n,k)=>n+(s.consumables?.[k]||0),0);
 const checks={observe:[check('save สดไม่เกิน 30 วินาที',fresh,'save_timestamp'),check('ทราบเวอร์ชันและมีสารานุกรม',!!build&&!!bookRevision,'compiled_reference')],sustain:[check('มีเงินสำรอง',(s.coins||0)>=reserve,'saved_coins_and_reserve'),check('มียา',Number.isFinite(s.potions)||s.consumables?hpPotions>0:null,'saved_potions')],'class-build':[check('ผ่านอาชีพขั้นเลื่อน',promoted,'saved_job'),check('ใช้แต้มสเตตัสแล้ว',Number.isFinite(s.pts)?s.pts===0:null,'saved_points'),check('ใช้แต้มสกิลแล้ว',Number.isFinite(s.skPts)?s.skPts===0:null,'saved_skill_points')],loadout:equipment.map(e=>check(e.slot+' เหมาะกับระดับ',e.appropriate,'equipped_item_requirement')),'wing-chain':[check('มีปีกที่ใช้ได้',wing,'owned_item_id')],'yield-trials':[check('มีหน้าต่างข้อมูลเปรียบเทียบอย่างน้อยสองโซน',comparable,'matched_build_context_windows')],'boss-mechanics':[check('มีผลบอสที่ยืนยันในเวอร์ชันนี้',results.boss?.build===build&&results.boss?.confirmed===true?true:null,'requires_server_result')],'team-dungeons':[check('มีผลดันทีมที่ยืนยันในเวอร์ชันนี้',results.dungeon?.build===build&&results.dungeon?.confirmed===true?true:null,'requires_server_result')],'guild-endgame':[check('มีผลกิจกรรมกิลด์ที่ยืนยัน',results.guild?.build===build&&results.guild?.confirmed===true?true:null,'requires_server_result')]};
 const states=new Map(),stages=STAGES.map(stage=>{const criteria=checks[stage.id],dependencies=stage.requires.every(id=>states.get(id)==='passed'),status=!fresh?'stale':!dependencies?'locked':criteria.every(c=>c.status==='met')?'passed':criteria.some(c=>c.status==='unknown')?'needs_evidence':'training';states.set(stage.id,status);return {...stage,status,criteria};});
 const next=stages.find(s=>['training','needs_evidence'].includes(s.status));
 return {at:now,build,revision:bookRevision,character:i.character?.name||i.char||null,stage:next?.id||null,next:next?{id:next.id,name:next.name,focus:next.focus,missing:next.criteria.filter(c=>c.status!=='met')}:null,stages,equipment,observedContexts:observed.length,reserve,passed:stages.filter(s=>s.status==='passed').length,total:stages.length,limits:'Progression criteria are observable milestones; they do not certify expert combat or optimal skill choices'};
}
class MasteryMemory{
 constructor(root,identity){this.file=path.join(root,'logs','mastery',crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0,24)+'.json');try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={version:1,revisions:{}};}}
 observe(view){const key=view.build+':'+view.revision,previous=this.data.revisions[key],signature=JSON.stringify(view.stages.map(s=>[s.id,s.status,s.criteria.map(c=>c.status)]));if(previous?.signature===signature&&view.at-previous.at<60000)return;const history=[...(previous?.history||[])];if(previous?.signature!==signature)history.push({at:view.at,stage:view.stage,passed:view.passed,states:view.stages.map(s=>[s.id,s.status])});this.data.revisions[key]={at:view.at,signature,view,history:history.slice(-200)};fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
}
function focusFromState(save,cat,{craft,gear=[]}={}){
 const chain=economy.jobChain(save.job,cat.world),promoted=chain.some(j=>Object.values(economy.BASE_TO_PROMOTED).includes(j));
 if(craft?.ready)return {focus:'focus_craft',stage:craft.type==='wing'?'wing-chain':'loadout',reason:craft.type==='wing'?'มีสูตรปีกที่ตรวจแล้วและพร้อมทำจริง':'มีสูตรอ้างอิงและทรัพยากรพร้อม'};
 if(!promoted)return {focus:'focus_growth',stage:'class-build',reason:'พัฒนาเลเวลและอาชีพก่อนงานปลายทาง'};
 const thin=['weapon','armor','boots'].some(slot=>{const it=cat.items?.[save.equip?.[slot]];return !it||(it.reqLv||1)<Math.min(60,Math.max(1,(save.lv||1)*.5));});
 if(thin&&gear.length)return {focus:'focus_gear',stage:'loadout',reason:'แก้ชิ้นอุปกรณ์ที่ต่ำกว่าระดับก่อนเสี่ยงกิจกรรมใหญ่'};
 const wing=economy.ownedNames(save).some(id=>cat.items?.[id]?.slot==='wing');
 if(!wing&&cat.wingRecipes?.some(r=>r.verified))return {focus:'focus_craft',stage:'wing-chain',reason:'หาองค์ประกอบปีกตามสูตรและเงินสำรองที่ยืนยัน'};
 return null;
}
module.exports={STAGES,assess,MasteryMemory,focusFromState};
