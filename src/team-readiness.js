'use strict';
function ratio(text){const m=String(text||'').replace(/,/g,'').match(/([\d.]+)\s*\/\s*([\d.]+)/);return m&&+m[2]>0?Math.max(0,Math.min(1,+m[1]/+m[2])):null;}
function vitals(screen={},at=Date.now()){
 const pair=text=>{const m=String(text||'').replace(/,/g,'').match(/^\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/);return m&&Number.isFinite(+m[1])&&Number.isFinite(+m[2])&&+m[2]>0?{current:+m[1],max:+m[2]}:null;};
 const hp=pair(screen.hp),mp=pair(screen.mp);return {at,hp:hp?Math.min(1,hp.current/hp.max):null,currentHp:hp?.current??null,maxHp:hp?.max??null,mp:mp?Math.min(1,mp.current/mp.max):null,currentMp:mp?.current??null,maxMp:mp?.max??null};
}
function check(i,screen={},tower=null,now=Date.now()){
 const s=i.lastSave||{},reasons=[],warnings=[],hp=ratio(screen.hp),mp=ratio(screen.mp);
 const hpPots=(s.potions||0)+['Orange Potion','Yellow Potion','White Potion'].reduce((n,k)=>n+(s.consumables?.[k]||0),0),mpPots=['Blue Potion','Sapphire Potion','Starlight Potion'].reduce((n,k)=>n+(s.consumables?.[k]||0),0);
 if(i.status!=='playing'||i.recycling)reasons.push('ยังไม่ออนไลน์พร้อมเล่น');
 if(!i.lastSaveAt||now-i.lastSaveAt>30000)reasons.push('รอเซฟสด');
 if(screen.death||!(s.hp>0))reasons.push('ยังล้มอยู่');
 if(hp===null||hp<.85)reasons.push(hp===null?'รอค่า HP สูงสุด':'HP ต่ำกว่า 85%');
 if(mp===null||mp<.5)reasons.push(mp===null?'รอค่า MP สูงสุด':'MP ต่ำกว่า 50%');
 if(hpPots<10)reasons.push('ยาฟื้น HP น้อยกว่า 10');
 if(mpPots<5)warnings.push('ยาฟื้น MP น้อยกว่า 5');
 for(const slot of ['weapon','armor','head','boots'])if(!s.equip?.[slot])reasons.push('ขาดอุปกรณ์ '+slot);
 if(tower&&!(tower.left>0))reasons.push('สิทธิ์หอคอยหมด');
 if(tower&&s.lv<(tower.minLv||15))reasons.push('เลเวลไม่ถึงขั้นต่ำ');
 if(!(s.manualT>0))warnings.push('ไม่มีบัฟคู่มือ EXP (ไม่ขวางการลงดัน)');
 return {slot:i.slot,name:i.credentials?.charName,...vitals(screen,now),ready:!reasons.length,hp,mp,hpPots,mpPots,reasons,warnings};
}
function tactics(self,peers,now=Date.now()){
 const p=self.livePos;if(!p||now-p.at>10000||p.dead||!self.teamPartyId)return {action:'hold',reason:'รอตำแหน่งและปาร์ตี้สด'};
 if(!require('./runtime/freshness').fresh(self.lastSaveAt,30000,now))return {action:'hold',reason:'รอเซฟสดก่อนสั่งการต่อสู้'};
 const allies=peers.filter(i=>i!==self&&i.teamPartyId===self.teamPartyId&&i.status==='playing'&&!i.recycling&&i.livePos?.room===p.room&&require('./runtime/freshness').fresh(i.livePos.at,10000,now)&&require('./runtime/freshness').fresh(i.lastSaveAt,30000,now)&&!i.livePos.dead&&Number.isFinite(i.livePos.x)&&Number.isFinite(i.livePos.z));
 if(!allies.length)return {action:'hold',reason:'รอสมาชิกในห้องเดียวกัน ไม่เลือกบอสเมื่ออยู่ลำพัง'};
 const nearby=allies.filter(i=>Math.hypot(i.livePos.x-p.x,i.livePos.z-p.z)<=10);
 const danger=nearby.filter(i=>now-(i.vitals?.at||0)<15000&&i.vitals.hp!==null&&i.vitals.hp<.5).sort((a,b)=>a.vitals.hp-b.vitals.hp)[0];
 const job=self.lastSave?.job||'',support=/priest|lumenoracle/.test(job),tank=/knight|dawnwarden/.test(job);
 if(danger&&(support||tank))return {action:'support',skills:support?['sanctum_bloom','heal','seraph_ward','blessing']:['solar_aegis'],ally:danger.slot,reason:'ช่วยจอ '+danger.slot+' HP '+Math.round(danger.vitals.hp*100)+'% ในระยะ 10 เมตร'};
 const anchor=allies.find(i=>/knight|dawnwarden/.test(i.lastSave?.job||''))||allies[0];
 if(require('./runtime/freshness').fresh(self.vitals?.at,15000,now)&&Number.isFinite(self.vitals.hp)&&self.vitals.hp<.25)return {action:'retreat',x:anchor.livePos.x,z:anchor.livePos.z,reason:'HP ต่ำกว่า 25% หยุดโจมตีและกลับเข้าระยะทีม'};
 if(anchor&&Math.hypot(anchor.livePos.x-p.x,anchor.livePos.z-p.z)>8)return {action:'regroup',x:anchor.livePos.x,z:anchor.livePos.z,reason:'กลับเข้าระยะสนับสนุนของทีม'};
 return {action:'focus',target:'elite',reason:'ใช้เป้าหมายบอสร่วมกันเมื่อมี และ AUTO เลือกมอนในห้อง'};
}
module.exports={ratio,vitals,check,tactics};
