'use strict';
const fs=require('fs'),path=require('path');
const signature=s=>JSON.stringify([s.equip,s.refine,s.weaponOpts,s.sockets,s.stage||{}]);
class GearImpact{
 constructor(root,slot){this.file=path.join(root,'logs',`gear-impact-${slot}.json`);try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={groups:[]};}this.prev=null;}
 position(pos){if(pos.dead&&!this.wasDead){const g=this.data.groups.find(g=>g.sig===this.data.currentSig&&g.room===pos.room&&g.lv===this.data.currentLv&&g.build===this.data.currentBuild);if(g)g.deaths++;}this.wasDead=!!pos.dead;}
 observe(s,pos,now=Date.now(),busy=false,build='unknown'){
  const current={build,at:now,lv:s.lv,exp:s.exp,coins:s.coins,hp:s.hp,kills:Object.values(s.bestiary||{}).reduce((n,x)=>n+(typeof x==='number'?x:0),0),sig:signature(s),room:pos?.room,job:s.job,busy,dead:!!pos?.dead};
  const p=this.prev;this.prev=current;const dt=p?now-p.at:0;
  if(!p||dt<=0||dt>30000||busy||p.busy||!pos||now-pos.at>10000||pos.at>now||!current.room||/town|^(tw|dx|gd|pv)/i.test(current.room)||current.room!==p.room||current.sig!==p.sig||current.lv!==p.lv||current.job!==p.job||current.build!==p.build)return;
  let g=this.data.groups.find(g=>g.sig===current.sig&&g.room===current.room&&g.lv===current.lv&&g.job===current.job&&g.build===build);
  if(!g){g={build,sig:current.sig,room:current.room,lv:current.lv,job:current.job,firstAt:now,ms:0,coins:0,exp:0,kills:0,deaths:0};this.data.groups.unshift(g);this.data.groups=this.data.groups.slice(0,40);}
  this.data.currentBuild=build;this.data.currentSig=current.sig;this.data.currentRoom=current.room;this.data.currentLv=current.lv;g.at=now;g.ms+=dt;g.coins+=current.coins-p.coins;g.exp+=Math.max(0,current.exp-p.exp);g.kills+=Math.max(0,current.kills-p.kills);
  if(!this.savedAt||now-this.savedAt>30000){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);this.savedAt=now;}
 }
 view(){const groups=this.data.groups,cur=groups.find(g=>g.sig===this.data.currentSig&&g.room===this.data.currentRoom&&g.lv===this.data.currentLv&&g.build===this.data.currentBuild),base=cur&&groups.filter(g=>g.build===cur.build&&g.sig!==cur.sig&&g.room===cur.room&&g.lv===cur.lv&&g.job===cur.job&&g.ms>=300000&&g.at<cur.at).sort((a,b)=>b.at-a.at)[0];
  if(!cur||cur.ms<300000||!base)return {ready:false,reason:'รออย่างน้อย 5 นาทีต่อชุด ในแผนที่ เลเวล และอาชีพเดียวกัน',samples:groups.length};
  const rate=g=>({coins:g.coins*3600000/g.ms,kills:g.kills*3600000/g.ms,deaths:g.deaths*3600000/g.ms,exp:g.exp*3600000/g.ms});const before=rate(base),after=rate(cur);
  const worse=after.deaths>before.deaths+1||after.kills<before.kills*.8;
  return {ready:true,room:cur.room,before,after,focus:worse?'focus_gear':null,reason:worse?'ผลชุดล่าสุดมีอัตรารอดหรือความเร็วลดลง ควรตรวจชุดก่อนลงทุนเพิ่ม':'มีผลเปรียบเทียบแล้ว ยังต้องคำนึงถึงความต่างของการต่อสู้',evidence:'observational_not_causal'};
 }
}
module.exports={GearImpact};
