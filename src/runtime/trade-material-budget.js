'use strict';
const crypto=require('node:crypto'),fresh=require('./freshness').fresh;
const signature=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
function context(i){return {actorId:i.actorIdentity?.actorId,sessionStartedAt:i.bagSessionStartedAt,generation:i.socialInbox?.generation,build:i.catalog().build};}
function capture(i,intent,now=Date.now()){
 const r=i.tradeJournal,c=context(i),o=intent.offer;
 if(o?.goalKind!=='refine'||r?.id!==intent.id||r.sessionId||!fresh(i.lastSaveAt,30000,now)||i.registryV32?.store?.validateOwner(i.actorOwner)!==true||signature(c)!==signature(r.context))return false;
 const receipt=[i.serverSaveReceipt,i.acceptedSaveReceipt].find(x=>{const p=x?.proof;return p&&['server_readback','server_accepted_save'].includes(p.authority)&&fresh(p.at,30000,now)&&p.actorId===c.actorId&&p.sessionStartedAt===c.sessionStartedAt&&p.generation===c.generation&&p.build===c.build&&Number.isSafeInteger(p.rev)&&p.rev>=0&&Number.isFinite(p.requestAt)&&p.requestAt>=c.sessionStartedAt&&p.at>=p.requestAt&&x.state?.coins===i.lastSave.coins&&x.state?.materials?.[o.name]===i.lastSave.materials?.[o.name];});
 if(!receipt)return false;
 const work=require('../planning/team-workboard').project(i);
 r.materialBaseline={version:1,id:r.id,at:now,context:c,offerSignature:signature(o),proof:{...receipt.proof},materials:{...i.lastSave.materials},coins:i.lastSave.coins,work:{needs:work.needs,reserved:work.reserved,phase:work.phase},held:require('./paid-actions').heldResources(i)};
 return true;
}
function frozen(i,intent,now=Date.now()){
 const r=i.tradeJournal,b=r?.materialBaseline,o=intent.offer,c=context(i),f=i.activityEvidence?.latest||{},open=f.tropen,state=f.trstate;
 const same=x=>x?.state?.id!=null&&String(x.state.id)===String(r?.sessionId);
 if(!b||b.id!==intent.id||r.id!==intent.id||b.offerSignature!==signature(o)||signature(c)!==signature(b.context)||signature(c)!==signature(r.context)||i.registryV32?.store?.validateOwner(i.actorOwner)!==true||i.v2?.sourceCoherence?.matches!==true||i.recycling||i.stopped||i.stopRequested||i.status!=='playing'||i.autoChores===false||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.survivalRecovery||i.healthRecovery)return null;
 if(intent.phase!=='SESSION'||!fresh(intent.at,20000,now)||now>=intent.deadline||!fresh(b.at,150000,now)||!same(open)||open.build!==c.build||open.at<b.at||!fresh(open.at,120000,now)||open.state.with?.name!==(i.character.name===o.donor?o.receiver:o.donor)||!same(state)||state.build!==c.build||state.at<open.at||!fresh(state.at,15000,now)||same(f.trclosed)&&f.trclosed.at>=open.at||same(f.trdone)&&f.trdone.at>=open.at)return null;
 if(!fresh(i.livePos?.at,10000,now)||i.livePos.room!=='town'||i.livePos.dead||!fresh(i.socialInbox?.streamAt,10000,now)||i.lastSave.coins!==b.coins||signature(i.lastSave.materials)!==signature(b.materials)||i.lastSave.locks?.includes(o.name))return null;
 const rules=require('../planning/team-trade'),donor=i.character.name===o.donor;
 if(state.state.dropped?.length||!rules.exactOffer(state.state.me,o,donor)||!rules.exactOffer(state.state.them,o,!donor))return null;
 const held=require('./paid-actions').heldResources(i);
 if(Object.entries(held).some(([k,v])=>v>(b.held[k]||0))||i.activeResourceClaim||i.activeDevelopmentAttempt)return null;
 return {work:b.work,materials:b.materials};
}
module.exports={capture,frozen};
