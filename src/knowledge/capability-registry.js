'use strict';
const crypto=require('node:crypto');
// Discovery and implementation review are separate facts. A source marker never approves an action.
const SPECS={
 travel:{rules:['MAPS','canEnterMap'],actions:['chainWalkTo','returnToTown'],effects:['position'],risk:'navigation'},
 storage:{rules:['bagCap','storeCap','STORE_PRICES'],actions:['gearDeposit'],effects:['bag','personalStorage'],risk:'equipment'},
 class:{rules:['HIGH_CLASSES','HC_MERGED','ASCEND'],actions:['advanceJob'],effects:['job','skills'],risk:'paid'},
 craft:{rules:['EQUIPMENT','FORGE'],actions:['craftAtExchange'],effects:['inventory','currency'],risk:'paid'},
 refine:{rules:['REFINE','REFINE_HIGH','REFINE_STAR','refineHigh','refineStar'],actions:['refineEquipped'],effects:['item','currency'],risk:'paid'},
 astral:{rules:['ASTRAL','astralPts','astralNeed','astralBonus','astralWbGate','astralBossGate','astralWbTopGate'],actions:['aspt','asbt','asrst'],effects:['star','points','inventory','currency'],actionEffects:{aspt:['points'],asbt:['star','inventory','currency'],asrst:['points','currency']},risk:'paid'},
 pets:{rules:['MONSTERS','ELEMENTS','elementKey'],actions:['petActive','petOptions'],effects:['activePet','stats'],risk:'paid'},
 transfer:{rules:['TRANSFER'],actions:['transfer'],effects:['sourceItem','destinationItem','currency'],risk:'paid'},
 cards:{rules:['CARD_GRADE','CARD_TRAIT_CAP','scaleCard','cardTrait'],optionalRules:['HC_SKILL_PCT','HC_SKILL_CAP','HC_RANK','HC_RANK_OF','hcRankSkill','skillCardPct','skillResPct','hcSkillCard','hcResistCard','accCardBonus','cardRace','cardLvK'],actions:['card'],effects:['sockets','inventory','stats'],risk:'paid'},
 collection:{rules:['COSTUME_BOOK','costumeBookStats'],actions:['bookDeposit','bookWithdraw'],effects:['book','inventory','stats'],risk:'equipment'},
 guild:{rules:['GUILD'],actions:['guildDungeonStart'],effects:['quota','run','reward'],risk:'quota'},
 skills:{rules:['SK_COMBO'],actions:['learnSkills'],effects:['skillPoints','skills'],risk:'points'},
 achievements:{rules:['ACHIEVE'],actions:['achievementClaim'],effects:['claim','inventory'],risk:'claim'},
 mail:{rules:[],actions:['mailClaim'],effects:['claim','inventory'],risk:'claim'},
 boosts:{rules:['PREMIUM_CONS','VIP_BOOST'],actions:['consume'],effects:['inventory','timedBonus'],risk:'consumption'},
 premium:{rules:['PREMIUM_BY_ID','PREMIUM_SETS','PREMIUM_SLOTS'],actions:['premiumEquip'],effects:['worn','stats'],risk:'equipment'}
};
function encode(v,depth=0){if(depth>20)throw Error('Native rules exceed fingerprint depth');if(typeof v==='function')return {nativeFunction:v.toString()};if(Array.isArray(v))return v.map(x=>encode(x,depth+1));if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,encode(v[k],depth+1)]));return v;}
const discoveries=new WeakMap();
function registry(cat,options){
 if(!options&&cat&&discoveries.has(cat))return discoveries.get(cat);
 const {reviews={},outcomes={}}=options||{},world=cat?.world||{};const result=Object.fromEntries(Object.entries(SPECS).map(([id,s])=>{
  const client=cat?.nativeClientContracts?.[id],missing=s.rules.filter(k=>world[k]==null),data=Object.fromEntries([...s.rules,...(s.optionalRules||[])].map(k=>[k,encode(world[k])])) ;if(id!=='travel'&&(!client?.revision||client.state==='UNKNOWN'))missing.push('native_client_handler');const revision=crypto.createHash('sha256').update(JSON.stringify([id,data,client?.revision||null])).digest('hex');
 const attestation=reviews[id],unchanged=attestation?.allowUnchangedNativeRevision===true&&/^[a-f0-9]{64}$/.test(cat.nativeTransportRevision||'')&&attestation.transportRevision===cat.nativeTransportRevision;
 const reviewed=attestation?.revision===revision&&(attestation.build===cat.build||unchanged)&&attestation.checksPassed===true;
  const contracts=Object.fromEntries(s.actions.map(action=>{const effects=s.actionEffects?.[action]||s.effects,risk=action==='petActive'?'equipment':s.risk,r=reviews[id]?.actions?.[action],o=outcomes[id]?.actions?.[action],ready=reviewed&&r?.checksPassed===true&&r.revision===revision,verified=ready&&o?.revision===revision&&o.build===cat.build&&['server_socket','server_readback'].includes(o.authority)&&o.confirmed===true&&typeof o.receiptId==='string'&&effects.every(effect=>o.effects?.includes(effect));return [action,{action,build:cat.build,revision,state:missing.length?'UNKNOWN':verified?'VERIFIED':ready?'READY':'DISCOVERED',inputs:{identity:'native_actor_session_generation',data:'fresh_complete_domain_state',rules:'matching_domain_revision',budget:['bookDeposit','bookWithdraw'].includes(action)?'owned_costume_no_currency_cost':action==='petActive'?'owned_pet_no_currency_cost':action==='aspt'?'no_currency_or_item_cost':s.risk==='navigation'?'not_paid':'integer_unreserved_native_bill'},reads:s.rules,resourceEffects:effects,outcome:{required:effects,authority:['server_socket','server_readback'],exactAttempt:true},risk,dependencies:['identity','current_rules','single_executor',...(s.risk==='navigation'?[]:['durable_intent','resource_claim'])],cancellation:s.risk==='navigation'?'positive_settled_navigation':'only_before_dispatch; reconcile_unknown_after_dispatch',retry:'no_replay_without_exact_not_applied_receipt',actionsEnabled:verified}];}));
  const verified=Object.values(contracts).every(c=>c.state==='VERIFIED');
  return [id,{version:2,id,build:cat?.build||null,revision,...s,contracts,missing,discovered:!missing.length,state:missing.length?'UNKNOWN':verified?'VERIFIED':reviewed?'READY':'DISCOVERED',reviewEvidence:reviewed?{build:attestation.build,transportRevision:attestation.transportRevision||null,reused:attestation.build!==cat.build,scope:'same checked source; exact native domain and transport bytes; historical outcomes are not current build proof'}:null,actionsEnabled:verified,invalidationScope:id,outcomeRequired:s.effects}];
 }));if(!options&&cat)discoveries.set(cat,result);return result;
}
function changed(previous,current){return Object.keys(current).filter(k=>previous?.[k]?.revision!==current[k].revision);}
module.exports={SPECS,registry,changed,encode};
