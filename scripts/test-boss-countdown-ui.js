'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<main id="host"></main>');
 await page.addScriptTag({content:`const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const fmt=v=>String(v);`});
 await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src/public/fleet-dom.js'),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src/public/fleet-layout.js'),'utf8')});
 await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../src/public/fleet-layout.css'),'utf8')});
 const proof=await page.evaluate(async()=>{
  const now=Date.UTC(2026,9,5,18,0,0),c={goal:{monsterId:'queen',mapId:'d4',monsterKind:'boss'},endgameCampaign:{bossFeed:{fresh:true,boardAt:now,rows:[{id:'queen',map:'d4',alive:false,nextAt:now+60000,serverNextAt:now+60000}]}}};
  syncBossClock(new Date(now).toUTCString());
  const oldNow=Date.now;Date.now=()=>now+86400000;
  const host=document.getElementById('host');updateFleetDOM(host,bossGoalClock(c));const node=host.firstChild;
  const first=node.innerText,stamp=node.querySelector('span').innerText;
  const timer=setInterval(()=>updateBossCountdowns(),100);await new Promise(r=>setTimeout(r,1200));clearInterval(timer);
  const second=node.innerText,identity=host.firstChild===node;const beforeSync=bossClockNow();syncBossClock(new Date(now).toUTCString());const monotonic=bossClockNow()>=beforeSync;
  updateBossCountdowns(now+46000);const stale=node.innerText;
  c.endgameCampaign.bossFeed.boardAt=now+50000;updateFleetDOM(host,bossGoalClock(c));updateBossCountdowns(now+60001);const due=host.innerText;
  c.endgameCampaign.bossFeed.rows[0].alive=true;c.endgameCampaign.bossFeed.rows[0].nextAt=null;updateFleetDOM(host,bossGoalClock(c));updateBossCountdowns(now+60001);const alive=host.innerText;
  c.endgameCampaign.bossFeed.rows[0].alive=false;c.endgameCampaign.bossFeed.rows[0].nextAt=null;updateFleetDOM(host,bossGoalClock(c));updateBossCountdowns(now+60001);const unknown=host.innerText;
  c.goal.mapId='other';const mismatch=bossGoalClock(c);c.goal.monsterKind='normal';const normal=bossGoalClock(c);
  Date.now=oldNow;return {first,second,stamp,identity,monotonic,stale,due,alive,unknown,mismatch,normal,overflow:document.documentElement.scrollWidth>390};
 });
 assert(proof.first.includes('เกิดใน 00:01:00'));assert(proof.stamp.includes('01:01:00'),'time explicitly Asia/Bangkok');assert(proof.second.includes('เกิดใน 00:00:59'),'actual timer advances without polling or rerender');assert(proof.identity,'countdown keeps same DOM');assert(proof.monotonic,'late/coarse HTTP clock cannot rewind countdown');assert(proof.stale.includes('ข้อมูลบอสเก่า'));assert(!proof.stale.includes('เกิดใน'));
 assert(proof.due.includes('รอยืนยันว่าบอสเกิด'));assert(!proof.due.includes('เกิดแล้ว'));assert(proof.alive.includes('ยืนยันว่าบอสเกิดแล้ว'));assert(proof.unknown.includes('ยังไม่แจ้งเวลาเกิด'));assert(!proof.unknown.includes('เกิดใน'));assert(proof.mismatch.includes('รอเวลาเกิด'));assert.equal(proof.normal,'');assert(!proof.overflow);assert.deepEqual(errors,[]);
 console.log('PASS goal countdown: native schedule, Thai time, skewed device clock, real ticking, stable DOM, stale/due/alive/unknown/mismatched targets and mobile layout');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
