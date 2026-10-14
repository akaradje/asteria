'use strict';
// A completion estimate has an explicit unknown for every unmeasured stage.
const stages=['supplies','space','travel','gather','trade','craft','equip','verify'];
function plan({beneficiary,goalId,bill={},holdings={},requirements=[],measurements={},requiresTrade=false,now=Date.now(),build}={}){
 const nodes=stages.map((id,n)=>({id,depends:n?[stages[n-1]]:[],state:'PENDING',etaMs:null,evidence:null}));
 const unavailable=[];for(const node of nodes){
  if(node.id==='trade'&&!requiresTrade){node.state='NOT_REQUIRED';node.etaMs=0;continue;}
  if(node.id==='gather'){
   let ms=0,known=true;for(const r of requirements){const short=Math.max(0,(r.want??r.need??0)-(holdings[r.name]??r.have??0));if(!short)continue;const samples=(r.sources||[]).map(s=>measurements[s.mapId+':'+s.monsterId+':'+r.name]).filter(x=>x?.build===build&&Number.isFinite(x.at)&&now>=x.at&&now-x.at<86400000&&x.samples>=10&&x.observedMs>=300000&&x.netPerHour>0&&x.deaths===0);if(!samples.length){known=false;unavailable.push(r.name);continue;}ms+=short/Math.max(...samples.map(x=>x.netPerHour))*3600000;}
   node.etaMs=known?ms:null;node.evidence=known?'same_build_personal_net_yield':'unmeasured_resource_yield';continue;
  }
  const m=measurements[node.id];if(m?.build===build&&m.confirmed===true&&m.samples>=3&&Number.isFinite(m.meanMs)&&m.meanMs>=0){node.etaMs=m.meanMs;node.evidence='measured_completed_stage';}
 }
 const dependencyEstimate=require('./dependency-time').estimate(nodes.map(n=>({id:n.id,depends:n.depends,durationMs:n.etaMs,resources:['beneficiary:'+String(beneficiary||'unresolved')]})));return {version:2,beneficiary:beneficiary||null,goalId:goalId||null,build:build||null,bill,nodes,dependencyEstimate,etaMs:dependencyEstimate.etaMs,unknownStages:nodes.filter(n=>n.etaMs===null).map(n=>n.id),unmeasuredResources:[...new Set(unavailable)],completion:['received','equipped','refined','native_confirmed','benefit_measured'],method:'whole_cycle_personal_evidence; no drop-time guarantee',causalVerified:false};
}
module.exports={plan,stages};
