'use strict';
const crypto=require('node:crypto');
// Compare uncertainty, never erase or settle a payment. The execution adapters
// retain ownership of every transaction and reserved resource.
function uncertainty(i){
 const rows=[...(i.v2?.journal?.rows||[]),...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[])];
 const active=rows.filter(r=>['UNCERTAIN','OBSERVED','unresolved','spent_without_change'].includes(r.status)&&!r.closedSessionEvidence&&!settledProjection(i,r));
 if(i.teamTradeStatus?.phase==='UNCERTAIN')active.push(i.teamTradeStatus);
 // Projection/heartbeat timestamps are not new payments. Include a real
 // confirmation/context transition so ambiguity on the same UUID still stops.
 return [...new Set(active.map(r=>crypto.createHash('sha256').update(JSON.stringify(canonical([r.id||r.commandId||null,r.kind||null,r.id||r.commandId?null:r.at,r.status||r.phase,r.target||r.offer||null,r.context||null,r.confirmationSent===true||r.sent?.confirm===true,r.receiptId??r.receipt?.id??null]))).digest('hex')))].sort();
}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
function settledProjection(i,r){
 if(r.externalOwner!=='development-ledger'||!r.id?.startsWith('development:'))return false;
 const ledger=(i.developmentLedger?.rows||[]).find(x=>'development:'+x.id===r.id&&x.kind===r.kind&&x.at===r.at&&x.target?.id===r.target?.id);
 return require('../runtime/native-reservation-result').result(ledger,i.actorIdentity?.actorId)==='CONFIRMED';
}
module.exports={uncertainty,version:2};
