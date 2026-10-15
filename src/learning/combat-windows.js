'use strict';
const crypto=require('node:crypto');
const key=r=>JSON.stringify(['combat-aggregate-v1',r.actorId,r.build,r.sourceSignature,r.session,r.generation,r.job,r.level,r.role,r.map,r.target,r.party,r.loadoutSignature,r.telemetryVersion||1]);
const counters=['observedMs','samples','damage','damageFrames','damageTaken','takenFrames','healReceived','recipients','supportFrames','potions','kills','deaths','serverDeaths','saveIntervals','referenceHits','referenceDamage','referenceTaken','hpLoss','phpIntervals','serverPotions','buffObservedMs','partyObservedMs','partyRecipientMs','zeroDeathPartyMs','supportHeals','supportHealAmount','supportHealActiveMs','soloObservedMs','soloHpStableMs','soloPotionFreeMs','soloSelfHeals','soloSelfHealAmount','soloSelfBuffEvents'];
function microReady(r){return r.samples>=3&&r.observedMs>=10000&&(r.observedMs>=120000||r.kills>=30||r.damageFrames>=200);}
// Each raw row belongs to exactly one non-overlapping block. Gaps never add
// exposure; session/party/loadout/target changes never share a denominator.
function aggregate(rows,{now=Date.now(),maxAgeMs=3600000,maxGapMs=900000}={}){
 const groups=new Map(),out=[],seen=new Set();
 for(const r of [...rows].sort((a,b)=>a.startedAt-b.startedAt)){
  if(!r.id||seen.has(r.id)||!Number.isFinite(r.startedAt)||!Number.isFinite(r.at)||r.at>now||now-r.at>maxAgeMs||r.observedMs<=0)continue;seen.add(r.id);
  const k=key(r);let g=groups.get(k);
  if(!g||g.observedMs>=300000||r.startedAt-g.at>maxGapMs){g={...r,id:null,aggregate:true,constituentIds:[],ttk:[],damageTakenSamples:[],buffMs:{},supportBuffMs:{},startedAt:r.startedAt,at:r.at};for(const c of counters)g[c]=0;groups.set(k,g);out.push(g);}
  if(g.constituentIds.length&&r.startedAt<g.at)continue;
  for(const c of counters)g[c]+=Number.isFinite(r[c])?r[c]:0;
  for(const field of ['buffMs','supportBuffMs'])for(const [n,v]of Object.entries(r[field]||{}))if(Number.isFinite(v))g[field][n]=(g[field][n]||0)+v;
  g.ttk.push(...(r.ttk||[]));g.ttk=g.ttk.slice(-2048);g.damageTakenSamples.push(...(r.damageTakenSamples||[]));g.damageTakenSamples=g.damageTakenSamples.slice(-512);
  if(g.partyObservationSignature&&r.partyObservationSignature&&g.partyObservationSignature!==r.partyObservationSignature)g.partyCoverageBroken=true;
  g.at=r.at;g.constituentIds.push(r.id);g.confounded=!!(g.confounded||r.confounded);g.partyCoverageBroken=!!(g.partyCoverageBroken||r.partyCoverageBroken);g.partyDeathsObserved=!!(g.partyDeathsObserved||r.partyDeathsObserved);g.maxZeroDeathContinuousMs=Math.max(g.maxZeroDeathContinuousMs||0,r.maxZeroDeathContinuousMs||0);g.maxHp=Math.max(g.maxHp||0,r.maxHp||0);
  g.id='aggregate:'+crypto.createHash('sha256').update(g.constituentIds.join('|')).digest('hex');
 }
 return out;
}
module.exports={key,microReady,aggregate};
