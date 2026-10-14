'use strict';
const {digest}=require('../knowledge/encyclopedia');
const {context}=require('./context-learning');
const RULES=[
 {id:'wing-dependency',name:'ทำปีกพื้นฐานก่อนอัปขั้นสูง',domain:'crafting',kind:'verified_recipe_rule',metric:'minutes_to_owned_wing',cost:'สูตรที่ยืนยัน + เงินสำรอง'},
 {id:'shared-boss-materials',name:'รวมวัตถุดิบปีกกับอัป High Class ในแผนเดียว',domain:'crafting',kind:'planning_hypothesis',metric:'required_materials_per_hour',cost:'ห้ามใช้ชิ้นที่สำรองให้ขั้นอาชีพ'},
 {id:'matched-map-yield',name:'เลือกพื้นที่จากผลจริงของชุดและสกิลเดียวกัน',domain:'maps',kind:'observational_comparison',metric:'exp_per_hour_and_net_coins',cost:'ทดลองเส้นทางฟรี จำกัดเวลาและการตาย'},
 {id:'boss-window',name:'จัดเวลาบอสตามข้อมูลเกิดจริง',domain:'monsters',kind:'planning_hypothesis',metric:'boss_materials_per_playing_hour',cost:'ต้องอ่าน boss board ใหม่ก่อนเดินทาง'},
 {id:'sustainable-mana',name:'ลดเวลาขาด MP และค่าใช้ยา',domain:'classes',kind:'planning_hypothesis',metric:'damage_per_net_consumable_cost',cost:'ต้องวัด MP ยา และดาเมจด้วยกัน'},
 {id:'role-loadout',name:'เปรียบเทียบชุดแยกฟาร์ม บอส และฮีลทีม',domain:'items',kind:'planning_hypothesis',metric:'survival_and_damage_or_healing_per_hour',cost:'สลับเฉพาะของที่มี ห้ามฝังการ์ดหรือใช้เงินทดลอง'},
 {id:'party-role-drill',name:'ฝึกแทงก์ ฮีล และดาเมจพร้อมเงื่อนไขถอนตัว',domain:'systems',kind:'planning_hypothesis',metric:'completion_rate_deaths_and_rewards',cost:'ต้องมีข้อมูลเพื่อนร่วมทีมสดและผลดัน'},
 {id:'permanent-bonus',name:'ปลดล็อกสัตว์เลี้ยงและสมุดมอนที่ใกล้ครบ',domain:'systems',kind:'planning_hypothesis',metric:'permanent_bonus_per_travel_minute',cost:'ตรวจโบนัสก่อนและหลัง ห้ามถือว่าฆ่าแล้วปลดล็อก'},
];
function propose(i,book,{contexts=[],now=Date.now(),contextBuild=book.build}={}){
 const s=i.lastSave||i,fresh=i.lastSaveAt&&now-i.lastSaveAt>=0&&now-i.lastSaveAt<=30000;
 const signature=context(contextBuild,s);
 const compatible=contexts.filter(c=>c.build===contextBuild&&c.signature===signature&&c.samples>=10&&c.elapsedMs>=300000&&c.updatedAt<=now&&now-c.updatedAt<86400000&&c.deaths===0&&c.exp>0);
 const grouped=new Map();for(const c of compatible){const group=grouped.get(c.signature)||[];group.push(c);grouped.set(c.signature,group);}
 let comparison=null;for(const rows of grouped.values()){const sorted=[...rows].sort((a,b)=>b.exp/b.elapsedMs-a.exp/a.elapsedMs),best=sorted[0],base=sorted.find(r=>r.map!==best.map);if(base){const ratio=(best.exp/best.elapsedMs)/(base.exp/base.elapsedMs);comparison={baselineMap:base.map,candidateMap:best.map,relativeGain:ratio-1,baselineMinutes:base.elapsedMs/60000,candidateMinutes:best.elapsedMs/60000,baselineSamples:base.samples,candidateSamples:best.samples,status:ratio>=1.2?'observationally_supported':'no_clear_gain',causalVerified:false};break;}}
 return RULES.map(rule=>{const supported=rule.id==='wing-dependency'&&book.recipeValidation.verified===book.recipeValidation.wings&&book.recipeValidation.wings>0;const evidence=rule.id==='matched-map-yield'?comparison:null;return {...rule,id:digest([book.revision,i.character?.name||i.char||'unknown',rule.id]).slice(0,24),technique:rule.id,build:book.build,revision:book.revision,status:!fresh?'paused_stale_data':supported?'rule_verified':evidence?.status==='observationally_supported'?'observationally_supported':evidence?'no_clear_gain':'needs_experiment',evidence,budget:{maxDurationMs:900000,maxDeaths:1,maxSpend:0,minimumWindows:10,minimumObservedMs:300000},execution:rule.id==='matched-map-yield'?'existing_context_planner_only':'study_plan_requires_verified_adapter',stopConditions:['save เก่า','เกมเปลี่ยนเวอร์ชัน','เสียชีวิต','เงินต่ำกว่าเงินสำรอง','เข้า tw/dx/gd','เดินทางไม่ถึง'],sourceArticles:book.articles.filter(a=>a.domain===rule.domain).slice(0,3).map(a=>a.id)};});
}
module.exports={RULES,propose};
