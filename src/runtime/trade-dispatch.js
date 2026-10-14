'use strict';
const {fresh}=require('./freshness'),rules=require('../planning/team-trade');
// Native trade pauses saves. Only its exact, bounded open protocol can use
// fresh server offer/position evidence in place of a periodic save timestamp.
function allowed(i,kind,now=Date.now()){
 const command=kind.replace(/^social-/,''),r=i.tradeJournal,t=i.teamTradeIntent,c=r?.context,name=i.character?.name;
 if(!['troffer','trlock','trconfirm','trcancel'].includes(command)||!r||!t||r.id!==t.id||!r.sessionId||!c||!i.actorIdentity?.actorId||c.actorId!==i.actorIdentity.actorId||c.generation!==i.socialInbox?.generation||c.sessionStartedAt!==i.bagSessionStartedAt||c.build!==i.catalog().build||t.build!==c.build||!t.offer||![t.offer.donor,t.offer.receiver].includes(name))return false;
 if(i.recycling||i.healthRecovery||i.v2?.sourceCoherence?.matches!==true||!fresh(i.livePos?.at,10000,now)||i.livePos.room!=='town'||i.livePos.dead||!fresh(i.socialInbox?.streamAt,10000,now))return false;
 const cancel=command==='trcancel';
 if(!Number.isFinite(t.startedAt)||now<t.startedAt||now-t.startedAt>720000||!Number.isFinite(t.deadline)||now>t.deadline+(cancel?120000:0)||!cancel&&(!fresh(t.at,20000,now)||t.phase!=='SESSION'))return false;
 const frames=i.activityEvidence?.latest||{},open=frames.tropen,closed=frames.trclosed,done=frames.trdone,state=frames.trstate;
 const same=x=>x?.state?.id!=null&&String(x.state.id)===String(r.sessionId);
 const partner=name===t.offer.donor?t.offer.receiver:t.offer.donor;
 if(!same(open)||open.build!==c.build||open.at<Math.max(t.startedAt,c.sessionStartedAt)||open.state.with?.name!==partner||same(closed)&&closed.at>=open.at||same(done)&&done.at>=open.at)return false;
 if(cancel)return true; // cancellation never authorizes a payment or a retry
 if(!same(state)||state.build!==c.build||!fresh(state.at,15000,now)||state.at<open.at)return false;
 if(command==='troffer')return !state.state.me?.locked&&!state.state.me?.confirmed;
 if(state.state.dropped?.length||!rules.exactOffer(state.state.me,t.offer,name===t.offer.donor)||!rules.exactOffer(state.state.them,t.offer,name!==t.offer.donor))return false;
 return command==='trlock'?!state.state.me.locked:state.state.me.locked&&state.state.them.locked&&!state.state.me.confirmed;
}
module.exports={allowed};
