'use strict';
const {jobChain}=require('./economy');
const labels={atk:'ATK',matk:'MATK',hit:'HIT',flee:'FLEE',hp:'Max HP',hpRegen:'ฟื้น HP/วิ',crit:'คริติคอล',aspdPct:'ความเร็วโจมตี',damageReduction:'ลดดาเมจที่ได้รับ',healBonus:'ฮีลแรงขึ้น',dmgPct:'ดาเมจทั้งหมด',critDmg:'คริดาเมจ',bossDmg:'ดาเมจใส่บอส/มินิบอส',st_str:'STR',st_agi:'AGI',st_vit:'VIT',st_int:'INT',st_dex:'DEX',st_luk:'LUK'};
const percent=new Set(['crit','aspdPct','damageReduction','healBonus','dmgPct','critDmg','bossDmg']);
function text(o){return o?`${labels[o.k]||o.k} +${percent.has(o.k)?+(o.v*100).toFixed(1)+'%':o.v}`:'ว่าง';}
function plan(save,items,world,wiki){
 const id=save.equip?.weapon,it=items[id],lines=save.weaponOpts?.[id]||[null,null,null];
 if(!it||!Array.isArray(lines)||lines.length!==3)return {ready:false,reason:'รอข้อมูลอาวุธและออฟครบสามแถว'};
 if(lines.some(o=>o&&(!labels[o.k]||!Number.isFinite(o.v)||!Number.isInteger(o.s)||o.s<1||o.s>5)))return {ready:false,reason:'พบออฟที่ยังไม่รู้จัก เก็บไว้ก่อน'};
 const chain=jobChain(save.job,world),magic=chain.includes('mage')||chain.includes('priest'),healer=chain.includes('priest'),tank=chain.includes('knight');
 const useful=new Set(['hp','damageReduction','dmgPct','bossDmg','st_vit',...(magic?['matk','st_int','st_dex']:['atk','st_str','st_agi','st_dex','hit','crit','critDmg','aspdPct']),...(healer?['healBonus']:[]),...(tank?['hpRegen']:[])]);
 // Preserve useful lines while filling gaps; once full, improve one non-max line at a time.
 const locks=lines.map((o,n)=>!!o&&(n===2||useful.has(o.k)&&o.s>=3||o.s===5));
 const improve=lines.map((o,n)=>({o,n})).filter(x=>x.o&&useful.has(x.o.k)&&x.o.s<5).sort((a,b)=>(a.n===2)-(b.n===2)||a.o.s-b.o.s);
 if(locks.every(Boolean)&&improve.length)locks[improve[0].n]=false;
 const tier=Math.max(1,Math.min(5,it.tier||1)),count=locks.filter(Boolean).length;
 const cost={dust:Math.round(15*tier*(1+.5*count)),coins:100*tier*tier,tokens:(locks[0]?1:0)+(locks[1]?1:0)+(locks[2]?2:0)};
 const reserve=Math.max(1000,(save.lv||1)*100),spare=Math.max(0,(save.coins||0)-reserve);
 const runeReserve=Math.max(3,...(wiki?.crafting?.recipes||[]).map(r=>r.cost?.['Ancient Rune']||0));
 const rune=tier>=4&&!lines[2]&&(save.keyItems?.['Ancient Rune']||0)>runeReserve;
 const base={id,name:it.name,lines,expected:lines.map(text),locks,cost,rune,runeReserve,chance3:Math.min(.25,.08+(save.enchPity||0)*.01),reserve};
 if(tier<4)return {...base,ready:false,reason:'เก็บงบออฟไว้สำหรับอาวุธ Tier 4 ขึ้นไป'};
 if(count===3)return {...base,ready:false,reason:'เก็บออฟครบทั้งสามแถวแล้ว ไม่สุ่มทับ'};
 if((save.tokens||0)<cost.tokens)return {...base,ready:false,reason:`รอ Token ${cost.tokens} เพื่อล็อกของดี ไม่ปลดล็อกเพื่อฝืนสุ่ม`};
 if((save.runeDust||0)<cost.dust||cost.coins>Math.min(spare,Math.floor((save.coins||0)*.1)))return {...base,ready:false,reason:'รอผงรูนหรือเงินส่วนเกิน (งบครั้งละไม่เกิน 10% และกันเงินสำรอง)'};
 return {...base,ready:true,reason:'ล็อกแถว '+locks.map((v,n)=>v?n+1:null).filter(Boolean).join(', ')+' แล้วปรับแถวที่เหลือ'};
}
module.exports={plan,text};
