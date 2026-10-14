'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const quantity=n=>Number.isFinite(n)&&n>=0?n:0;
class ResourceReservations{
 constructor(root,identity){this.file=path.join(root,'logs','reservations',crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0,24)+'.json');try{this.data=require('../runtime/canonical-document').existing(root,this.file)||JSON.parse(fs.readFileSync(this.file));}catch(e){if(e.code!=='ENOENT')throw Error('reservation journal unreadable; paid work must stop');this.data={version:1,claims:[]};}this.document=require('../runtime/canonical-document').open(root,this.file,this.data);if(this.document)this.data=this.document.data;let dirty=false;for(const r of this.data.claims)if(r.status==='STARTED'){r.status='UNCERTAIN';r.reason='restart after durable intent; reconcile before releasing resources';dirty=true;}if(dirty)this.save();}
 save(){require('../runtime/canonical-document').save(this.document,this.data);fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 reserve(id,cost,available,{build,at=Date.now(),ttl=180000}={}){this.expire(at);if(this.data.claims.some(c=>c.id===id))return {ok:false,reason:'duplicate claim'};const reserved=this.totals(build),missing=Object.entries(cost).filter(([k,n])=>!Number.isFinite(n)||n<0||quantity(available[k])-quantity(reserved[k])<n);if(missing.length)return {ok:false,reason:'insufficient unreserved resources',missing:missing.map(([key])=>key)};this.data.claims.push({id,build,at,deadline:at+ttl,cost,status:'RESERVED'});this.save();return {ok:true};}
 started(id,{trackDispatch=false}={}){const r=this.data.claims.find(r=>r.id===id&&r.status==='RESERVED');if(!r)return false;r.status='STARTED';if(trackDispatch)r.dispatchTracking={version:1,state:'preparing'};this.save();return true;}
 markDispatch(id){const r=this.data.claims.find(r=>r.id===id&&r.status==='STARTED');if(!r||r.dispatchTracking?.version!==1||r.dispatchTracking.state!=='preparing')throw Error('Resource dispatch boundary changed');r.dispatchTracking={version:1,state:'possible',at:Date.now()};this.save();}
 cancelPreparation(id){const r=this.data.claims.find(r=>r.id===id&&r.status==='STARTED');if(!r||r.transactionId||r.dispatchTracking?.version!==1||r.dispatchTracking.state!=='preparing')return false;r.status='CANCELLED';r.reason='tracked failure before native payment dispatch';this.save();return true;}
 link(id,transactionId){const r=this.data.claims.find(r=>r.id===id&&r.status==='STARTED');if(!r||!transactionId)throw Error('Missing started resource claim');r.transactionId=transactionId;this.save();}
 finish(id,status){const r=this.data.claims.find(r=>r.id===id);if(r){r.status=status;this.save();}}
 expire(now){let dirty=false;for(const r of this.data.claims)if(r.deadline<=now&&r.status==='RESERVED'){r.status='CANCELLED';dirty=true;}if(dirty)this.save();}
 totals(build,excludeId=null){const out={};for(const c of this.data.claims)if(c.id!==excludeId&&['RESERVED','STARTED','UNCERTAIN'].includes(c.status))for(const[k,n]of Object.entries(c.cost))out[k]=(out[k]||0)+n;return out;}
 view(build){return {reserved:this.totals(build),claims:this.data.claims.slice(-12)};}
}
module.exports={ResourceReservations};
