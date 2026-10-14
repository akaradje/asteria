'use strict';
const {execFile}=require('child_process');
const fresh=(at,limit,now)=>Number.isFinite(at)&&now>=at&&now-at<limit;
function project(data,now=Date.now()){
 const age=Number.isFinite(data?.at)?now-data.at:null,snapshot=Date.parse(data?.extra?.snapshotAt);
 const owner=data?.owner,v=data?.extra?.version,pv=data?.primary?.version;
 const aligned=!!(v?.aligned&&pv?.aligned&&v.sourceRevision===v.loadedSystemRevision&&v.sourceRevision===pv.sourceRevision&&v.build===pv.build);
 const row=(data?.extra?.rows||[]).find(i=>i.char==='YouLater');
 const saveAgeMs=Number.isFinite(row?.saveAgeMs)&&Number.isFinite(age)?row.saveAgeMs+age:null;
 const ready=!!row&&owner?.character==='YouLater'&&owner.state==='running'&&fresh(owner.at,45000,now)
   &&fresh(data.at,30000,now)&&fresh(snapshot,45000,now)&&aligned;
 const online=!!(ready&&row?.status==='playing'&&saveAgeMs>=0&&saveAgeMs<30000);
 const number=n=>Number.isFinite(n)?n:null;
 const text=t=>typeof t==='string'?t.slice(0,80):null;
 return {expected:1,online:online?1:0,charName:'YouLater',machine:'tum-extra',solo:true,
   state:ready?'running':owner?.state==='paused'?'paused':'checking',
   message:ready?'ฟาร์มส่วนตัว · แยกจากปาร์ตี้หลัก':owner?.state==='paused'?'พักตัวเสริม · รอตรวจเซสชันหรือภาระเครื่อง':'รอข้อมูลสดของตัวเสริม',
   snapshotAt:Number.isFinite(snapshot)?snapshot:null,saveAgeMs:saveAgeMs>=0?saveAgeMs:null,
   details:ready?{lv:number(row.lv),job:text(row.job),exp:number(row.exp),fps:number(row.fps),map:text(row.map),petActive:text(row.petActive),work:text(row.work)}:null};
}
let cached=null,pending=null;
async function view(){
 const now=Date.now();if(cached&&now-cached.at<10000)return project(cached.data,now);
 if(!pending)pending=new Promise(resolve=>execFile('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','deploy@192.0.2.11',
   'cd /opt/asteria-node-a/asteria-youlater && node logs/system-audit/youlater-live.cjs'],{windowsHide:true,timeout:8000,maxBuffer:65536},(e,out)=>{
   let data=null;if(!e)try{data=JSON.parse(out);}catch{}
   cached={at:Date.now(),data};resolve(data);
 })).finally(()=>{pending=null;});
 return project(await pending,Date.now());
}
module.exports={project,view};
