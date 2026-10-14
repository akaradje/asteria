'use strict';
let activityControl=null,activityLoading=false,activitySending=false,activityRetry=null,activityReadAt=0,activityError='';
function activityControlsText(d){
 const c=d?.controls,workflow=d?.workflow;
 if(workflow&&!['IDLE','COMPLETE','FINISHED','WITHDRAWN'].includes(workflow.phase))return 'งานทีม '+({guild:'ดันกิลด์',rift:'Eclipse Rift',tower:'หอคอย'}[workflow.kind]||workflow.kind)+' · '+workflow.phase+' · '+(workflow.reason||'ตรวจทั้ง 6 คนก่อนเปิดและยืนยันผลหลังจบ');
 if(c?.request&&['PENDING','WAITING'].includes(c.request.status))return 'รอระดมพล · '+c.request.reason+' · ครบเงื่อนไขภายใน 10 นาทีจึงเริ่ม';
 return c?.autoEnabled?'เปิดกิจกรรมรายวันอัตโนมัติ · รวม 6 คนเมื่อข้อมูลและโควต้าพร้อม':'ฟาร์มเลเวลและหาไอเทมรายตัว · พักกิจกรรมทีม · ใช้ปุ่มระดมพลเมื่อต้องการ';
}
function paintActivityControls(d){
 const controls=document.getElementById('activityControls'),toggle=document.getElementById('activityAuto');
 if(!controls||!toggle)return;
 const fresh=activityControl&&Date.now()-activityReadAt<30000;
 toggle.textContent=activityControl?.autoEnabled?'ปิดกิจกรรมรายวันอัตโนมัติ':'เปิดกิจกรรมรายวันอัตโนมัติ';toggle.setAttribute('aria-pressed',String(activityControl?.autoEnabled===true));
 for(const b of controls.querySelectorAll('[data-activity]'))b.disabled=activitySending||!!activityRetry||!fresh;
 const w=d?.workflow,active=w&&!['IDLE','COMPLETE','FINISHED','WITHDRAWN'].includes(w.phase),waiting=activityControl?.request&&['PENDING','WAITING'].includes(activityControl.request.status)&&activityControl.request.expiresAt>Date.now();
 for(const b of controls.querySelectorAll('[data-activity="rally"]'))b.disabled=activitySending||!!activityRetry||!fresh||active||waiting;
 document.getElementById('activityMessage').textContent=activityRetry?'ผลส่งคำสั่งยังไม่ชัด · ตรวจสถานะหรือส่งคำสั่งเดิมด้วย ID เดิมได้':activityError||(!fresh?'รอเชื่อม coordinator บน tum · ปุ่มยังไม่พร้อม':activityControlsText({...d,controls:activityControl}));
 document.getElementById('activityRetry').hidden=!activityRetry;
}
async function readActivityControls(){
 if(activityLoading||activitySending||document.hidden)return;activityLoading=true;
 try{const r=await api('activity-control');activityControl=r.control;activityReadAt=Date.now();if(activityRetry&&activityControl.revision===activityRetry.id)activityRetry=null;paintActivityControls(r.daily);}
 catch(e){activityReadAt=0;activityError='อ่านสถานะกิจกรรมไม่ได้ · '+e.message;paintActivityControls(null);}
 finally{activityLoading=false;}
}
async function sendActivityCommand(body){
 if(activitySending)return;activityError='';activitySending=true;paintActivityControls(null);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch('/api/activity-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const r=await response.json();
  if(!response.ok||r.ok===false){activityRetry=null;activityError=r.error||'คำสั่งไม่สำเร็จ';return;}
  activityControl=r.control;activityReadAt=Date.now();activityRetry=null;
 }catch{activityRetry=body;document.getElementById('activityMessage').textContent='ผลส่งคำสั่งยังไม่ชัด · ตรวจสถานะหรือส่งคำสั่งเดิมด้วย ID เดิมได้';}
 finally{clearTimeout(timer);activitySending=false;paintActivityControls(null);await readActivityControls();}
}
document.getElementById('activityControls')?.addEventListener('click',e=>{
 const b=e.target.closest('[data-activity]');if(!b||b.disabled||!activityControl)return;
 const action=b.dataset.activity,body={id:crypto.randomUUID(),revision:activityControl.revision,action};
 if(action==='rally')body.kind=b.dataset.kind;if(action==='set-auto')body.enabled=!activityControl.autoEnabled;
 sendActivityCommand(body);
});
document.getElementById('activityRetry')?.addEventListener('click',()=>{if(activityRetry)sendActivityCommand(activityRetry);});
setInterval(readActivityControls,10000);readActivityControls();
