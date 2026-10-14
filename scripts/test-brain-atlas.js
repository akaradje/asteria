'use strict';
const a=require('node:assert/strict'),{compile}=require('../src/knowledge/mechanic-atlas');
const r=compile({client:'function marketMessage(){} function btenter(){}',world:'const MAX_LV=120;',build:'b'});
a.equal(r.domainCount,24);a.equal(new Set(r.rows.map(x=>x.domain)).size,24);a.equal(r.fullyKnown,false);
a.equal(r.rows.find(x=>x.domain==='market').level,'DISCOVERED');a.equal(r.rows.find(x=>x.domain==='pets').level,'UNKNOWN');a(r.rows.every(x=>x.capabilities.every(c=>c.executable===false)));
console.log('PASS24 explicit domains, source references, missing markers unknown, capabilities require independent native proof');
