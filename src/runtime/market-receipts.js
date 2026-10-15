'use strict';
// The market protocol has no request ID. Only one observed attempt in one
// character connection may consume a response; old page hooks are not evidence.
function context(i){return {actorId:i.actorIdentity?.actorId,sessionStartedAt:i.bagSessionStartedAt,generation:i.socialInbox?.generation,build:i.catalog().build};}
function validContext(c){return !!c&&typeof c.actorId==='string'&&c.actorId.length>0&&Number.isFinite(c.sessionStartedAt)&&c.sessionStartedAt>0&&Number.isSafeInteger(c.generation)&&c.generation>0&&typeof c.build==='string'&&c.build.length>0;}
function sameContext(a,b){return validContext(a)&&validContext(b)&&['actorId','sessionStartedAt','generation','build'].every(k=>a[k]===b[k]);}
function response(row,m){
 return row?.marketContractVersion===2&&validContext(row.context)&&Number.isSafeInteger(row.marketBaselineSequence)&&Number.isSafeInteger(row.marketCommandSequence)&&Number.isFinite(row.dispatchAt)&&m?.t==='mkr'&&m._nativeMarket===true&&m._generation===row.context.generation&&Number.isSafeInteger(m._sequence)&&m._sequence>row.marketBaselineSequence&&m._receivedAt>row.dispatchAt&&m.op==='mbuy'&&m._command?.op==='mbuy'&&m._command.sequence===row.marketCommandSequence+1&&m._command.at>=row.dispatchAt&&m._command.at<=m._receivedAt&&m._command.lid===row.target.listingId;
}
function matches(row,m){
 if(!response(row,m)||!(m.ok===true||m.ok===1)||m.no||!m._deltaValid||(m.rev!=null&&(!Number.isSafeInteger(m.rev)||m.rev<0))||m.res?.item!==row.target.item||m.res?.n!==row.target.n||m.res?.price!==row.target.price)return false;
 if(Number.isSafeInteger(row.context.baselineRev)&&m.rev!=null&&m.rev<=row.context.baselineRev)return false;
 const d=m.d;
 return d?.coins===-row.target.price&&d.mats?.[row.target.item]===row.target.n&&Object.entries(d).every(([k,v])=>k==='coins'||k==='mats'&&Object.keys(v).length===1);
}
function rejected(row,m){return response(row,m)&&!m.ok&&['gone','coins','own','bagfull','cap','town','guest','save','missing','locked'].includes(m.no)&&(!m.d||m._deltaValid&&Object.keys(m.d).length===0);}
function proof(row,m){return {...row.context,sequence:m._sequence,command:{...m._command},at:m._receivedAt,rev:m.rev??null,op:m.op,item:m.res.item,n:m.res.n,price:m.res.price,authority:'server_socket',delta:{coins:m.d.coins,mats:{...m.d.mats}}};}
function persisted(row){const p=row?.nativeReceipt;return !!p&&sameContext(row.context,p)&&p.authority==='server_socket'&&matches(row,{t:'mkr',op:p.op,ok:true,_nativeMarket:true,_generation:p.generation,_sequence:p.sequence,_command:p.command,_receivedAt:p.at,rev:p.rev,_deltaValid:true,d:p.delta,res:{item:p.item,n:p.n,price:p.price}});}
// Explicitly authorized listing extension. Purchase v2 stays byte-for-byte
// above. A v3 stack listing needs exact fee/escrow plus authenticated save delta.
function listingResponse(row,m){const c=m?._command,t=row?.target;return row?.marketContractVersion===3&&validContext(row.context)&&m?.t==='mkr'&&m.op==='mlist'&&m._nativeMarket===true&&m._generation===row.context.generation&&Number.isSafeInteger(m._sequence)&&m._sequence>row.marketBaselineSequence&&m._receivedAt>row.dispatchAt&&c?.op==='mlist'&&c.sequence===row.marketCommandSequence+1&&c.at>=row.dispatchAt&&c.at<=m._receivedAt&&c.kind==='stack'&&c.item===t.item&&c.n===t.n&&c.price===t.price&&c.each===null;}
function listingMatches(row,m){const t=row?.target;return listingResponse(row,m)&&(m.ok===true||m.ok===1)&&!m.no&&m._deltaValid&&Number.isSafeInteger(m.rev)&&m.rev>row.context.baselineRev&&m.res?.item===t.item&&m.res?.n===t.n&&m.res?.price===t.price&&(m.d?.coins||0)===-t.fee&&m.d?.mats?.[t.item]===-t.n&&Object.keys(m.d.mats).length===1&&Object.keys(m.d).every(k=>['coins','mats'].includes(k));}
function listingRejected(row,m){return listingResponse(row,m)&&!m.ok&&['coins','missing','locked','max','town','save','guest','price','cap','item'].includes(m.no)&&m._deltaValid&&Object.keys(m.d||{}).length===0;}
module.exports={context,validContext,sameContext,response,matches,rejected,proof,persisted,listingResponse,listingMatches,listingRejected};
