'use strict';
// Read-only target projection of the same guards used by the paid executor.
function check(i,id,options={}){
 const row=i.developmentLedger?.blocking('refine');
 if(row)return {allowed:false,kind:'refine',target:id,status:'blocked',reason:'existing development result awaiting reconciliation',transactionId:row.id,evidence:row.evidence||null,at:row.at,missing:[]};
 if(i.v2?.trial?.active())return {allowed:false,kind:'refine',target:id,status:'blocked',reason:'paid work paused during zero-spend trial',missing:[]};
 const p=require('./paid-actions').preflight(i,'refineEquipped',[{...options,targetId:id}]);
 return {allowed:p.allowed,kind:'refine',target:id,status:p.allowed?'eligible':'blocked',reason:p.reason,missing:p.missing||[],historicalRows:(i.v2?.journal?.rows||[]).filter(r=>r.kind==='refine'&&r.target?.id===id&&['OBSERVED','UNCERTAIN'].includes(r.status)).length,unknownReplayAllowed:false};
}
function investmentOptions(i){return {refineGate:(id,options)=>check(i,id,options)};}
module.exports={check,investmentOptions};
