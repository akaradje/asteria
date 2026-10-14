'use strict';
const fs=require('fs'),file='logs/actions/224f8bebe587ec80.json',state=JSON.parse(fs.readFileSync(file));
const row=state.rows.find(r=>r.id==='b925b915-df88-499f-917b-f722d5459aaf');
if(row?.status==='UNCERTAIN'&&row.reason==="Cannot read properties of null (reading 'keyboard')"){
 fs.writeFileSync('logs/system-audit/ironpalm-supply-preflight-reconciliation.json',JSON.stringify({at:Date.now(),id:row.id,before:row.status,reason:row.reason,evidence:'walkTo failed before potion shop purchase evaluation; source preflight inspected'}));
 row.status='CANCELLED';row.evidence='failed_before_purchase_dispatch';row.reason='Farm stop interrupted movement before buy button evaluation; no purchase dispatched';fs.writeFileSync(file,JSON.stringify(state));
 console.log('Cancelled only the proven pre-purchase movement failure');
}else console.log('No matching unresolved preflight failure; unchanged');
