'use strict';
const crypto=require('node:crypto');
// Compare uncertainty, never erase or settle a payment. The execution adapters
// retain ownership of every transaction and reserved resource.
function uncertainty(i){
 const rows=[...(i.v2?.journal?.rows||[]),...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[])];
 const active=rows.filter(r=>['UNCERTAIN','OBSERVED','unresolved','spent_without_change'].includes(r.status)&&!r.closedSessionEvidence);
 if(i.teamTradeStatus?.phase==='UNCERTAIN')active.push(i.teamTradeStatus);
 return active.map(r=>crypto.createHash('sha256').update(JSON.stringify([r.id||r.commandId||null,r.kind,r.at,r.status||r.phase,r.target])).digest('hex')).sort();
}
module.exports={uncertainty};
