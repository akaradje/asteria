'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{context,farmWindowEligible}=require('./context-learning');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex').slice(0,24);
function key(build,s,g){return hash(JSON.stringify([context(build,s),g.kind,g.mapId,g.monsterId,g.itemId,g.questKey]));}
const owned=(s,id)=>Object.values(s.equip||{}).filter(x=>x===id).length+(s.bag||[]).filter(x=>(typeof x==='string'?x:x.id)===id).length;
class GoalFeedback{
 constructor(root,identity,{now=Date.now}={}){this.now=now;this.file=path.join(root,'logs/goal-feedback',hash(String(identity))+'.json');try{this.rows=JSON.parse(fs.readFileSync(this.file)).rows||{};}catch{this.rows={};}this.previous=null;this.savedAt=0;}
 interrupt(){if(this.previous&&this.rows[this.previous.key])this.rows[this.previous.key].quietMs=0;this.previous=null;}
 observe(i,build){const now=this.now(),s=i.lastSave,p=i.livePos,g=i.campaignGoal||i.goal;
  if(!build||!g?.monsterId||!farmWindowEligible(i,now)||p.room!==g.mapId){this.interrupt();return;}
  const k=key(build,s,g),sample={key:k,at:now,saveAt:i.lastSaveAt,kills:s.bestiary?.[g.monsterId]||0,items:g.itemId?owned(s,g.itemId):0,cardOwned:g.cardId?Number(require('../planning/campaign-side-work').ownsCard(s,g.cardId)):0,qIndex:s.qIndex,qHave:s.qHave||0,dead:!!p.dead};const prev=this.previous;if(prev?.saveAt===sample.saveAt)return;this.previous=sample;
  if(!prev||prev.key!==k||now<=prev.at||now-prev.at>90000){if(prev&&this.rows[prev.key])this.rows[prev.key].quietMs=0;if(this.rows[k])this.rows[k].quietMs=0;return;}
  const row=this.rows[k]||={build,kind:g.kind,map:g.mapId,monster:g.monsterId,item:g.itemId||null,samples:0,ms:0,kills:0,successes:0,deaths:0,quietMs:0};
  const kills=sample.kills-prev.kills,items=sample.items-prev.items;if(kills<0||items<0){row.quietMs=0;return;}
  const progress=g.kind==='main-quest'?(Number.isInteger(prev.qIndex)&&Number.isInteger(sample.qIndex)&&(sample.qIndex>prev.qIndex||sample.qIndex===prev.qIndex&&sample.qHave>prev.qHave)):g.kind==='gear-hunt'?items>0:g.kind==='card-collection'?sample.cardOwned>prev.cardOwned:kills>0;
  row.samples++;row.ms+=now-prev.at;row.kills+=kills;row.successes+=g.kind==='gear-hunt'?Math.max(0,items):progress?1:0;row.deaths+=Number(sample.dead&&!prev.dead);row.quietMs=kills>0||progress?0:row.quietMs+now-prev.at;row.at=now;
  if(sample.dead||row.quietMs>=180000){row.cooldownUntil=now+600000;row.reason=sample.dead?'เสียชีวิตระหว่างงานนี้':'ไม่มีจำนวนฆ่าหรือความคืบหน้า 3 นาที';}
  const recent=Object.entries(this.rows).sort((a,b)=>b[1].at-a[1].at).slice(0,200);this.rows=Object.fromEntries(recent);if(sample.dead||row.quietMs>=180000||now-this.savedAt>=60000){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,rows:this.rows}));fs.renameSync(this.file+'.tmp',this.file);this.savedAt=now;}
 }
 rank(candidates,s,build){const now=this.now();return candidates.map(g=>{const row=this.rows[key(build,s,g)],enough=row&&row.samples>=10&&row.ms>=300000&&now-row.at>=0&&now-row.at<86400000;const multiplier=enough?Math.max(.6,Math.min(1.2,1+Math.min(.2,row.successes/Math.max(1,row.samples))-row.deaths*.15)):1;return {...g,score:g.score*multiplier,feedback:{samples:row?.samples||0,minutes:Math.round((row?.ms||0)/60000),successes:row?.successes||0,deaths:row?.deaths||0,confidence:enough?'observational':'insufficient_samples',cooldownUntil:row?.cooldownUntil||null,multiplier,reason:row?.reason||null}};}).filter(g=>!(g.feedback.cooldownUntil>now)).sort((a,b)=>b.score-a.score);}
 view(){return {method:'same build and equipment context; observational evidence, not causal proof',rows:Object.values(this.rows).sort((a,b)=>b.at-a.at).slice(0,6)};}
}
module.exports={GoalFeedback,key};
