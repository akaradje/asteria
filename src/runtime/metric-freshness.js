'use strict';
function screenMetrics(details,now=Date.now(),performance=null){
 const useLive=Number.isFinite(performance?.at)&&performance.at>=(details?.fpsAt||details?.runtimeV2?.lastScreenAt||0);
 const at=useLive?performance.at:details?.fpsAt||details?.runtimeV2?.lastScreenAt||null;
 const age=Number.isFinite(at)?now-at:null;
 const fresh=age!==null&&age>=0&&age<30000;
 const value=useLive?performance.fps:details?.fps;
 return {fps:fresh&&Number.isFinite(value)?value:null,fpsAt:at,fpsAgeMs:age,fpsFresh:fresh,fpsSource:useLive?'live_telemetry':'snapshot'};
}
module.exports={screenMetrics};
