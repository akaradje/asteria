'use strict';
const economy=require('../economy'),gear=require('../gear-value');
function blockedGear(id,save,cat){const item=cat.items[id];if(!item)return 'unknown';if(save.locks?.includes(id))return 'locked';if(item.uniqueBoss)return 'unique';if(item.slot==='wing')return 'wing';if(item.class3Only)return 'class3';if(Object.values(save.equip||{}).includes(id))return null;if(save.stage?.[id]>0)return 'stage';if(save.refine?.[id]>0)return 'refine';if(save.weaponOpts?.[id]?.some(Boolean))return 'enchant';if(save.sockets?.[id]?.length)return 'card';if(save.holes?.[id]>0)return 'holes';return null;}
function inventory(i,projectedWork){const s=i.lastSave;if(!s||!i.character?.name||typeof i.catalog!=='function')return null;const cat=i.catalog(),bag=(s.bag||[]).map(x=>typeof x==='string'?x:x.id),offers=[];
 for(const [index,id]of bag.entries()){if(require('../equipment-goal').policy(cat).enabled&&cat.items[id]?.rarity!=='legendary'||offers.some(x=>x.id===id)||blockedGear(id,s,cat)||gear.compare(s,cat,id).upgrade)continue;offers.push({id,index});}
 // Preserve accessory offers in the bounded payload: small stat numbers must
 // not hide the only item that can fill an empty slot behind 24 spare weapons.
 offers.sort((a,b)=>Number(cat.items[b.id]?.slot==='acc')-Number(cat.items[a.id]?.slot==='acc')||Math.max(cat.items[b.id]?.stats?.atk||0,cat.items[b.id]?.stats?.matk||0,cat.items[b.id]?.stats?.def||0)-Math.max(cat.items[a.id]?.stats?.atk||0,cat.items[a.id]?.stats?.matk||0,cat.items[a.id]?.stats?.def||0));
 const work=projectedWork||require('./team-workboard').project(i),board=i.teamWorkboard,now=Date.now();
 // A donor's unused craft ingredient was invisible when absent from its own
 // recipe. Publish only fresh current-build team requests, not old/foreign
 // workboards; selection still preserves every donor need and durable hold.
 const requested=!!board&&typeof cat.build==='string'&&cat.build.length>0&&board.build===cat.build&&Number.isFinite(board.at)&&now>=board.at&&now-board.at<30000?(board.demands||[]).slice(0,100).map(r=>r.name).filter(n=>typeof n==='string'&&n.length>0&&n.length<=120&&!['Copper','coins','tokens','runeDust'].includes(n)):[];
 const names=[...new Set([...work.needs.map(r=>r.name),...Object.keys(work.reserved),...requested,...require('../upgrade-reserve').cores,...(cat.wingRecipes||[]).filter(r=>r.verified).flatMap(r=>Object.keys(r.cost||{})).filter(n=>!['Copper','coins','tokens','runeDust'].includes(n)&&!Object.values(cat.items).some(x=>x.name===n&&x.slot==='wing'))])];
 const equipped=Object.values(s.equip||{}).filter(Boolean),pick=o=>Object.fromEntries(equipped.filter(id=>o?.[id]!=null).map(id=>[id,o[id]]));
 return {at:i.lastSaveAt,copper:require('./team-copper').budget(i),job:s.job,lv:s.lv,jobLv:s.jobLv,equip:s.equip||{},wings:economy.ownedNames(s).filter(id=>cat.items[id]?.slot==='wing'),stage:pick(s.stage),refine:pick(s.refine),weaponOpts:pick(s.weaponOpts),sockets:pick(s.sockets),holes:pick(s.holes),locks:(s.locks||[]).slice(0,40),bagFree:(cat.world.bagCap?.(s.bagTier||0)||0)-bag.length,offers:offers.slice(0,24),materials:Object.fromEntries(names.map(n=>[n,s.materials?.[n]||0])),storageMaterials:Object.fromEntries(names.filter(n=>Number.isInteger(s.storage?.materials?.[n])&&s.storage.materials[n]>0).slice(0,24).map(n=>[n,s.storage.materials[n]]))};
}
function wingRequirements(s,cat){if(!cat.root)return null;const wing=economy.wingPlan({job:s.job,lv:s.lv,materials:s.materials,coins:0,held:[...Object.values(s.equip||{}),...(s.wings||[])],world:cat.world,items:cat.items,wings:economy.loadWings(cat.root,cat.build),recipes:economy.loadWiki(cat.root)?.crafting?.recipes||[]});return wing?.recipeVerified?Object.fromEntries((wing.requirements||[]).map(r=>[r.name,r.want])):null;}
function offerKey(offer){return offer?.kind==='currency'?'currency:'+offer.donor+':'+offer.receiver:offer?.kind+':'+(offer?.id||offer?.name);}
function conflicts(offer,prior){
 if(offerKey(offer)!==offerKey(prior))return false;
 // A material ambiguity belongs to its two inventories, not every character
 // holding that material. Missing participant identity remains fleet-wide.
 if(offer.kind!=='material')return true;
 const actors=[prior.donor,prior.receiver];
 return actors.some(n=>typeof n!=='string'||!n)||actors.some(n=>n===offer.donor||n===offer.receiver);
}
function choose(members,cat,now=Date.now(),excluded=[]){
 const names=cat.hostTeam?.members?.map(m=>m.charName);if(Array.isArray(names))members=members.filter(m=>names.includes(m.charName));

 const valid=members.filter(m=>m.status==='playing'&&!m.recycling&&!m.actionOwner&&!(m.classSupport?.reservation?.expiresAt>now)&&m.goal?.kind!=='milestone-assist'&&m.teamInventory&&now-m.teamInventory.at>=-5000&&now-m.teamInventory.at<30000),choices=[];
 const mandatoryClass=cat.world.ASCEND?.open===true&&valid.some(m=>{
  const s=m.teamInventory;
  return cat.world.HIGH_CLASSES?.[economy.nextPromotion(s.job,cat.world)]&&s.lv>=cat.world.ASCEND.lv&&s.jobLv>=cat.world.ASCEND.jobLv&&Object.entries(cat.world.ASCEND.items||{}).some(([name,n])=>Number.isInteger(n)&&n>0&&(s.materials?.[name]||0)<n);
 });
 for(const donor of valid)for(const receiver of valid){if(donor.charName===receiver.charName)continue;const d={...donor.teamInventory,needs:donor.teamWork?.needs||donor.teamInventory.needs||[],reserved:donor.teamWork?.reserved||donor.teamInventory.reserved||{}},r={...receiver.teamInventory,needs:receiver.teamWork?.needs||receiver.teamInventory.needs||[],reserved:receiver.teamWork?.reserved||receiver.teamInventory.reserved||{}};
  const available=name=>require('./team-workboard').available({teamInventory:r},name);
  const cash=require('./team-copper'),unknownCash=excluded.some(o=>o?.kind==='currency'&&[o.donor,o.receiver].some(n=>n===donor.charName||n===receiver.charName));
  const cashDonorClass=cat.world.HIGH_CLASSES?.[economy.nextPromotion(d.job,cat.world)],donorNeedsClass=!!cashDonorClass&&d.lv>=cat.world.ASCEND?.lv&&d.jobLv>=cat.world.ASCEND?.jobLv;
  // Never shuttle a partial class fund between two unpromoted actors when
  // one market quote expires. Completed characters fund one receiver at a time.
  if(!unknownCash&&!(r.copper?.classFunding&&donorNeedsClass)&&cash.valid(d.copper)&&cash.valid(r.copper)&&d.copper.spare>0&&r.copper.need>0){
   const funding=r.copper.classFunding;
   // A class transfer can take a town trip. Leave another full 80-potion
   // replacement beyond the existing reserve so normal upkeep does not
   // invalidate the exact amount during gathering. Tiny class transfers
   // spend more time in navigation than they save toward the verified price.
   const available=Math.max(0,d.copper.spare-(funding?28000:0)),quantity=Math.min(available,r.copper.need,funding?1000000:100000);
   // A few hundred Copper cannot fund a refill but still owns both actors'
   // navigation and the single fleet trade queue. Amortize that trip and fund
   // an uncapped actor below its upkeep buffer before ordinary cash balancing.
   // This selects new offers only; an existing session/unknown receipt is kept.
   const minimum=funding?50000:10000,urgent=!funding&&r.lv<cat.world.MAX_LV&&r.copper.coins<r.copper.reserve+10000;
   if(quantity>=minimum)choices.push({donor:donor.charName,receiver:receiver.charName,kind:'currency',name:'Copper',quantity,...(funding?{classFunding:funding}:{}),priority:urgent?0.25:funding?.price?0.5:1,locality:donor.machine===receiver.machine?1:0,donorSpare:available,reason:urgent?'เติมทุนยาตัวที่ยังไม่ถึงเลเวลตันก่อนปรับสมดุลเงินปกติ; กันทุนและเสบียงผู้ให้':'แบ่ง Copper ซื้อยาและเดินหน้าคลาส/ปีก; กันเงินคลาส ปีกพร้อมคราฟ และเสบียงผู้ให้'});
  }
  const receiverClass=economy.nextPromotion(r.job,cat.world),receiverHigh=!!cat.world.HIGH_CLASSES?.[receiverClass],ascend=cat.world.ASCEND||{},promotionEligible=receiverHigh&&ascend.open===true&&r.lv>=ascend.lv&&r.jobLv>=ascend.jobLv,needs=receiverHigh?ascend.items:receiverClass?null:wingRequirements(r,cat),donorClass=economy.nextPromotion(d.job,cat.world),ownWing=wingRequirements(d,cat);
  for(const [name,want]of Object.entries(needs||{})){if(receiverHigh?!promotionEligible:r.lv<cat.world.MAX_LV)continue;const receiverNeed=Math.max(0,want-available(name));let keep=cat.world.HIGH_CLASSES?.[donorClass]?ascend.items?.[name]||0:promotionEligible?0:ownWing?.[name]||0;if(!promotionEligible&&!donorClass&&!ownWing)continue;
   keep=Math.max(keep,...(d.needs||[]).filter(n=>n.name===name&&n.kind!=='wing').map(n=>n.want));const quantity=Math.min(receiverNeed,Math.max(0,(d.materials[name]||0)-keep-(d.reserved?.[name]||0)));if(quantity&&!d.locks.includes(name))choices.push({donor:donor.charName,receiver:receiver.charName,kind:'material',name,quantity,priority:receiverClass?0:5,reason:receiverClass?'แกนบอสส่วนเกินหลังกันของเลื่อนคลาสผู้ให้ ช่วยผู้รับเลื่อนคลาสก่อนปีก':'วัตถุดิบปีกส่วนเกินหลังกันสูตรปีกผู้ให้ ตามขั้น prerequisite ที่ผู้รับยังขาด'});
  }
  for(const need of r.needs||[]){if(['class','wing'].includes(need.kind))continue;const name=need.name,short=Math.max(0,need.want-available(name)),keep=Math.max(ownWing?.[name]||0,cat.world.HIGH_CLASSES?.[donorClass]?ascend.items?.[name]||0:0,...(d.needs||[]).filter(n=>n.name===name).map(n=>n.want)),quantity=Math.min(short,Math.max(0,(d.materials[name]||0)-keep-(d.reserved?.[name]||0)));if(quantity&&!d.locks.includes(name))choices.push({donor:donor.charName,receiver:receiver.charName,kind:'material',name,quantity,priority:need.priority-(receiver.teamWork?.carry?.actorId===receiver.identity?.actorId&&receiver.teamWork?.carry?.build===cat.build&&receiver.teamWork?.carry?.host===receiver.machine&&receiver.teamWork?.carry?.deadline>now?2:0),reason:'Verified quest/craft demand; preserve donor resources'});}for(const item of Number.isFinite(r.bagFree)&&r.bagFree>=2?d.offers:[]){if(r.locks.includes(item.id)||(r.stage?.[item.id]||0)>0||(r.refine[item.id]||0)>0||(r.holes[item.id]||0)>0||r.sockets[item.id]?.length||r.weaponOpts[item.id]?.some(Boolean))continue;const comparison=gear.compare(r,cat,item.id);if(!comparison.upgrade)continue;choices.push({donor:donor.charName,receiver:receiver.charName,kind:'gear',id:item.id,index:item.index,name:cat.items[item.id].name,quantity:1,gain:comparison.gain,goalPromotion:comparison.goalPromotion,priority:!r.equip?.[comparison.slot]?7:10,reason:comparison.goalPromotion?'เปลี่ยนเป็น Legendary ตามเป้าหมาย; คะแนนชุดประมาณอาจลดระหว่างเก็บเซต':!r.equip?.[comparison.slot]?'เติมช่องว่างผู้รับด้วยของส่วนเกินที่ไม่ลดชุดผู้ให้':'ค่าสเตตัสทั้งชุดตามบทบาทเพิ่ม ไม่ลดของผู้ให้'});}
 }
 // Class materials and upkeep have priority over optional wing/gear trades.
 // This affects new plans only; already dispatched native sessions retain
 // their original receipts, deadlines and unknown-payment reconciliation.
 choices.sort((a,b)=>a.priority-b.priority||(b.locality||0)-(a.locality||0)||(b.donorSpare||0)-(a.donorSpare||0)||Number(!!b.goalPromotion)-Number(!!a.goalPromotion)||(b.gain||0)-(a.gain||0));return choices.find(x=>!excluded.some(q=>conflicts(x,q))&&(!mandatoryClass||x.kind==='currency'||x.kind==='material'&&x.priority===0))||null;
}
function exactOffer(side,offer,isDonor){const coins=isDonor&&offer.kind==='currency'?offer.quantity:0,limit=require('./team-copper').validClassFunding(offer.classFunding,offer.classFunding?.quoteAt)?1000000:100000;if(offer.kind==='currency'&&(offer.name!=='Copper'||!Number.isSafeInteger(offer.quantity)||offer.quantity<=0||offer.quantity>limit))return false;if(!side||side.coins!==coins||!Array.isArray(side.gear)||!Array.isArray(side.stacks))return false;const gearIds=isDonor&&offer.kind==='gear'?[offer.id]:[],stacks=isDonor&&offer.kind==='material'?[[offer.name,offer.quantity]]:[];return JSON.stringify(side.gear)===JSON.stringify(gearIds)&&JSON.stringify(side.stacks)===JSON.stringify(stacks);}
module.exports={blockedGear,inventory,choose,exactOffer,offerKey,conflicts};
