const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Learning}=require('../src/director');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-yield-')),l=new Learning(root,0,null);l.totals=[0,0,100,300];
const t=Date.now();l.observe({mapId:'w1',lv:1,exp:90,coins:100},t);l.observe({mapId:'w1',lv:2,exp:20,coins:80},t+5000);assert.equal(l.data.maps.w1.exp,30);assert.equal(l.data.maps.w1.coins,-20);
l.observe({mapId:'town',lv:2,exp:20,coins:1000},t+10000);l.observe({mapId:'w1',lv:2,exp:30,coins:1000},t+15000);assert.equal(l.data.maps.w1.exp,30);
l.observe({mapId:'w1',lv:2,exp:40,coins:1100},t+100000);assert.equal(l.data.maps.w1.exp,30);l.observe({mapId:'w1',lv:2,exp:40,coins:1100},t+105000);assert.equal(l.data.maps.w1.ms,10000);
console.log('PASS: learning includes level-up EXP, net costs and zero yield; excludes town/long gaps');
