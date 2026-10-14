'use strict';
const assert=require('node:assert/strict'),r=require('../src/runtime/rolling-client-refresh'),now=Date.now();
const base={status:'playing',lastSaveAt:now,livePos:{room:'town'},runtimeV2:{phase:'FARMING',scheduler:{active:null},purchases:[]},development:[]};assert(r.safe(base,now));
for(const x of [{teamControl:{}},{choresBusy:true},{pendingTravel:{}},{recycling:true},{lastSaveAt:now-31000},{livePos:{room:'gd1'}},{dailyWorkStatus:{ownsNavigation:true}},{development:[{status:'pending'}]},{runtimeV2:{phase:'MAINTENANCE'}},{runtimeV2:{scheduler:{active:{kind:'paid'}}}},{teamTradeStatus:{phase:'VERIFYING'}}])assert(!r.safe({...base,...x},now));
const src=require('fs').readFileSync(require.resolve('../src/panel'),'utf8'),block=src.slice(src.indexOf('async function clientRefreshTick'),src.indexOf('const { AutoBrain'));assert(block.includes('semantic-client-refresh'));assert(!/refresh\.reload\(|await stop\(|await start\(/.test(block));
console.log('PASS per-actor refresh owner/native/payment/room/stop gates and no farm stop/start in game update path');
