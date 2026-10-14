'use strict';
// These descriptors are discovery/index contracts, not permission to execute.
const domains=[
 ['class',['MAX_LV','HIGH_CLASSES','ASCEND'],['train','promote']],
 ['combat',['ELEMENTS','RACES','elementMultiplier'],['measure_damage']],
 ['skills',['SK_COMBO','LINK','INTERRUPT','CHARGE'],['learn','combo']],
 ['survival',['SELF_HEAL','SOLO','TANK_HEAL_K','GUARD'],['sustain']],
 ['drops',['MONSTERS','MONSTER_SKILLS','rollDrops'],['farm']],
 ['boss',['BOSS_MOVES','BOSS_RAGE'],['rally','fight']],
 ['travel',['MAPS','REGIONS','canEnterMap','TELE'],['navigate']],
 ['equipment',['EQUIPMENT','EQUIPMENT_SETS','ACC_SETS'],['equip']],
 ['forge',['REFINE','REFINE_HIGH','REFINE_STAR','FORGE'],['refine','stage','forge']],
 ['transfer',['TRANSFER','SCRAP','SCRAP_SHOP'],['transfer','dismantle']],
 ['cards',['CARD_GRADE','HC_RANK','maxHoles','cardTradable'],['insert','withdraw','grade']],
 ['pets',['PET_OPTIONS','PET_EVOLVE','PET_LEVEL'],['activate','evolve','options']],
 ['wings',['WING','wingRecipes'],['craft','equip']],
 ['astral',['ASTRAL'],['points','breakthrough']],
 ['quests',['QUEST','workOrderMessage'],['accept','turn_in']],
 ['achievements',['ACHIEVE','ACH_CATS','COSTUME_BOOK'],['claim','collect']],
 ['guild',['GUILD','party','guild'],['join','develop']],
 ['activities',['dungeonMessage','towerMessage'],['enter','complete','claim']],
 ['pvp',['PVP_SKILL','PVP_WAR','PVP_EVENT','PK'],['register','fight']],
 ['market',['marketMessage','mkSend'],['query','history','list','buy','cancel','claim']],
 ['premium',['PREMIUM_TRADABLE','VIP_CARD','GACHA','LOGIN_TICKETS'],['free_claim','gacha']],
 ['side_activities',['FISHING','FIELD_BOX','MENTOR'],['fish','open','mentor']],
 ['build_lab',['buildMessage','btenter'],['query','enter','set','exit','field_validate']],
 ['runtime',['BAG_PRICES','STORE_PRICES'],['capacity','recovery']]
];
function compile({client='',world='',network='',build}={}){
 const sources={client,world,network},rows=domains.map(([domain,symbols,actions])=>{
  const references=[];
  for(const symbol of symbols){const expression=new RegExp('\\b'+symbol+'\\b','g');for(const [source,text]of Object.entries(sources)){const m=expression.exec(text);expression.lastIndex=0;if(m)references.push({symbol,source,offset:m.index});}}
  return {id:'atlas:'+domain,domain,build,level:references.length?'DISCOVERED':'UNKNOWN',references,capabilities:actions.map(action=>({id:domain+'.'+action,state:'NATIVE_CONTRACT_NOT_VERIFIED',executable:false})),unresolved:['native eligibility','resource/fee model','receipt semantics','role benefit'],runtimeVerified:false};
 });
 return {version:1,build,domainCount:rows.length,rows,fullyKnown:false};
}
module.exports={domains,compile};
