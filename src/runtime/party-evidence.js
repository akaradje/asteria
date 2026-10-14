'use strict';
// Party membership is an event stream: unchanged membership is not replayed.
// Keep its original timestamp; a live stream certifies the same socket session.
function observedAt(p,now=Date.now()){
 if(!p||!Number.isFinite(p._receivedAt)||p._receivedAt>now+5000)return null;
 if(p._sessionBound===true&&Number.isFinite(p._streamAt)&&now-p._streamAt>=-5000&&now-p._streamAt<15000)return p._streamAt;
 return now-p._receivedAt<90000?p._receivedAt:null;
}
module.exports={observedAt};
