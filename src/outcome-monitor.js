'use strict';
const fs=require('fs'),path=require('path');
class OutcomeMonitor{
 constructor(root,slot){this.file=path.join(root,'logs',`outcomes-${slot}.json`);try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={rows:[],failures:{}};} }
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 allowed(kind,now=Date.now()){return !this.data.rows.some(r=>r.kind===kind&&r.status==='pending')&&!(this.data.failures[kind]?.until>now);}
 begin(kind,before,target={},now=Date.now()){if(!this.allowed(kind,now))return null;const r={kind,before,target,at:now,status:'pending',deadline:now+15000};this.data.rows.unshift(r);this.data.rows=this.data.rows.slice(0,80);this.save();return r;}
 finish(r,status,evidence,now=Date.now()){r.status=status;r.evidence=evidence;r.finishedAt=now;const f=this.data.failures[r.kind]||{count:0};if(status==='observed'){f.count=0;f.until=0;}else{f.count++;f.until=now+Math.min(300000,15000*2**Math.min(f.count,5));}this.data.failures[r.kind]=f;this.save();}
 observe(view,now=Date.now()){
  for(const r of this.data.rows.filter(r=>r.status==='pending')){
   let seen=false;
   if(r.kind==='mana'&&view.saveAt>r.at)seen=(view.consumables?.[r.target.item]||0)<r.before.count&&view.mp>r.before.mp;
   if(r.kind==='support'){const ally=view.peers?.find(p=>p.slot===r.target.slot);seen=ally?.at>r.at&&ally.room===r.target.room&&ally.hp>r.before.hp+.01;}
   if(r.kind==='regroup')seen=view.pos?.at>r.at&&view.pos.room===r.target.room&&Math.hypot(view.pos.x-r.target.x,view.pos.z-r.target.z)<=6;
   if(seen)this.finish(r,'observed',r.kind==='support'?'พบ HP เพื่อนเพิ่มหลังส่งสกิล (ยังระบุสาเหตุเฉพาะไม่ได้)':'พบผลตามเป้าหมายจากข้อมูลใหม่',now);
   else if(now>=r.deadline)this.finish(r,'unconfirmed','ไม่พบผลภายในกำหนด · พักคำสั่งและตรวจสถานการณ์ใหม่',now);
  }
 }
 view(){return {rows:this.data.rows.slice(0,8),failures:this.data.failures};}
}
module.exports={OutcomeMonitor};
