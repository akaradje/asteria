'use strict';
// Socket position frames are delivered independently of page JavaScript. They
// cannot certify that a renderer still services automation requests.
function stalledRenderer(instance,now=Date.now()){
 const health=instance.rendererHealth;
 const screenAt=Math.max(instance.v2?.lastScreenAt||0,instance.v2?.observation?.at||0,instance.startedAt||0);
 const saveAt=instance.lastSaveAt||instance.startedAt||0;
 if(!health||!screenAt||!saveAt||now-screenAt<120000||now-saveAt<120000)return false;
 return health.consecutiveTimeouts>=3&&now-(health.lastSuccessAt||instance.startedAt||now)>=120000
  &&now-health.firstTimeoutAt>=120000&&now-health.lastTimeoutAt>=0&&now-health.lastTimeoutAt<90000;
}
module.exports={stalledRenderer};
