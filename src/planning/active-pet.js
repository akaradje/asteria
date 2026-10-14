'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),economy=require('../economy');
const checked=new Map(),tiers=[0,100,300,600,1000],share=[0,.03,.04,.05,.065,.08];
const elements={'ไฟ':'str','ลม':'agi','ดิน':'vit','น้ำ':'int','ไม่มีธาตุ':'dex','อันเดด':'dex','ผี':'luk','มืด':'luk'};
const modernElements={...elements,'สายฟ้า':'str','ดวงดาว':'int','พิษ':'agi','ศักดิ์สิทธิ์':'dex'};
const modernPerks={str:{atk:3},dex:{atk:2,hit:2},agi:{flee:2,crit:.003},int:{matk:3},vit:{hp:40,def:1},luk:{crit:.006}};
const modernChecked=new Set();
const elementLabel=(m,cat)=>Object.fromEntries(cat.world.ELEMENTS||[])[cat.world.elementKey?.(m.element)]||m.element;
const perks={'สัตว์':['atk',3],'พืช':['hpRegen',2],'แมลง':['flee',3],'มนุษย์':['hit',3],'วิญญาณ':['matk',3],'อันเดด':['def',3],'ปีศาจ':['crit',.006],'อนินทรีย์':['def',3],'มังกร':['atk',4],'เทวดา':['hp',60]};
function reviewed(root,build){const key=root+':'+build;if(checked.has(key))return checked.get(key);try{const s=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8'),a=s.indexOf('  const PET_TIERS ='),b=s.indexOf('  function bestiaryBonus()',a);const digest=crypto.createHash('sha256').update(s.slice(a,b)).digest('hex'),modern=digest==='138785e979ba53252e4bc243897eed3506d0de211880463ae2ef99a22d2161df'&&(s.includes("const bookStat = T => BOOK_STAT[T.element] || 'dex';")||s.includes("const bookStat = T => BOOK_STAT[elTh(T)] || 'dex';")&&s.includes("const EL_TH = Object.fromEntries(AsteriaWorld.ELEMENTS);")&&s.includes("const elTh = T => EL_TH[AsteriaWorld.elementKey(T && T.element)] || (T && T.element);"))&&s.includes("const BOOK_STAT = { 'ไฟ': 'str', 'ลม': 'agi', 'ดิน': 'vit', 'น้ำ': 'int', 'ไม่มีธาตุ': 'dex', 'อันเดด': 'dex', 'ผี': 'luk', 'มืด': 'luk', 'สายฟ้า': 'str', 'ดวงดาว': 'int', 'พิษ': 'agi', 'ศักดิ์สิทธิ์': 'dex' };");const ok=a>=0&&b>a&&(modern||digest==='978bbbfb651ea099814488045ef7b8793e9678c286b76527215a279c3dd1d9fe')&&s.includes("const PET_UNLOCK = T => T.kind === 'boss' ? 50 : T.kind === 'miniboss' ? 30 : PET_UNLOCK_NORMAL.find(([lv]) => T.level <= lv)[1];")&&(s.includes("const monStat = T => ELEMENT_STAT[T.element] || 'dex';")||s.includes("const monStat = T => ELEMENT_STAT[elTh(T)] || 'dex';"))&&s.includes(' * (isElite(T) ? 1.25 : 1)')&&/PET_SHARE = \[0, 0\.03, 0\.04, 0\.05, 0\.065, 0\.08\]/.test(s);if(checked.size>=8)checked.clear();checked.set(key,ok);if(modern&&ok)modernChecked.add(key);return ok;}catch{return false;}}
function rank(save,cat,root=process.cwd()){
 reviewed(root,cat.build);const modern=modernChecked.has(root+':'+cat.build),gear=require('../gear-value');
 // The active pet must not inflate the common baseline used to compare itself.
 const baseline=Math.max(100,gear.totals({...save,petActive:null},cat).score),chain=economy.jobChain(save.job,cat.world),magic=chain.includes('mage')||chain.includes('priest'),tank=chain.includes('knight'),healer=chain.includes('priest');
 const weights={atk:magic?.1:1.5,matk:magic?1.5:.1,hp:tank?.06:.025,def:tank?1.2:.5,crit:150,hpRegen:1,hit:.5,flee:.4,critDmg:70,dmgPct:200,bossDmg:100,aspdPct:magic?30:120,healBonus:healer?200:10,hpPct:20};
 if(save.developmentDefensive)for(const key of ['hp','def','hpRegen'])weights[key]*=1.5;
 const optionRules=require('../knowledge/pet-option-rules'),hasOptions=Object.values(save.petOpts||{}).some(ls=>ls!=null&&(!Array.isArray(ls)||ls.length));
 const nativeOptions=hasOptions?optionRules.read(root,cat.build):null,rows=[];
 for(const[id,n]of Object.entries(save.pets||{})){
  if(!Number.isSafeInteger(n)||n<0)continue;const m=cat.world.MONSTERS?.find(m=>m.id===id);if(!m)continue;
  const tier=tiers.filter(t=>n>=t).length,elite=m.kind!=='normal',[k,v]=perks[m.race]||['hp',40],amount=k==='crit'?Number((v*tier).toFixed(3)):Math.round(v*tier*(1+Math.floor(m.level/25))),element=elementLabel(m,cat),st=modernElements[element]||'dex';
  const bonus=modern?{['st_'+st]:tier*(elite?2:1),...Object.fromEntries(Object.entries(modernPerks[st]).map(([key,value])=>[key,key==='crit'?Number((value*tier).toFixed(3)):Math.round(value*tier*(1+Math.floor(m.level/25)))]))}:{['st_'+(elements[m.element]||'dex')]:tier*(elite?2:1),[k]:amount};
  const opts=optionRules.stats(save.petOpts?.[id],m.level,nativeOptions);
  if(opts.complete)for(const[key,value]of Object.entries(opts.stats))bonus[key]=(bonus[key]||0)+value;
  const stat=economy.score({stats:Object.fromEntries(Object.entries(bonus).filter(([key])=>key.startsWith('st_')))},save.job,cat.world),direct=Object.entries(bonus).filter(([key])=>!key.startsWith('st_')).reduce((sum,[key,value])=>sum+value*(weights[key]||0),0),damageShare=share[tier]*(elite?1.25:1);
  rows.push({id,name:m.name,tier,friendship:n,bonus,damageShare,optionComplete:opts.complete,optionRevision:opts.revision||null,optionReason:opts.reason||null,score:Math.round((stat+direct+baseline*damageShare)*100)/100});
 }
 rows.sort((a,b)=>b.score-a.score||Number(b.id===save.petActive)-Number(a.id===save.petActive)||a.id.localeCompare(b.id));return rows;
}
// Project only owned pets; a projected tier is never evidence of actual ownership or power.
function development(save,cat){
 const current=rank(save,cat);if(current.some(p=>!p.optionComplete))return {best:null,target:null,projected:[],reason:'owned pet options need native rule review; preserve active pet'};const projected=rank({...save,pets:Object.fromEntries(current.map(p=>[p.id,1000]))},cat),best=current[0]||null,target=projected[0]||null;
 const actual=target&&current.find(p=>p.id===target.id),gain=best&&target?(target.score-best.score)/Math.max(1,best.score):0;
 return {best,target:actual&&actual.friendship<1000&&gain>=.1?{...target,friendship:actual.friendship,remainingKills:1000-actual.friendship,estimatedGainPct:Math.round(gain*100)}:null,projected:projected.slice(0,3)};
}
function choose(i,cat,now=Date.now()){
 const d=development(i.lastSave,cat),g=i.campaignGoal||i.goal,m=cat.world.MONSTERS?.find(m=>m.id===g?.monsterId),p=i.livePos,v=i.vitals;
 const departures=[i.bossWindow?.departAt,i.bossWindow?.returnAt].filter(Number.isFinite);
 const safe=!!(!['boss-live','return-to-boss','preposition'].includes(i.bossWindow?.phase)&&d.target&&m?.kind==='normal'&&m.level<=i.lastSave.lv*.8&&p?.room===g?.mapId&&now-p.at>=0&&now-p.at<10000&&!p.dead&&v&&now-v.at>=0&&now-v.at<10000&&v.hp>=.9&&!i.survivalRecovery&&!i.survivalStatus?.deaths?.length&&!i.lastSave.developmentDefensive&&!i.teamControl&&!i.pendingTravel&&!i.choresBusy&&!i.recycling&&!require('../runtime/room-policy').roomPolicy(p.room).dungeon&&departures.every(at=>at-now>180000)&&require('../runtime/survival').hpPots(i.lastSave)>=10);
 return {...d,selected:safe?rank(i.lastSave,cat).find(p=>p.id===d.target.id):d.best,mode:safe?'training':'combat',reason:d.reason||(safe?'ฝึกตัวที่มีศักยภาพสูงกว่า ระหว่างล่ามอนปกติที่ปลอดภัย':'ใช้ตัวที่มีคะแนนปัจจุบันสูงสุด; ฝึกเฉพาะงานคั่นที่ผ่านเงื่อนไขความปลอดภัย')};
}
module.exports={rank,reviewed,development,choose};
