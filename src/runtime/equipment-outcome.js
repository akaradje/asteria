'use strict';
// Projection only. The original monetary ledger and its receipt are never edited.
function bind(i,status,startedAt){
 const rows=(i.developmentLedger?.rows||[]).filter(r=>r.kind===status.kind&&r.target?.id===status.id&&r.at>=startedAt&&r.at<=status.at&&r.context?.actorId===i.actorIdentity?.actorId);
 return {...status,startedAt,...(rows.length===1?{transactionId:rows[0].id}:{} )};
}
function view(i){
 const m=i.equipmentMaintenanceStatus;if(!m)return null;
 if(!m.transactionId||!['refine','craft'].includes(m.kind))return {...m};
 const r=i.developmentLedger?.rows?.find(r=>r.id===m.transactionId),c=r?.context,p=r?.serverReceipt;
 if(!r||r.kind!==m.kind||r.target?.id!==m.id||c?.actorId!==i.actorIdentity?.actorId)return {...m,status:'outcome_unverified',evidence:'matching_transaction_required'};
 const confirmed=['server_confirmed','server_no_increase'].includes(r.status)&&r.evidence==='server_accepted_exact_save_revision'&&p&&p.actorId===c.actorId&&p.build===c.build&&p.sessionStartedAt===c.sessionStartedAt&&p.generation===c.generation&&Number.isSafeInteger(p.rev)&&p.rev>c.baselineRev&&p.requestAt>r.at&&p.at>=p.requestAt;
 if(confirmed)return {...m,status:r.status,at:r.finishedAt||p.at,evidence:r.evidence,transactionId:r.id,paidConfirmed:true,upgradeConfirmed:r.status==='server_confirmed',ownerClosed:true,reason:r.status==='server_no_increase'?'เซิร์ฟเวอร์ยืนยันต้นทุนแล้ว ระดับไม่เพิ่ม · จบการทดลองครั้งนี้ ไม่ส่ง UUID เดิมซ้ำ':'เซิร์ฟเวอร์ยืนยันผลอัปเกรดแล้ว',serverReceipt:{...p}};
 if(r.status==='not_sent')return {...m,status:'not_sent',ownerClosed:true,paidConfirmed:false,upgradeConfirmed:false,evidence:r.evidence,reason:r.reason};
 return {...m,status:r.status==='pending'?'awaiting_outcome':r.status,evidence:r.evidence,paidConfirmed:false,upgradeConfirmed:false,ownerClosed:false};
}
module.exports={bind,view};
