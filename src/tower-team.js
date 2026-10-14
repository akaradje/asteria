'use strict';
const fs=require('fs'),path=require('path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const name=i=>i.credentials.charName;
const active=s=>s?.run&&!s.run.done;
// Coordination consumes server quotas, never an estimated local daily counter.
class TowerTeam {
 constructor(root,{now=Date.now,wait=sleep,report=()=>{}}={}) {
  this.now=now;this.wait=wait;this.report=report;this.file=path.join(root,'logs/tower-team.json');
  try{this.saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{this.saved={};}
  this.learning=new (require('./dungeon-learning').DungeonLearning)(root);
 }
 persist(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.saved));fs.renameSync(this.file+'.tmp',this.file);}
 publish(phase,reason,extra={}) {this.info={phase,reason,at:this.now(),...extra};this.report(this.info);return this.info;}
 async query(team){
  const at=this.now();await Promise.all(team.map(i=>i.towerQuery()));await this.wait(1200);
  const states=await Promise.all(team.map(async i=>{const s=await i.towerState();return s?._receivedAt>=at?s:null;}));
  this.learning.observe(team,states,this.now());
  for(let n=0;n<team.length;n++)if(team[n].socialFrames){const id=states[n]?.run?.id||this.saved.runId;if(id){for(const reward of await team[n].socialFrames('twreward',this.rewardSince||at))this.learning.reward(id,team[n].slot,reward,this.now());for(const event of await team[n].socialFrames('twend',this.rewardSince||at))this.learning.end(id,team[n].slot,event,this.now());}}
  this.rewardSince=at;
  return states;
 }
 quotas(team,states){return team.map((i,n)=>({name:name(i),left:states[n]?.left??null,runs:states[n]?.runs??null}));}
 async run(team,count,stopping=()=>false){
  if(this.busy)return;this.busy=true;
  try{return await this.cycle(team,count,stopping);}catch(e){return this.publish('waiting','ตรวจหอคอยไม่สำเร็จ: '+e.message);}
  finally{for(const i of team)i.teamControl=false;this.busy=false;}
 }
 async cycle(team,count,stopping){
  if(!team.length)return this.publish('waiting','รอตัวละครออนไลน์');
  let states=await this.query(team),quotas=this.quotas(team,states);
  const running=states.find(active);
  if(running){
   const id=running.run.id;
   // A recovered process may observe a run without knowing when it opened. Never invent a fresh invitation window.
   const deadline=this.saved.runId===id?this.saved.deadline:0;
   if(deadline>this.now())return this.join(team,states,id,deadline,stopping);
   const joined=team.filter((i,n)=>states[n]?.run?.id===id&&states[n]?.run?.member).map(name);
   return this.publish('running','กำลังลงหอคอย · ปิดช่วงเข้าร่วมแล้ว',{run:running.run,joined,missing:team.filter(i=>!joined.includes(name(i))).map(name),quotas});
  }
  if(states.some(s=>!s))return this.publish('waiting','รอข้อมูลรอบล่าสุดจากเซิร์ฟเวอร์',{quotas});
  if(this.saved.attemptAt){
   // An acknowledged finished run can clear the durable attempt guard. Ambiguous sends get a cooldown.
   const finished=this.saved.runId!=null&&states.some(s=>s.run?.id===this.saved.runId&&s.run?.done);
   if(!finished&&this.now()-this.saved.attemptAt<600000)return this.publish('cooldown','พักหลังรอบก่อน / รอยืนยันผลคำสั่ง ไม่เปิดรอบซ้ำ',{quotas});
  }
  const unready=team.filter(i=>i.status!=='playing'||i.recycling||i.choresBusy||!i.lastSaveAt||this.now()-i.lastSaveAt>30000||!(i.lastSave?.hp>0));
  if(team.length!==count||unready.length)return this.publish('waiting','รอทีมครบ '+count+' คน ข้อมูลสด มีชีวิต และทำธุระเสร็จ',{missing:unready.map(name),quotas});
  const blocked=team.filter((i,n)=>!(states[n].left>0)||i.lastSave.lv<(states[n].minLv||15));
  if(blocked.length)return this.publish('waiting','รอสิทธิ์รอบหรือเลเวลขั้นต่ำของสมาชิก',{missing:blocked.map(name),quotas});
  const party=await team[0].partyState();
  const leader=team.find(i=>name(i)===(party?.members||[]).find(m=>m.aid===party.leader)?.name);
  if(!leader||team.some(i=>!party.members.some(m=>m.name===name(i))))return this.publish('waiting','รอรายชื่อปาร์ตี้ครบและหัวหน้าตัวจริง',{quotas});
  if(team.some(i=>/^(tw|dx)/.test(i.livePos?.room||i.lastSave?.mapId||'')))return this.publish('waiting','รอทุกคนออกจากดันเดิม',{quotas});
  for(const i of team)i.teamControl=true;
  const idleUntil=this.now()+30000;
  while(team.some(i=>i.tickBusy)&&this.now()<idleUntil&&!stopping())await this.wait(500);
  if(stopping()||team.some(i=>i.tickBusy))return this.publish('waiting','รอจบคำสั่งเดิมก่อนรวมทีม',{quotas});
  this.publish('gathering','เรียกทั้งทีมกลับเมืองก่อนใช้สิทธิ์รอบ',{leader:name(leader),quotas,missing:team.map(name)});
  const returned=await Promise.allSettled(team.map(async i=>{
   await i.expeditionAuto(false);const result=await i.returnToTown();await i.expeditionAuto(false);return result.ok;
  }));
  const missing=team.filter((i,n)=>returned[n].status!=='fulfilled'||!returned[n].value).map(name);
  if(stopping()||missing.length)return this.publish('waiting','รวมทีมยังไม่สำเร็จ จึงยังไม่เปิดรอบ',{missing,quotas});
  const readiness=[];
  for(const member of team){if(stopping())return;readiness.push(await member.prepareDungeon());}
  if(readiness.some(r=>!r.ready))return this.publish('preparing','รอ HP/MP ยาและอุปกรณ์ก่อนใช้สิทธิ์',{readiness,missing:readiness.filter(r=>!r.ready).map(r=>r.name),quotas});
  states=await this.query(team);quotas=this.quotas(team,states);
  const screens=await Promise.all(team.map(i=>i.screen()));
  const finalReadiness=team.map((i,n)=>require('./team-readiness').check(i,screens[n],states[n],this.now()));
  if(finalReadiness.some(r=>!r.ready))return this.publish('preparing','ความพร้อมเปลี่ยนก่อนเปิดรอบ รอตรวจใหม่',{readiness:finalReadiness,missing:finalReadiness.filter(r=>!r.ready).map(r=>r.name),quotas});
  const parties=await Promise.all(team.map(i=>i.partyState()));
  if(states.some((s,n)=>!s||active(s)||!(s.left>0)||team[n].lastSave.lv<(s.minLv||15))||screens.some(s=>!s.inGame||s.death||!/town/i.test(s.loc))||parties.some(p=>p?.id!==party.id||p?.leader!==party.leader||team.some(i=>!p?.members?.some(m=>m.name===name(i))))||team.some(i=>i.recycling||i.status!=='playing')||stopping())return this.publish('waiting','ความพร้อมเปลี่ยนระหว่างรวมทีม รอตรวจใหม่',{quotas});
  // Start at the lowest shared checkpoint. Do not inherit the strongest member's highest floor.
  const shared=(states[team.indexOf(leader)].starts||[1]).filter(f=>Number.isInteger(f)&&f>=1&&states.every(s=>(s.starts||[1]).includes(f)));
  if(!shared.length)return this.publish('waiting','ยังไม่มีชั้นเริ่มต้นที่ทั้งทีมใช้ร่วมกันได้',{quotas});
  const selection=this.learning.choose(shared,team.map(i=>i.slot));
  const from=selection.from,at=this.now();
  this.saved={attemptAt:at,deadline:at+120000,runId:null,from};this.persist();
  this.publish('opening','หัวหน้าปาร์ตี้กำลังเปิดหอคอย · '+selection.reason,{leader:name(leader),from,deadline:this.saved.deadline,quotas,readiness});
  await leader.towerStart(from);
  for(let n=0;n<5&&!stopping();n++){
   states=await this.query(team);const st=states[team.indexOf(leader)];
   if(active(st)&&st.run.member){this.saved.runId=st.run.id;this.persist();return this.join(team,states,st.run.id,this.saved.deadline,stopping);}
   await this.wait(1000);
  }
  return this.publish('uncertain','ยังไม่ยืนยันว่าหัวหน้าเข้ารอบสำเร็จ พักคำสั่งเปิดเพื่อไม่ใช้สิทธิ์ซ้ำ',{quotas});
 }
 async join(team,states,id,deadline,stopping){
  const attempts=new Map();
  for(const i of team)i.teamControl=true;
  const idleUntil=Math.min(deadline,this.now()+30000);
  while(team.some(i=>i.tickBusy)&&this.now()<idleUntil&&!stopping())await this.wait(500);
  while(this.now()<deadline&&!stopping()&&!team.some(i=>i.tickBusy)){
   const joined=team.filter((i,n)=>states[n]?.run?.id===id&&states[n].run.member&&!states[n].run.done).map(name);
   const missing=team.filter(i=>!joined.includes(name(i)));
   this.publish(missing.length?'joining':'running',missing.length?'หัวหน้าเข้าแล้ว กำลังยืนยันสมาชิกเข้าตาม':'เซิร์ฟเวอร์ยืนยันเข้าหอคอยครบทีม',{runId:id,joined,missing:missing.map(name),deadline,quotas:this.quotas(team,states)});
   await Promise.allSettled(team.filter(i=>joined.includes(name(i))).map(i=>i.expeditionAuto(true)));
   if(!missing.length)return this.info;
   await Promise.allSettled(missing.map(async i=>{
    if(i.recycling||i.status!=='playing'||(attempts.get(i.slot)||0)>=3||this.now()>=deadline-5000)return;
    const s=await i.screen();if(!s.inGame||s.death||!/town/i.test(s.loc))return;
    await i.expeditionAuto(false);
    if(this.now()>=deadline-5000)return;
    attempts.set(i.slot,(attempts.get(i.slot)||0)+1);await i.towerJoin(id,deadline);
   }));
   await this.wait(Math.min(5000,Math.max(0,deadline-this.now())));states=await this.query(team);
   if(states.every(s=>s&&!active(s)))break;
  }
  const joined=team.filter((i,n)=>states[n]?.run?.id===id&&states[n].run.member).map(name);
  return this.publish('partial','สิ้นสุดช่วงเข้าร่วม ไม่ส่งคำสั่งเปิดรอบใหม่',{runId:id,joined,missing:team.filter(i=>!joined.includes(name(i))).map(name),deadline,quotas:this.quotas(team,states)});
 }
}
module.exports={TowerTeam};
