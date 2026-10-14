'use strict';
const assert=require('assert/strict'),{score,conclude}=require('./v3-soak');let now=1000000;
const r={roster:[{key:'windows:0',name:'a'},{key:'vps:0',name:'b'}],startedAt:now,actors:{},memory:{},epochs:{},observedMs:0,completeMs:0,samples:0,failures:0,gaps:[]};
function fleet(build='b1'){const m=(key)=>({key,online:true,detailsFresh:true,details:{lastSaveAt:now,lv:10,fps:20,fpsAt:now,levelProgress:{build}}});return {at:now,members:[m('windows:0')],expansion:{members:[m('vps:0')],complete:true,host:{freeMb:1000}},complete:true,machines:{windows:{host:{freeMb:1000}},tum:{host:{freeMb:1000}}}};}
score(r,fleet(),now);now+=30000;score(r,fleet(),now);assert.equal(r.completeMs,30000);assert.equal(r.actorAvailabilityPct,100);
now+=30000;score(r,fleet('b2'),now);assert.equal(Object.keys(r.epochs).length,2);assert.equal(r.completeMs,60000,'patch does not reset continuity');
now+=30000;const outage=fleet('b2');outage.expansion.members=[];score(r,outage,now);assert.equal(r.observedMs,90000);assert.equal(r.completeMs,60000);assert(r.actorAvailabilityPct<100,'missing expected member remains in denominator');
now+=120000;score(r,fleet('b2'),now);assert.equal(r.gaps.length,1);assert.equal(r.completeMs,60000,'unmeasured interval is not credited');assert.equal(conclude(r,now).longTermVerified,false,'short/gapped run cannot pass3h');
console.log('PASS twelve-roster scorecard denominator model, patch continuity, missing member, censored gap, and no premature stability claim');
const before=r.actors['windows:0'].lastLv;now+=30000;const delayed=fleet();delayed.members[0].details={lastSaveAt:now-40000,lv:999};score(r,delayed,now);assert.equal(r.lastSample.online,2,'validated light session telemetry is separate from delayed inventory/save snapshot');assert.equal(r.actors['windows:0'].lastLv,before,'old heavy snapshot cannot update progression');
now+=30000;const stale=fleet();stale.at=now-15001;score(r,stale,now);assert.equal(r.lastSample.online,0,'stale fleet response cannot certify service continuity');
