'use strict';
// 401 = the panel restarted or the password changed. Every fetch from here on would
// return an error body that the page cannot tell apart from data, so it would freeze
// on stale numbers forever - bounce to the login page instead.
(() => {
  const raw = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const r = await raw(...a);
    if (r && r.status === 401) { location.replace('/'); }
    return r;
  };
})();

let advisorLoading=false,advisorLocalBusy=false,autoBrainEnabled=true;
const aiEl=id=>document.getElementById(id);
const aiActions={focus_growth:'เก็บเลเวลและปลดล็อก',focus_income:'สะสมเงินสำรอง',focus_gear:'หาอุปกรณ์อัปเกรด',focus_craft:'เก็บวัตถุดิบคราฟ',focus_refine:'ตีบวกอุปกรณ์',continue:'ฟาร์มตามแผนเดิม',review_route:'ตรวจเส้นทาง/เป้าหมาย',recover:'ตรวจการฟื้นตัวและความพร้อม',observe:'เก็บข้อมูลเพิ่ม'};
function renderAdvisor(d){
  const last=d.last||{},p=last.providers||{},busy=d.busy||advisorLocalBusy;
  if(d.automation){
    const a=d.automation;autoBrainEnabled=a.enabled;
    aiEl('toggleAutoBrain').textContent=a.enabled?'พัก AI อัตโนมัติ':'เปิด AI อัตโนมัติ';
    aiEl('autoBrainStatus').textContent=(a.enabled?'AI อัตโนมัติเปิดอยู่':'AI พักอยู่ · ระบบเกมเดิมยังเล่นต่อ')+' · '+(a.busy?'กำลังทบทวนทีม':a.nextAt?'รอบถัดไป '+new Date(a.nextAt).toLocaleTimeString('th-TH'):'รอเกมพร้อม')+(a.lastError?' · '+a.lastError:'');
    const history=aiEl('autoBrainHistory');history.replaceChildren();
    const add=t=>{const p=document.createElement('p');p.textContent=t;history.append(p);};
    if(a.research){const r=a.research,lastResearch=r.rows?.[0];add('ค้นคว้าความรู้ · Typesafe jev-latest · '+(r.busy?'กำลังวิเคราะห์':r.lastError?'รอตรวจ: '+r.lastError:lastResearch?'เลือกตรวจ '+(lastResearch.evidenceId||'ข้อมูลเพิ่มเติม')+' · '+lastResearch.status:'รอข้อมูลใหม่')+' · ยังไม่ส่งคำสั่งเกมจากงานค้นคว้า');}
    const openIncidents=(a.incidents||[]).filter(r=>!r.resolved);if(openIncidents.length)add('เหตุที่ยังรอผลแก้ไข '+openIncidents.length+' รายการ');
    for(const o of d.outcomes||[])add('ผลลงมือ · จอ '+o.slot+' · '+o.status+' · '+new Date(o.at).toLocaleTimeString('th-TH'));
    for(const h of (a.history||[]).slice(0,3)){add('รอบ '+new Date(h.at).toLocaleTimeString('th-TH')+(h.note?' · '+h.note:''));for(const r of h.decisions)add('จอ '+r.slot+' · '+(aiActions[r.action]||'')+' · '+r.status);for(const o of h.outcomes||[])add('ติดตามผล · จอ '+o.slot+' · '+o.status+' (ยังไม่ยืนยันว่าเป็นผลจาก AI)');}
  }
  aiEl('askAdvisor').disabled=busy||Date.now()<d.nextAt;
  aiEl('askAdvisor').textContent=busy?'กำลังวิเคราะห์…':'ขอแผนจาก AI';
  aiEl('advisorStatus').textContent=busy?'กำลังขอคำแนะนำ · เกมทำงานตามระบบเดิม':Date.now()<d.nextAt?'รอได้ถึง '+new Date(d.nextAt).toLocaleTimeString('th-TH')+' เพื่อขอแผนครั้งถัดไป':(autoBrainEnabled?'ระบบทบทวนแผนให้เอง · ดูผลด้านล่าง':'AI อัตโนมัติพักอยู่');
  const box=aiEl('advisorResult');box.replaceChildren();
  const line=(text,tag='p')=>{const el=document.createElement(tag);el.textContent=text;box.append(el);return el;};
  const planner=d.plannerProvider||last.plannerProvider||'openrouter',label=planner==='meta'?'Meta':'OpenRouter';
  for(const k of ['typesafe',planner]){const c=d.config?.[k],r=p[k];line((k==='typesafe'?'Jev':label)+' · '+(c?.model||'ไม่ระบุรุ่น')+' · '+(r?(r.ok?'ตอบกลับแล้ว':r.error):(c?.configured?'ตั้งค่าแล้ว · ยังไม่ได้ทดสอบ':'ยังไม่ได้ตั้งค่า')));}
  if(!last.at){line('รอ AI วิเคราะห์รอบแรกเมื่อเกมพร้อม');return;}
  line('คำขอล่าสุด '+new Date(last.at).toLocaleString('th-TH')+' · ข้อมูลเกม ณ '+new Date(last.snapshotAt).toLocaleString('th-TH')+(Date.now()-Date.parse(last.snapshotAt)>300000?' · แผนนี้อาจเก่าแล้ว':'') );
  if(last.plan){line(last.plan.summary);for(const m of last.plan.members){line('จอ '+m.slot+' · '+aiActions[m.action],'h3');line(m.reason);}}
  else line('ยังไม่มีคำอธิบายจาก '+label+' · ระบบเกมใช้แผนเดิม');
  if(p.typesafe?.ok){line('ข้อเสนอ Jev (ความมั่นใจของโมเดล ไม่ใช่อัตราสำเร็จในเกม)','h3');for(const c of p.typesafe.choices)line('จอ '+c.slot+' · '+aiActions[c.action]+' · '+Math.round(c.confidence*100)+'%');}
}
async function refreshAdvisor(){
  if(advisorLoading||advisorLocalBusy||document.hidden||location.hash!=='#reports')return;
  advisorLoading=true;try{const r=await fetch('/api/advice',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();renderAdvisor(await r.json());}catch{aiEl('advisorStatus').textContent='อ่านสถานะ AI ไม่สำเร็จ';}finally{advisorLoading=false;}
}
aiEl('askAdvisor').addEventListener('click',async()=>{
  if(advisorLocalBusy)return;advisorLocalBusy=true;aiEl('askAdvisor').disabled=true;aiEl('advisorStatus').textContent='กำลังขอแผนจาก AI · อาจใช้เวลาถึง 90 วินาที';
  try{const r=await fetch('/api/advice',{method:'POST',headers:{'X-Advisor-Request':'1'},signal:AbortSignal.timeout(100000)}),d=await r.json();if(!r.ok)throw Error(d.error||'ขอแผนไม่สำเร็จ');advisorLocalBusy=false;renderAdvisor(d);}
  catch(e){aiEl('advisorStatus').textContent=e.name==='TimeoutError'?'หมดเวลารอ กรุณาตรวจสถานะอีกครั้ง':e.message;}
  finally{advisorLocalBusy=false;aiEl('askAdvisor').disabled=false;}
});
setInterval(refreshAdvisor,5000);

aiEl('toggleAutoBrain').addEventListener('click',async()=>{
  const b=aiEl('toggleAutoBrain');b.disabled=true;
  try{const r=await fetch('/api/advice/auto',{method:'POST',headers:{'X-Advisor-Request':'1','Content-Type':'application/json'},body:JSON.stringify({enabled:!autoBrainEnabled})});if(!r.ok)throw Error();await refreshAdvisor();}
  catch{aiEl('autoBrainStatus').textContent='เปลี่ยนโหมดไม่สำเร็จ';}finally{b.disabled=false;}
});
