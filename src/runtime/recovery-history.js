'use strict';
const fs=require('fs'),path=require('path');
class RecoveryHistory{
 constructor(root,slot){this.file=path.join(root,'logs','recovery',String(slot)+'.json');const state=require('./preserved-history').read(this.file,x=>x);this.rows=state.rows;this.corrupt=state.corrupt;this.originalSha256=state.originalSha256;}
 begin(kind,reason,now=Date.now()){if(this.corrupt)throw Error('Recovery history corrupt; original preserved; automatic retry quarantined');if(this.rows.filter(r=>r.kind===kind&&now-r.startedAt>=0&&now-r.startedAt<900000).length>=3)throw Error('Recovery attempt budget exhausted; preserve evidence and replan');const row={id:now+'-'+this.rows.length,kind,reason:String(reason||'unknown').slice(0,500),startedAt:now,status:'running'};this.rows.push(row);this.rows=this.rows.slice(-100);this.save();return row;}
 finish(row,error,now=Date.now()){row.finishedAt=now;row.durationMs=now-row.startedAt;row.status=error?'failed':'recovered';if(error)row.error=String(error.message||error).slice(0,500);this.save();}
 save(){if(this.corrupt)throw Error('Preserved corrupt recovery cannot be overwritten');fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.rows));fs.renameSync(this.file+'.tmp',this.file);}
 view(){return this.corrupt?[{kind:'history_corrupt',status:'quarantined',reason:'Original recovery evidence preserved; automatic retry unavailable',originalSha256:this.originalSha256}]:this.rows.slice(-6).reverse();}
}
module.exports={RecoveryHistory};
