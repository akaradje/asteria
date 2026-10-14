'use strict';
// Drop odds estimate effort, not a promised drop or elapsed farming time.
function effort(need,source){
 const short=Math.max(0,Number(need.want)-Number(need.have));
 return short>0&&Number.isFinite(source.ratePct)&&source.ratePct>0&&source.ratePct<=100?short/(source.ratePct/100):Infinity;
}
function value(c,need,source,{finishable=false,travelMs=0}={}){
 const expectedKills=effort(need,source),gain=Number.isFinite(c.gain)?Math.max(0,c.gain):0;
 return {finishable,short:Math.max(0,need.want-need.have),have:need.have,want:need.want,dropRatePct:source.ratePct,expectedKills:Number.isFinite(expectedKills)?Math.ceil(expectedKills):null,travelMs,
  score:(finishable?2600:1800)+(c.fillsEmpty?180:0)+Math.min(180,gain*2)-Math.min(450,Math.log1p(expectedKills)*55)-Math.min(180,travelMs/5000),
  method:'reviewed_drop_odds_and_remaining_quantity; expected kills are not guaranteed; gear gain is not DPS'};
}
module.exports={effort,value};
