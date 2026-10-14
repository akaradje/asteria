'use strict';
const terminal=new Set(['IDLE','COMPLETE','FINISHED','WITHDRAWN','UNCERTAIN']);
const fresh=(at,ms,now)=>Number.isFinite(at)&&at<=now&&now-at<ms;
// Observe outside the navigation scheduler. Never race a running action with
// another one, release an active server run, or replay an uncertain payment.
function inspect(i,now=Date.now()){
 const protectedRoom=/^(tw|dx|gd|pv)/.test(i.livePos?.room||'');
 const intent=i.fleetActivityIntent,unopened=intent&&['GATHERING','PREPARING'].includes(intent.phase)&&!intent.openAt&&!intent.runId&&!i.workflowAck?.sent;
 const expired=intent&&(terminal.has(intent.phase)||!Number.isFinite(intent.deadline)||intent.deadline<=now);
 const type=intent?.kind==='tower'?'tw':intent?.kind==='guild'?'gd':intent?.kind==='rift'?'dg':null;
 const native=type?require('../planning/fleet-activity').publicActivity(i)[type]:null;
 // A lost terminal peer update must not hold an already ended withdrawal
 // forever. Require fresh native absence of a run, outside its rooms, after
 // the old deadline. Keep its unknown entry/payment and no-replay records.
 const nativeIdle=!!(native?.build&&native.build===i.catalog?.().build&&fresh(native.at,30000,now)&&(native.run===null||native.run?.done));
 const endedDeadline=Number.isFinite(intent?.deadline)&&now-intent.deadline>=60000;
 const withdrawalEnded=!!(intent?.phase==='WITHDRAWING'&&endedDeadline&&nativeIdle);
 // The action loop cannot recheck an unresponsive renderer while an expired
 // pre-opening team owner holds it. Release only that unsent navigation with
 // fresh native absence of a run; the existing tick owns renderer recovery.
 const unresponsiveUnopened=!!(i.status==='unresponsive'&&unopened&&endedDeadline&&nativeIdle);
 const safe= fresh(i.lastSaveAt,30000,now)&&fresh(i.livePos?.at,10000,now)&&(i.status==='playing'||unresponsiveUnopened)&&!i.recycling&&!protectedRoom&&!i.tickBusy&&!i.fleetActivityBusy&&!i.choresBusy;
 const release=!!(safe&&i.teamControl&&(unopened&&expired||withdrawalEnded));
 const offer=i.teamTradeIntent?.offer,name=i.character?.name||i.credentials?.charName||i.char;
 // The coordinator broadcasts one pair to the fleet. An unrelated known
 // pair must not label every independent farmer as waiting on that trade.
 // Incomplete identity remains conservative; this observer never releases it.
 const unrelated=!!(name&&offer?.donor&&offer?.receiver&&name!==offer.donor&&name!==offer.receiver);
 const trading=offer&&!unrelated&&!['IDLE','CONFIRMED','CANCELLED','UNCERTAIN'].includes(i.teamTradeIntent.phase);
 const group=i.assistanceReservation,prep=i.milestonePreparationStatus;
 const preparing=prep?.expiresAt>now&&fresh(prep.lastIntentAt||prep.at,45000,now);
 const kind=i.teamControl?'team':i.choresBusy?'maintenance':trading?'trade':group?.expiresAt>now?'class-group':preparing?'class-preparation':i.pendingTravel?'travel':i.campaignGoal?.kind==='campaign-wait'?'campaign':'farm';
 i.workContinuity ||= {kind,startedAt:now};
 if(i.workContinuity.kind!==kind)i.workContinuity={kind,startedAt:now};
 const age=now-i.workContinuity.startedAt;
 const deadline=kind==='class-group'?group.expiresAt:kind==='class-preparation'?prep.expiresAt:kind==='team'?intent?.deadline:kind==='travel'?i.pendingTravel?.until:kind==='trade'?i.teamTradeIntent?.deadline:kind==='maintenance'?i.workContinuity.startedAt+180000:kind==='campaign'?i.campaignRetry?.nextAt||i.workContinuity.startedAt+180000:null;
 const overdue=Number.isFinite(deadline)&&now>=deadline;
 i.workContinuity={...i.workContinuity,at:now,ageMs:age,deadline:deadline||null,overdue,release,
  reason:release?withdrawalEnded?'ถอนตัวหมดเวลาและ native ยืนยันไม่มีรัน · กลับพัฒนาส่วนตัวโดยไม่ส่งรายการเก่าซ้ำ':'หมดเวลารวมทีมก่อนเปิดรอบ · กลับพัฒนาส่วนตัว':overdue?'งานเกินเวลา · ตรวจผลเดิมก่อนกู้คืน ไม่ส่งรายการซ้ำ':kind==='class-group'?'ทีมจองงานช่วยคลาส '+group.assignment?.recipient+' · '+(i.milestoneAssistStatus?.reason||i.milestoneAssistStatus?.state||'รวมพลและตรวจข้อมูลสด'):kind==='class-preparation'?'เตรียมทีมช่วยคลาส '+prep.recipient+' · '+(prep.reason||prep.state):kind==='farm'?'ฟาร์มส่วนตัวเดินต่อโดยไม่รอเครื่องอื่น':'งานมีเจ้าของ · รอผลจริงและกำหนดเวลา'};
 if(release){i.teamControl=false;i.dailyTeamPending=false;i.teamGoal=null;i.workContinuity.releasedAt=now;if(withdrawalEnded||unresponsiveUnopened)i.workContinuity.evidence={intentId:intent.id,build:native.build,nativeAt:native.at,authority:'native_no_active_run_navigation_released_not_payment_receipt'};}
 return i.workContinuity;
}
// A moving flag alone is not evidence of movement. Keep the existing bounded
// travel budget but extend only for a real position/map change from fresh data.
function travelMoving(pending,pos,now=Date.now()){
 if(!fresh(pos?.at,10000,now))return false;
 const previous=pending.position;
 const changed=previous&&(pos.room!==previous.room||Math.hypot(pos.x-previous.x,pos.z-previous.z)>=1);
 if(!previous||changed)pending.position={room:pos.room,x:pos.x,z:pos.z,at:now};
 if(changed)pending.movementAt=now;
 return !!(pos.mv&&fresh(pending.movementAt,15000,now));
}
// Optional town income must not steal an already-owned campaign or route.
// Survival restocking and the campaign's own journaled actions remain separate.
function optionalTownWorkAllowed(i){
 return !i.pendingTravel&&!i.teamControl&&!i.dailyWorkStatus?.ownsNavigation
  &&(!i.campaignGoal||i.campaignGoal.kind==='campaign-wait'&&i.campaignGoal.mapId==='town');
}
// Reconcile before survival/town work: a stale travel owner must not hide an
// already-observed arrival or block essential supplies for another three minutes.
function reconcileTravel(i,now=Date.now()){
 const p=i.pendingTravel,pos=i.livePos;
 if(!p||i.teamControl||i.dailyTeamPending||i.dailyWorkStatus?.ownsNavigation||i.choresBusy||i.recycling||/^(tw|dx|gd|pv)/.test(pos?.room||'')||require('./team-trade').blocksNavigation(i,now)||!fresh(pos?.at,10000,now))return null;
 if(pos.room===p.mapId&&!pos.dead){i.pendingTravel=null;i.brain.arrived(p.mapId);i.progressAt=now;i.stuckCount=0;return 'arrived';}
 if(pos.dead)return null;
 p.observedAt??=now;travelMoving(p,pos,now);
 const stationary=now-(p.movementAt||p.observedAt)>=45000;
 if(!stationary&&now<p.until)return null;
 if(!stationary&&travelMoving(p,pos,now)&&(p.extends||0)<3){p.extends=(p.extends||0)+1;p.until=now+120000;return 'moving';}
 i.pendingTravel=null;
 const reason=stationary?'fresh positions unchanged for 45 seconds':'travel deadline expired';
 i.travelRecoveryStatus={at:now,target:p.mapId,room:pos.room,reason};
 if(i.brain.travelFailure(p.mapId)){i.goal=null;i.teamGoal=null;i.refreshGoal?.();}
 i.log?.('director: released stalled travel -> '+p.mapId+' ('+reason+')','warn');
 return 'released';
}
module.exports={inspect,travelMoving,reconcileTravel,optionalTownWorkAllowed};
