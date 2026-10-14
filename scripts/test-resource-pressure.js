'use strict';
const assert=require('assert/strict'),{ResourcePressure}=require('../src/runtime/resource-pressure');
const p=new ResourcePressure(),i={lastFps:8,lastFpsAt:100000,targetFps:25,sceneSyncMs:250,livePos:{room:'w1'}};
assert.equal(p.observe(i,100000).mode,'normal');assert.equal(p.observe(i,100001),null,'repeated same FPS sample cannot accumulate pressure');
i.lastFpsAt+=5000;p.observe(i,i.lastFpsAt);i.lastFpsAt+=5000;assert.equal(p.observe(i,i.lastFpsAt).mode,'reduced');assert.equal(i.resourceHealth.sceneSyncMs,1000);assert.equal(i.resourceHealth.targetFps,20);
i.resourceProfileApplied=true;i.lastFps=25;for(let n=0;n<5;n++){i.lastFpsAt+=5000;assert.equal(p.observe(i,i.lastFpsAt),null);}i.lastFpsAt+=5000;assert.equal(p.observe(i,i.lastFpsAt).mode,'normal');
assert.equal(p.observe({...i,lastFpsAt:i.lastFpsAt+20000},i.lastFpsAt),null);assert.equal(p.observe({...i,lastFpsAt:i.lastFpsAt+1},i.lastFpsAt+20000),null);
i.livePos.room='tw#1';i.lastFps=5;for(let n=0;n<3;n++){i.lastFpsAt+=5000;p.observe(i,i.lastFpsAt);}assert.equal(i.adaptiveTickMs,5000,'team safety cadence stays intact');
console.log('PASS actual FPS freshness, independent samples, hysteresis, bounded housekeeping and unchanged team safety cadence');
