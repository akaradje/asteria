'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const phase={purchase:'supplies','bag-upgrade':'space','storage-upgrade':'space',craft:'craft',equip:'equip'};
const terminal=new Set(['CONFIRMED','server_confirmed']);
function context(s){return hash([s.job,s.lv,s.equip,s.refine,s.stage,s.skills,s.petActive,s.petOpts,s.astral?.s]);}
function goal(i){return i.developmentProgress?.target?.id||i.endgameCampaign?.target||i.goal?.itemId||null;}
class CompletionMeasurements{
 constructor(root,actorId){this.actorId=actorId;this.file=path.join(root,'logs/completion-measurements.json');this.doc=require('../runtime/canonical-document').open(root,this.file,{version:1,actorId,stages:[],yield:[],receipts:[]});this.data=this.doc.data;if(this.data.version!==1||this.data.actorId!==actorId)throw Error('Completion measurement identity/schema mismatch');this.previous=null;}
 observe(i,state,proof){
  if(proof?.authority!=='server_accepted_save'||proof.actorId!==this.actorId||!Number.isSafeInteger(proof.rev))return;
  const build=proof.build,signature=context(state),goalId=goal(i),at=proof.at;let changed=false;
  for(const r of [...(i.v2?.journal?.rows||[]),...(i.developmentLedger?.rows||[]),...(i.equipmentLedger?.rows||[])]){
   const stage=phase[r.kind],receipt=r.serverReceipt,c=r.context,end=receipt?.at??r.finishedAt;
   if(!stage||!terminal.has(r.status)||r.evidence!=='server_accepted_exact_save_revision'||!c||c.actorId!==this.actorId||c.build!==build||!receipt||!Number.isFinite(end)||!Number.isFinite(r.at)||end<r.at||end-r.at>86400000||this.data.receipts.includes(r.id))continue;
   const target=stage==='craft'?r.target?.id:stage==='equip'?Object.values(r.target?.equip||{}).find(Boolean):goalId;
   if(!target)continue;this.data.receipts.push(r.id);
   if(!c.loadoutSignature)continue;const key=hash([build,c.loadoutSignature,target,stage]);let row=this.data.stages.find(x=>x.key===key);
   if(!row){row={key,build,signature:c.loadoutSignature,goalId:target,stage,samples:0,totalMs:0,at};this.data.stages.push(row);}
   row.samples++;row.totalMs+=end-r.at;row.at=end;changed=true;
  }
  const active=!i.choresBusy&&!i.teamControl&&!i.dailyTeamPending&&!i.pendingTravel&&!i.recycling&&!i.healthRecovery&&!i.v2?.journal?.pending?.()&&!i.developmentLedger?.pending?.()&&i.goal?.monsterId&&i.goal.mapId===i.livePos?.room&&!i.livePos?.dead&&i.v2?.sourceCoherence?.matches===true&&Number.isFinite(i.livePos?.at)&&at>=i.livePos.at&&at-i.livePos.at<10000;
  const key=active?hash([build,signature,i.goal.mapId,i.goal.monsterId,proof.generation]):null,prev=this.previous;
  this.previous=key?{key,at,rev:proof.rev,state:{materials:{...state.materials},kills:state.bestiary?.[i.goal.monsterId]||0},mapId:i.goal.mapId,monsterId:i.goal.monsterId}:null;
  if(prev&&key===prev.key&&proof.rev>prev.rev&&at>prev.at&&at-prev.at<=60000&&(state.bestiary?.[i.goal.monsterId]||0)>=prev.state.kills){
   const names=new Set([...Object.keys(prev.state.materials),...Object.keys(state.materials||{})]);
   for(const name of names){const id=hash([build,signature,i.goal.mapId,i.goal.monsterId,name]);let row=this.data.yield.find(x=>x.key===id);if(!row){row={key:id,build,signature,mapId:i.goal.mapId,monsterId:i.goal.monsterId,name,samples:0,observedMs:0,net:0,deaths:0,at};this.data.yield.push(row);}row.samples++;row.observedMs+=at-prev.at;row.net+=(state.materials?.[name]||0)-(prev.state.materials[name]||0);row.at=at;changed=true;}
  }
  if(changed){this.data.stages=this.data.stages.filter(x=>at>=x.at&&at-x.at<86400000).slice(-512);this.data.yield=this.data.yield.filter(x=>at>=x.at&&at-x.at<86400000).slice(-1024);this.data.receipts=this.data.receipts.slice(-4096);require('../runtime/canonical-document').save(this.doc,this.data);}
  i.acquisitionMeasurements=this.view(state,build,at);if(i.lastSave)i.lastSave.acquisitionMeasurements=i.acquisitionMeasurements;
 }
 view(s,build,at=Date.now()){
  const signature=context(s),result={},yieldRows=this.data.yield.filter(r=>r.build===build&&r.signature===signature&&at>=r.at&&at-r.at<86400000);
  for(const r of this.data.stages.filter(r=>r.build===build&&r.signature===signature&&at>=r.at&&at-r.at<86400000)){
   const out=result[r.goalId]||={};out[r.stage]={build,at:r.at,confirmed:true,samples:r.samples,meanMs:r.totalMs/r.samples,scope:'exact_actor_build_pre_action_loadout_goal',authority:'server_accepted_exact_save_revision'};
  }
  const yields=Object.fromEntries(yieldRows.map(r=>[r.mapId+':'+r.monsterId+':'+r.name,{build,at:r.at,samples:r.samples,observedMs:r.observedMs,netPerHour:r.net*3600000/r.observedMs,deaths:r.deaths,authority:'server_accepted_save',causalVerified:false}]));
  for(const out of Object.values(result))Object.assign(out,yields);result._yield=yields;return result;
 }
}
module.exports={CompletionMeasurements,context,goal};
