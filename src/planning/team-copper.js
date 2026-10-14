'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),reviewed=new Map();
// Reviewed native troffer/trstate/tradeApply: exact Copper, no fee, server
// revision followed by the ordinary native save. New builds require review.
const releases={'7a4a3700':{
 'asteria-online-visual-polish.html':'c367a9bb87a1a7771189c05409073a362fc1beb008792053d74844304718690a',
 'asteria-net.js':'d9f1ededc86eca56017ac3e6d2227835981f45d0637bd2cdc8f447c90ac2e759'
},'23b2077b':{'asteria-online-visual-polish.html':'88a3aba3375debb80ad79e59f6c5ce7f911fa7efc4ccbf9508023497a78be616','asteria-net.js':'46c7ffd89a61f548fd3c203fe255ba752e4a84b7479516494386f7c95c029248'},'46a8d74e':{'asteria-online-visual-polish.html':'496bfeca53f529551f76abef34533bd6eed00af28da603e66fd31959db190d69','asteria-net.js':'46c7ffd89a61f548fd3c203fe255ba752e4a84b7479516494386f7c95c029248'},'5e3eefcf':{'asteria-online-visual-polish.html':'75ffe8539270e80be768884c2a4da41636244e753a25187ac098007a4580d625','asteria-net.js':'46c7ffd89a61f548fd3c203fe255ba752e4a84b7479516494386f7c95c029248'}};
// Full23->34 client diff adds one Drowned Wraith animation entry only.
releases['34fdd4a8']={'asteria-online-visual-polish.html':'9b9a4b2a44c4de559f78f506b425f1b1710d44be52a5060d91261e4b59a48953','asteria-net.js':'46c7ffd89a61f548fd3c203fe255ba752e4a84b7479516494386f7c95c029248'};
// Reviewed full7ba->375 diff: client restores activity after normal reload;
// network only clears its local play marker on logout/switch/kick. Native
// trade, save/revision/payment handling and world bytes remain unchanged.
releases['375b4860']={'asteria-online-visual-polish.html':'d2b216c156e3be7e48861df9177e442c98b80075cb570189d0ca688642c8691a','asteria-net.js':'f6a96bb8aaa75a0838797b9f2a6c8a0579047d3340961febfedf20e3c1ed237c','asteria-world-system.js':'0cff990c9ef597abf4e523036c55d6675bc74ca1f0c13baf0480698d00122e22'};
// Reviewed375->dac: resume markers and bounded sign-in retry only; full native
// trade block and world bytes unchanged. Currency still requires all three
// capability hashes below, not merely this build's version number.
const reviewedNetworks=new Set(['46c7ffd89a61f548fd3c203fe255ba752e4a84b7479516494386f7c95c029248','f6a96bb8aaa75a0838797b9f2a6c8a0579047d3340961febfedf20e3c1ed237c','d61cb69918bd1ed04e4ceab2fda8c947e09478fa437a2c85dcacd70de1cc9b72']);
// Reviewed dac->49f world diff only adds Astral data/title. High Class rules,
// items, costs and native trade/save protocol are unchanged. This permits
// existing Copper transfers; it does not authorize Astral paid actions.
const reviewedWorlds=new Set(['0cff990c9ef597abf4e523036c55d6675bc74ca1f0c13baf0480698d00122e22','ac01875bceed07ac268be9b545266113f8861fc9087fde908410d346cb7409e4']);
// Reviewed 49f->786: network adds PWA install UI only; world changes combat
// skills/exports, not currency, inventory costs or native trade/save handling.
// The complete trade-section hash remains mandatory; Astral paid actions are
// outside this capability. Unknown future network/world bytes remain blocked.
reviewedNetworks.add('a52c38d76f9565ac8d08d114f9e69e4e934d98591f6c3eb85bf847a0e75d0095');
reviewedWorlds.add('a936ca9926919ae85853534b6edcfac9724c0c9dab7cc4a6869ba61719e9a072');
// Reviewed786->c59: HIDE no longer slows movement; only that world constant,
// its skill description and movement multiplier changed. Trade/save unchanged.
reviewedWorlds.add('76edadb9641f589dae56abab64e804664afa73f5ba7acc77067be90a865f79bd');
// Reviewed full 9b->7497 world diff: adds star/pet-option transfer tickets and
// their material costs only. Entire native player-trade section and network
// bytes are unchanged. This approves existing Copper trade, not these new
// paid transfer capabilities; all three exact capability hashes still apply.
reviewedWorlds.add('450deb4c0bca50236ed6613d6e4b2887bd0711272e308078454945b71d52a3b8');
// Entire 7497->8123 world diff permits stars on unique boss headgear only.
// Copper trade uses the same complete native trade section and network bytes;
// this exact hash approves Copper only, not a new paid star operation.
reviewedWorlds.add('58bafebe8793a89f5aca51d304d77bca7f047c0e2c0237535b737be254d51d23');
// 812355ce -> 3736635e: reviewed the complete forty-line world diff: Shield
// Charge/combo, PvP soft cap/war healing, guard/reflect and exports. Native trade
// block, save/network bytes and wallet/item rules remain unchanged. This admits
// Copper only; it does not approve new combat, star or premium mutations.
reviewedWorlds.add('e7ca75467fdee209977cc70ee730bdbf275ebfd4b54ca74e5b13cc083d38949c');
// cda2c84d: full 101-line world diff reviewed, changes are card skill/resist
// traits, accessory level scaling and stronger field bosses. Trade block,
// network and payment/output kernels are exact matches. Copper only.
reviewedWorlds.add('6613b5fbac2e9ee7d7837dde3ac62371b28f603da772e4899d20353a3e5bcefa');
// cda -> b9: complete world diff changes only High Class card rank maps,
// capped skill/guard aggregation and their exports. Native trade block and
// network hashes still match exactly; currency/item costs are unchanged.
// This admits Copper only, not a new card/socket/paid upgrade adapter.
reviewedWorlds.add('62b59580a272ea68f526590ce532a7b84034fc0c65dbc8fd742506c00c755c31');
// Full b9 -> bea diff reviewed: private Build Lab and NET.block/saveClean only.
// Trade section is byte-identical. Sandbox save blocking is preserved; this
// admits existing Copper trade, never Build Lab entry or its paid fees.
reviewedWorlds.add('966af197fc4c7d5c8207dc096cf31e3adcebe20cc718dc2e4eb2208845ec47fa');
reviewedNetworks.add('7813bc6ee1aaae476dc7b0b341b79c6a6a6d53ec6c8521073b6be5d33dc4d97d');
function nativeTradeSection(body){
 const start='/* ---------- online: player trade ---------- */',end='  let netVersion =';
 const a=body.indexOf(start),b=body.indexOf(end);
 if(a<0||b<=a||body.indexOf(start,a+start.length)!==-1||body.indexOf(end,b+end.length)!==-1)return null;
 return crypto.createHash('sha256').update(body.slice(a,b)).digest('hex');
}
function sourceReviewed(i){
 if(i.v2?.sourceCoherence?.matches!==true||!i.root)return false;
 const release=releases[i.catalog().build];
 if(!release)try{
  const base=path.join(i.root,'cache',i.catalog().build,'asteria-online.io');
  // Reuse the reviewed currency capability only when the entire native trade
  // implementation, network and world bytes are unchanged. A cosmetic build
  // number alone cannot invalidate it or approve changed payment code.
  return nativeTradeSection(fs.readFileSync(path.join(base,'asteria-online-visual-polish.html'),'utf8'))==='90eefdd749b20250ae76f18df85862fe8e911f5c989ac05ebaaa9ba3b474d8ab'
   &&reviewedNetworks.has(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'asteria-net.js'))).digest('hex'))
   &&reviewedWorlds.has(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'asteria-world-system.js'))).digest('hex'));
 }catch{return false;}
 try{for(const [name,expected]of Object.entries(release)){
  const file=path.join(i.root,'cache',i.catalog().build,'asteria-online.io',name),s=fs.statSync(file),key=file+':'+s.size+':'+s.mtimeMs;
  if(!reviewed.has(key))reviewed.set(key,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===expected);
  if(!reviewed.get(key))return false;
 }return true;}catch{return false;}
}
function validClassFunding(q,now=Date.now()){
 return !!q&&typeof q.build==='string'&&typeof q.job==='string'&&typeof q.item==='string'&&q.item!=='Copper'&&Number.isSafeInteger(q.quantity)&&q.quantity>0&&Number.isSafeInteger(q.price)&&q.price>0&&q.price<=3000000&&Number.isFinite(q.quoteAt)&&Number.isFinite(q.validUntil)&&q.quoteAt<=now&&now<q.validUntil&&q.validUntil<=q.quoteAt+600000;
}
function classFunding(i,now,ownedTrade){
 const promotion=require('../runtime/promotion-priority'),target=promotion.target(i);if(!target)return null;
 const intent=i.teamTradeIntent,ownedQuote=ownedTrade?intent?.offer?.classFunding:null;
 if(ownedQuote){
  if(!validClassFunding(ownedQuote,now)||intent.offer.kind!=='currency'||intent.offer.receiver!==i.character?.name||intent.deadline<=now||ownedQuote.build!==i.catalog().build||ownedQuote.job!==i.lastSave.job||!target.missing.some(([item,n])=>item===ownedQuote.item&&ownedQuote.quantity<=n-(i.lastSave.materials?.[item]||0)))return null;
  return ownedQuote;
 }
 const p=i.promotionPriorityStatus,missing=target.missing.find(([item])=>item===p?.item);
 if(missing&&p.build===i.catalog().build&&['no_affordable_listing','market_candidate'].includes(p.status)){
  // A funding quote reserves team Copper, not a market purchase. Keep the
  // original verified price for at most ten minutes while actors travel;
  // actual mbuy still requires a newly fresh native listing and wallet.
  const need=missing[1]-(i.lastSave.materials?.[p.item]||0),r=promotion.listing({now:p.marketNow,_receivedAt:p.receivedAt,list:p.offers},p.item,need,3000000,p.receivedAt);
  const q=r?{build:i.catalog().build,job:i.lastSave.job,item:p.item,quantity:r.n,price:r.price,quoteAt:p.receivedAt,validUntil:Math.min(p.receivedAt+600000,p.receivedAt+r.expires-p.marketNow-10000)}:null;
  if(validClassFunding(q,now))return q;
 }
 // A registered gathering/session retains its bounded original quote while
 // native trade pauses saves. This funds Copper only, never retries a buy.
 const q=ownedTrade?intent?.offer?.classFunding:null;
 if(!validClassFunding(q,now)||intent.offer.kind!=='currency'||intent.offer.receiver!==i.character?.name||intent.deadline<=now||q.build!==i.catalog().build||q.job!==i.lastSave.job||!target.missing.some(([item,n])=>item===q.item&&q.quantity<=n-(i.lastSave.materials?.[item]||0)))return null;
 return q;
}
function independentMaterialWallet(i,now){
 const o=i.teamTradeStatus?.offer;
 return o?.kind==='material'&&typeof o.name==='string'&&o.name!=='Copper'&&Number.isSafeInteger(o.quantity)&&o.quantity>0&&require('../runtime/client-refresh').historicalIdleTrade(i,now);
}
function budget(i,{ownedTrade=false,pausedWallet=false,now=Date.now()}={}){
 const s=i.lastSave;
 if(ownedTrade&&i.teamTradeIntent?.offer?.classFunding&&i.teamTradeIntent.offer.donor===i.character?.name&&require('../runtime/promotion-priority').target(i))return null;
 const freshness=require('../runtime/freshness'),freshSave=freshness.decisionGate(i,now).allowed;
 // Native NET.setPause holds outgoing saves while trade is open. Only the
 // runtime's fresh, matching native session/state may use that frozen baseline.
 const frozen=ownedTrade&&pausedWallet&&!i.healthRecovery&&Number.isFinite(i.lastSaveAt)&&i.lastSaveAt<=now&&freshness.fresh(i.livePos?.at,10000,now);
 if(!s||!Number.isSafeInteger(s.coins)||s.coins<0||!sourceReviewed(i)||!freshSave&&!frozen)return null;
 if(i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.recycling||i.choresBusy||i.v2?.trial?.active()||i.livePos?.dead||i.classBossProbeStatus?.status==='running'||i.assistanceReservation?.expiresAt>now||require('../runtime/room-policy').roomPolicy(i.livePos?.room).dungeon)return null;
 if(!ownedTrade&&i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase)&&!independentMaterialWallet(i,now))return null;
 if(require('../runtime/equipment-headroom').journalBlocks(i)||require('../runtime/equipment-headroom').developmentBlocks(i))return null;
 const held=require('../runtime/paid-actions').heldResources(i).Copper||0,reserve=require('../runtime/class-boss-probe').assistanceReserve(i)+held;
 if(!Number.isSafeInteger(reserve)||reserve<0)return null;
 // Keep a full 80-White-potion replacement budget beyond the personal
 // class/ready-wing reserve. Only replenish genuinely short wallets.
 const funding=classFunding(i,now,ownedTrade),materialCost=funding?.price||0;
 const missing=Math.max(0,80-require('../runtime/survival').hpPots(s)),trigger=reserve+10000+missing*350+materialCost,target=reserve+50000+materialCost;
 if(!Number.isSafeInteger(target)||!Number.isSafeInteger(trigger))return null;
 return {coins:s.coins,reserve,target,spare:Math.max(0,s.coins-target),need:s.coins<trigger?Math.max(0,target-s.coins):0,...(funding?{classFunding:funding}:{})};
}
function valid(b){return !!b&&(!b.classFunding||validClassFunding(b.classFunding))&&['coins','reserve','target','spare','need'].every(k=>Number.isSafeInteger(b[k])&&b[k]>=0)&&b.target===b.reserve+50000+(b.classFunding?.price||0)&&b.spare===Math.max(0,b.coins-b.target)&&b.need<=Math.max(0,b.target-b.coins);}
module.exports={budget,valid,sourceReviewed,nativeTradeSection,classFunding,validClassFunding,independentMaterialWallet};
