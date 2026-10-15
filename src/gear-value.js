'use strict';
const economy=require('./economy');
const add=(a,b)=>{for(const[k,v]of Object.entries(b||{}))if(Number.isFinite(v))a[k]=(a[k]||0)+v;};
const elem={'ไฟ':'str','ลม':'agi','ดิน':'vit','น้ำ':'int','ไม่มีธาตุ':'dex','อันเดด':'dex','ผี':'luk','มืด':'luk'};
function card(id,world){
 if(world?.isAccCard?.(id))return {slot:'acc',acc:true,T:world.cardMonster?.(id),stats:world.accCardBonus(id),trait:{}};
 const mons=world?.MONSTERS||[],m0=world?.cardMonster?.(id),n=m0?mons.indexOf(m0):mons.findIndex(m=>m.id===id);if(n<0)return null;
 const m=mons[n],slot=['weapon','armor','head','boots'][n%4],k=m.kind==='boss'?3:m.kind==='miniboss'?2:1,L=m.level;
 const stats=slot==='weapon'?{atk:Math.round((4+L*.5)*k),matk:Math.round((4+L*.5)*k)}:slot==='armor'?{hp:Math.round(L*8*k)}:slot==='head'?{['st_'+(elem[m.element]||'dex')]:(1+Math.floor(L/30))*k}:{flee:Math.round((3+L*.25)*k)};
 if(typeof world.cardRace==='function')Object.assign(stats,world.cardRace(m,slot));else{if(k>1)stats.crit=.01*k;if(slot==='weapon')stats['race_'+(world.raceKey?.(m.race)||m.race)]=[0,.10,.15,.20][k];if(slot==='boots')stats['rres_'+(world.raceKey?.(m.race)||m.race)]=[0,.08,.12,.16][k];}
 const scale=o=>typeof world.scaleCard==='function'?world.scaleCard(o,id):o;
 return {slot,T:m,stats:scale(stats),trait:scale(world.cardTrait?.(m)||{})};
}
function album(id,world){const c=card(id,world),out={};if(!c)return null;if(c.acc){for(const[k,v]of Object.entries(c.stats))out[k]=v<1?Math.round(v*.25*200)/200:Math.max(1,Math.round(v*.1));return out;}for(const[k,v]of Object.entries(c.stats))if(k!=='crit'&&!k.startsWith('race_')&&!k.startsWith('rres_'))out[k]=Math.max(1,Math.round(v*.1));const k=c.T.kind==='boss'?2:c.T.kind==='miniboss'?1:0;if(k){if(c.slot==='weapon')out.dmgPct=.01*k;else if(c.slot==='armor')out.hpPct=.01*k;else if(c.slot==='boots'){out.crit=.005*k;out.critDmg=.02*k;}else for(const key in out)if(key.startsWith('st_'))out[key]=Math.max(out[key],k+1);}return out;}
const bookElem={...elem,'สายฟ้า':'str','ดวงดาว':'int','พิษ':'agi','ศักดิ์สิทธิ์':'dex'};
function pet(id,bond,world){const m=world.getMonster?.(id)||world.MONSTERS?.find(m=>m.id===id);if(!m)return null;const tier=[0,100,300,600,1000].filter(t=>bond>=t).length,st=bookElem[Object.fromEntries(world.ELEMENTS||[])[world.elementKey?.(m.element)]||m.element]||'dex',out={['st_'+st]:tier*(m.kind==='normal'?1:2)},perks={str:{atk:3},dex:{atk:2,hit:2},agi:{flee:2,crit:.003},int:{matk:3},vit:{hp:40,def:1},luk:{crit:.006}};for(const[k,v]of Object.entries(perks[st]))out[k]=k==='crit'?+(v*tier).toFixed(3):Math.round(v*tier*(1+Math.floor(m.level/25)));return out;}
function totals(save,cat,equip=save.equip||{}){
 const stats={},parts=[],unknown=[],traits={};
 for(const[slot,id]of Object.entries(equip)){
  if(!id)continue;const it=cat.items[id];if(!it){unknown.push(id);continue;}
  add(stats,it.stats);const tier=Math.max(0,Math.min(5,(it.tier||1)-1)),lv=Math.max(0,Math.min(cat.world?.REFINE?.max??10,save.refine?.[id]||0)),flat=Math.min(lv,cat.world?.REFINE_HIGH?.from??10);
  const stage=save.stage?.[id]||0;
  if(stage>0){if(cat.world?.FORGE?.canStage?.(it)&&typeof cat.world.FORGE.stageBonus==='function')add(stats,cat.world.FORGE.stageBonus(it,stage));else unknown.push('stage:'+id);}
  const key=it.slot==='weapon'?(it.stats?.matk?'matk':'atk'):it.slot==='acc'?(it.line==='cloth'?'matk':it.line==='light'?'atk':'def'):it.kind==='grimoire'?'matk':['quiver','talisman'].includes(it.kind)?'atk':'def';
  if(slot==='wing'){
   if(require('./knowledge/refine-capability').support(slot,cat.world).state==='supported'){const wing=flat*[1,2,2,3,4,5][tier];add(stats,{atk:wing,matk:wing});}
   else if(lv)unknown.push('wing-refine:'+id);
  }else add(stats,{[key]:flat*(slot==='weapon'?[2,3,4,6,8,10]:(slot==='offhand'||it.slot==='acc')&&key!=='def'?[1,2,2,3,4,5]:[1,1,2,2,3,4])[tier]});
  if(lv>flat){if(typeof cat.world?.refineHigh==='function')add(stats,cat.world.refineHigh(it,key,lv));else unknown.push('high-refine:'+id);}
  if(['weapon','armor','head','boots'].includes(slot))for(const o of save.weaponOpts?.[id]||[])if(o)add(stats,{[o.k]:o.v});
  const sockets=save.sockets?.[id];for(const c of Array.isArray(sockets)?sockets:sockets?[sockets]:[]){if(!c)continue;const found=card(c,cat.world);if(found?.slot===slot||slot.startsWith('acc')&&['acc','head','boots'].includes(found?.slot)){add(stats,found.stats);add(traits,found.trait);}else if(!found)unknown.push('card:'+c);}
  parts.push({slot,id,refine:lv});
 }
 const sets={leaf:{pieces:['leaf_hood','leaf_mail','leaf_boots'],bonus:{2:{hp:50},3:{def:6,spd:.1}}},iron:{pieces:['iron_helm','iron_plate','iron_greaves'],bonus:{2:{def:6},3:{hp:100}}},...cat.world?.EQUIPMENT_SETS};
 const bonuses=[];for(const[id,set]of Object.entries(sets)){const n=(set.pieces||[]).filter(p=>Object.values(equip).includes(p)).length;for(const[count,bonus]of Object.entries(set.bonus||{}))if(n>=+count){add(stats,bonus);bonuses.push(id+':'+count);}}
 for(const[k,v]of Object.entries(traits))add(stats,{[k]:Math.min(cat.world?.CARD_TRAIT_CAP?.[k]??Infinity,v)});
 for(const id of Object.keys(save.cardAlbum||{})){if(!save.cardAlbum[id])continue;const b=album(id,cat.world);if(b)add(stats,b);else unknown.push('album:'+id);}
 for(const id of new Set([...Object.keys(save.bestiary||{}),...Object.keys(save.accountBestiary||{})])){const m=cat.world?.getMonster?.(id)||cat.world?.MONSTERS?.find(m=>m.id===id);if(!m)continue;const elite=m.kind!=='normal',n=(save.bestiary?.[id]||0)+(save.accountBestiary?.[id]||0);if(n>=(elite?1:30))add(stats,{['st_'+(bookElem[m.element]||'dex')]:elite?2:1});if(n>=(elite?10:150))add(stats,{hp:m.level*(elite?2:1)});}
 const mastery=cat.world?.REFINE_MASTERY;
 if(mastery&&typeof cat.world?.refineMastery==='function'&&cat.world.refineMastery(equip,id=>save.refine?.[id]||0)>=mastery.need){add(stats,mastery.bonus);bonuses.push('refine-mastery');}
 const stars=Object.entries(cat.world||{}).filter(([key,value])=>/^REFINE_STAR(?:[0-9]+)?$/.test(key)&&Array.isArray(value?.slots)&&Number.isSafeInteger(value.lv)&&value.bonus);
 for(const [name,star]of stars)if(star.slots.length&&star.slots.every(slot=>equip[slot]&&(save.refine?.[equip[slot]]||0)>=star.lv)){add(stats,star.bonus);bonuses.push(name==='REFINE_STAR'?'refine-star':'refine-star-'+star.lv);}
 if(save.astral){if(typeof cat.world?.astralBonus==='function'){const bonus={...cat.world.astralBonus(save.astral,save.job)};delete bonus.astralExp;add(stats,bonus);bonuses.push('astral-board');}else unknown.push('astral-rules');}
 if(save.premiumRulesInput){const p=require('./knowledge/modifier-effects').premium(save.premiumRulesInput.state,cat.world,{at:save.premiumRulesInput.at});add(stats,p.stats);unknown.push(...p.unknown);bonuses.push(...p.sources.map(x=>x.kind));}
 if(save.guildRunesInput){if(typeof cat.world?.GUILD?.runeBonus==='function')add(stats,cat.world.GUILD.runeBonus(save.guildRunesInput));else unknown.push('guild-rune-rules');}
 if(save.petActive&&Object.hasOwn(save.pets||{},save.petActive)){const b=pet(save.petActive,save.pets[save.petActive],cat.world);if(b)add(stats,b);else unknown.push('pet:'+save.petActive);for(const o of save.petOpts?.[save.petActive]||[])if(o)add(stats,{[o.k]:o.v});}
 const chain=economy.jobChain(save.job,cat.world),magic=chain.includes('mage')||chain.includes('priest'),tank=chain.includes('knight'),healer=chain.includes('priest');
 const weights={atk:magic?.1:1.5,matk:magic?1.5:.1,hp:tank?.06:.025,mp:.015,def:tank?1.2:.5,crit:150,critDmg:70,dmgPct:200,bossDmg:100,aspdPct:magic?30:120,damageReduction:200,healBonus:healer?200:10,hpRegen:1,hit:.5,flee:.4,spd:3};
 if(save.developmentDefensive)for(const key of ['hp','def','damageReduction'])weights[key]*=1.5;
 const conditional=require('./knowledge/modifier-effects').conditionalSkills(stats,cat.world,{job:save.job});unknown.push(...conditional.unknown.map(k=>'conditional:'+k));
 let score=0;for(const[k,v]of Object.entries(stats)){if(k.startsWith('sk_')||k.startsWith('rs_')||['atkPct','matkPct','hpPct','defPct'].includes(k))continue;score+=k.startsWith('st_')?economy.score({stats:{[k]:v}},save.job,cat.world):v*(weights[k]??(k.startsWith('race_')||k.startsWith('rres_')?20:.1));}
 for(const key of ['atk','matk','hp','def'])if(Number.isFinite(stats[key+'Pct']))score+=Math.max(0,stats[key]||0)*stats[key+'Pct']*(weights[key]||0);
 return {score:Math.round(score*100)/100,stats,parts,sets:bonuses,unknown,conditional,method:'weighted_loadout_not_measured_dps'};
}
function compare(save,cat,id){
 const it=cat.items[id],before=totals(save,cat),goal=require('./equipment-goal').policy(cat);
 const owned=economy.ownedNames(save).includes(id)||(save.storage?.gear||[]).some(g=>g.id===id&&!g.lk&&!g.up);
 const firstWing=owned&&it?.slot==='wing'&&!save.equip?.wing;
 const bridge=goal.enabled&&(firstWing||goal.top10Progression&&goal.bridgeOwned)&&owned&&it?.rarity!==goal.rarity&&it?.rarityEvidence!=='unknown';
 if(!it||!economy.canUse(it,save.job,cat.world)||(it.reqLv||1)>(save.lv||1)||goal.enabled&&!goal.dynamicProgression&&it.rarity!==goal.rarity&&!bridge||Object.values(save.equip||{}).includes(id))return {upgrade:false,gain:0,before};
 const empty=it.slot==='acc'?['acc1','acc2'].find(k=>!save.equip?.[k]):null;
 const slots=it.slot==='acc'?(empty?[empty]:['acc1','acc2']):[it.slot];
 const choices=slots.filter(slot=>goal.dynamicProgression||!bridge||cat.items[save.equip?.[slot]]?.rarity!==goal.rarity).map(slot=>({slot,empiricalPolicy:require('./planning/theorycraft').preference(save,cat,{...save.equip,[slot]:id}),goalPromotion:!!(goal.enabled&&!goal.dynamicProgression&&it.rarity===goal.rarity&&cat.items[save.equip?.[slot]]?.rarity!==goal.rarity),after:totals(save,cat,{...save.equip,[slot]:id})})).sort((a,b)=>Number(!!b.empiricalPolicy)-Number(!!a.empiricalPolicy)||(goal.top10Progression||goal.dynamicProgression?b.after.score-a.after.score:Number(b.goalPromotion)-Number(a.goalPromotion)||b.after.score-a.after.score));
 if(!choices.length)return {upgrade:false,gain:0,before};
 const {slot,after,goalPromotion,empiricalPolicy}=choices[0];
 return {slot,before,after,gain:after.score-before.score,empiricalPolicy,goalPromotion,bridge:!!bridge,upgrade:!before.unknown.length&&!after.unknown.length&&(!!empiricalPolicy||(goalPromotion&&!goal.top10Progression)||after.score>before.score+.01),reason:empiricalPolicy?'promoted matched native combat windows; estimated stat gain remains separate':bridge?'owned interim upgrade; native combat objective remains incomplete':goal.top10Progression?'Top 10 progression requires a positive whole-loadout estimate':goalPromotion?'Legendary equipment goal; estimated stats may decrease until the full set is acquired':'positive weighted loadout estimate'};
}
module.exports={totals,compare,card,album,pet};
