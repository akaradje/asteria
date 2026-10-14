'use strict';
// Native UI mode only. No emulated combat, injected timers or alternative game
// transport. A single explicitly selected canary is required before expansion.
function controls(want){
 const active=document.body.classList.contains('botmode')&&!!document.getElementById('botCon');
 if(active===want)return {ok:true,active,changed:false};
 const button=want?document.getElementById('botModeGo'):document.querySelector('#botCon [data-bc="exit"]');
 if(!button||button.disabled)return {ok:false,active,reason:'native_control_missing'};
 button.click();const after=document.body.classList.contains('botmode')&&!!document.getElementById('botCon');
 return {ok:after===want,active:after,changed:after!==active,evidence:'native_UI_mode_not_performance_proof'};
}
function eligible(i,now=Date.now()){
 const ids=i.registryV32?.policy.nativeBotConsoleCanary;
 if(!Array.isArray(ids)||ids.length!==1||ids[0]!==i.actorIdentity?.actorId)return false;
 return controllable(i,now);
}
function blocker(i,now=Date.now()){
 if(i.status!=='playing')return 'actor_not_playing';
 if(!Number.isFinite(i.lastSaveAt)||now<i.lastSaveAt||now-i.lastSaveAt>=30000)return 'fresh_save_required';
 if(i.v2?.sourceCoherence?.matches!==true)return 'current_native_source_required';
 if(i.recycling||i.choresBusy||i.teamControl||i.dailyTeamPending||i.pendingTravel)return 'current_work_owner_busy';
 if(require('./astral').journalBlocks(i,'native-ui-mode'))return 'current_or_unknown_payment_scope';
 if(i.developmentLedger?.pending?.())return 'development_outcome_pending';
 if(i.teamTradeStatus?.phase&&!['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))return 'trade_outcome_pending';
 return null;
}
function controllable(i,now=Date.now()){return blocker(i,now)===null;}
function observedActive(i,now=Date.now()){
 const o=i.v2?.observation,r=i.nativeBotConsole,g=i.socialInbox?.generation??null;
 const latest=r&&i.actorIdentity?.actorId&&r.actorId===i.actorIdentity.actorId&&r.generation===g&&Number.isFinite(r.at)&&now>=r.at&&now-r.at<30000&&r.at>=(o?.at||0)?r:null;
 if(latest)return latest.active===true;
 return Number.isFinite(o?.at)&&now>=o.at&&now-o.at<30000&&o.nativeBotConsole===true;
}
function readiness(i,now=Date.now()){const ids=i.registryV32?.policy.nativeBotConsoleCanary;return {at:now,selected:Array.isArray(ids)&&ids.length===1&&ids[0]===i.actorIdentity?.actorId,reason:!Array.isArray(ids)||ids.length!==1?'one_actor_canary_not_selected':ids[0]!==i.actorIdentity?.actorId?'other_canary_selected':blocker(i,now)||'ready',active:observedActive(i,now)};}
async function tick(i,now=Date.now()){
 const desired=eligible(i,now),active=observedActive(i,now);
 if(!controllable(i,now)||desired===active||((!active||i.nativeBotConsole?.ok===false)&&now-(i.nativeBotConsole?.at||0)<60000))return null;
 if(!i.v2?.scheduler?.context.getStore())return null;
 if(desired){const opened=await i.openGamePanel('settings');if(!opened?.ok){i.nativeBotConsole={ok:false,active,desired,reason:'native_settings_panel_unavailable',at:now,generation:i.socialInbox?.generation??null,build:i.catalog().build,actorId:i.actorIdentity.actorId,performanceVerified:false};return null;}}
 const result=await i.eval(`(() => {${desired?'document.querySelector(\'[data-set-tab="combat"]\')?.click();':''}return (${controls.toString()})(${desired});})()`);
 i.nativeBotConsole={...result,desired,at:now,generation:i.socialInbox?.generation??null,build:i.catalog().build,actorId:i.actorIdentity.actorId,performanceVerified:false};
 if(!result.ok&&desired)await i.closeGamePanel?.();return result.ok?desired?'native bot console selected; performance canary pending':'native bot console exited through native UI':null;
}
module.exports={controls,eligible,controllable,blocker,readiness,observedActive,tick};
