'use strict';
// A previous loaded GAME build cannot certify a current payment outcome.
// It may close only its old budget after native ownership/session closure.
const crypto=require('node:crypto');
function validate(row,state,p,c,now=Date.now()){
 const d=require('./purchase-rebase').descriptor(row);
 if(!d||d.build===p?.build||now-row.at<600000||p?.authority!=='server_readback'||p.actorId!==d.actorId||p.actorId!==c?.currentActorId||p.build!==c.currentBuild||p.sessionStartedAt!==c.currentSessionStartedAt||p.generation!==c.currentGeneration||!Number.isSafeInteger(p.generation)||!Number.isSafeInteger(p.rev)||p.rev<=d.baselineRev||!Number.isFinite(p.requestAt)||!Number.isFinite(p.at)||p.requestAt<p.sessionStartedAt||p.at<p.requestAt||now<p.at||now-p.at>=30000||p.at-p.requestAt>=30000||p.sessionStartedAt-row.at<60000||p.sessionStartedAt<=d.sessionStartedAt)return null;
 if(c.kind!=='fresh_idle_executor_before_native_probe'||!c.schedulerIdle||!c.noInFlightPayment||!c.ownerSession||!Number.isSafeInteger(c.ownerGeneration)||!Number.isFinite(c.at)||c.at>p.requestAt||p.requestAt-c.at>=30000)return null;
 if(!state||!Number.isSafeInteger(state.coins)||state.coins<0||['tokens','runeDust','leaves'].some(k=>state[k]!==undefined&&(!Number.isSafeInteger(state[k])||state[k]<0))||['materials','consumables','keyItems'].some(k=>!state[k]||typeof state[k]!=='object'||Array.isArray(state[k])||Object.values(state[k]).some(n=>!Number.isSafeInteger(n)||n<0))||!Array.isArray(state.bag)||!state.equip||typeof state.equip!=='object'||Array.isArray(state.equip))return null;
 return {status:'RECONCILED',evidence:'native_current_budget_after_idle_purchase_executor',originalOutcome:{status:row.status,evidence:row.evidence??null,reason:row.reason??null},replayBlocked:true,reconciliation:{...p,originalBuild:d.build,currentStateOnly:true,budgetRebased:true,currentWallet:{Copper:state.coins,'Guild Token':state.tokens||0,'Rune Dust':state.runeDust||0,'Boar Leaf':state.leaves||0},currentInventorySha256:crypto.createHash('sha256').update(JSON.stringify(require('../result-ledger').snapshot(state))).digest('hex'),costKnown:false,historicalSuccessKnown:false,replayBlocked:true,executorClosure:{...c}}};
}
module.exports={validate};
