'use strict';
const assert=require('assert/strict'),{resume}=require('./windows-logon-start');
function fixture(){let stop='previous-session-stop',starts=0,calls=0,running=false;return {get starts(){return starts;},setStop:s=>{stop=s;},io:{readStop:()=>stop,clearStop:s=>{if(stop===s)stop=null;},guardian:async()=>{},health:async()=>({service:'asteria-panel',running}),start:async()=>{starts++;running=true;return {ok:true};},wait:async()=>{calls++;}}};}
(async()=>{
 let f=fixture();assert.equal((await resume(f.io)).state,'running');assert.equal(f.starts,1);
 f=fixture();f.io.health=async()=>({service:'asteria-panel',running:true});assert.equal((await resume(f.io)).state,'already-running');assert.equal(f.starts,0);
 f=fixture();f.io.guardian=async()=>f.setStop('new-manual-stop');assert.equal((await resume(f.io)).state,'user-stopped');assert.equal(f.starts,0);
 f=fixture();f.io.health=async()=>{f.setStop('stop-during-health');return {service:'asteria-panel',running:false};};assert.equal((await resume(f.io)).state,'user-stopped');assert.equal(f.starts,0);
 f=fixture();let tries=0;f.io.health=async()=>++tries<3?null:{service:'asteria-panel',running:tries>3};assert.equal((await resume(f.io)).state,'running');assert.equal(f.starts,1);
 f=fixture();let sent=0;f.io.start=async()=>{sent++;throw Error('timeout');};assert.equal((await resume(f.io)).state,'start-unconfirmed');assert.equal(sent,1);
 f=fixture();f.io.health=async()=>({service:'unrelated-service'});await assert.rejects(resume(f.io),/Unexpected service/);assert.equal(f.starts,0);
 f=fixture();f.io.health=async()=>null;assert.equal((await resume(f.io)).state,'panel-unavailable');assert.equal(f.starts,0);
 console.log('PASS 8 logon cases: previous stop, reuse, new stop, startup stop, delayed panel, uncertain start, service identity, unavailable panel');
})().catch(e=>{console.error(e);process.exitCode=1;});
