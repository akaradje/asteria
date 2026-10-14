const assert = require('node:assert/strict');
const { positionOf, mapCatalog } = require('../src/team-map');
const instance = { slot:0,status:'playing',character:{name:'Test'},lastSave:{mapId:'w1'},
  livePos:{room:'town',x:160,z:0,at:1000,mv:1} };
assert.equal(positionOf(instance,2000).room,'town'); // Do not use stale save.mapId.
assert.equal(positionOf(instance,2000).stale,false);
assert.equal(positionOf(instance,12000).stale,true);
instance.status='recycling'; assert.equal(positionOf(instance,2000).stale,true);
instance.livePos.room='tw:instance-7'; assert.equal(positionOf(instance).room,'tw:instance-7');
instance.livePos.z=NaN; assert.equal(positionOf(instance).room,null);
instance.livePos=null; assert.equal(positionOf(instance).x,null);
const maps=mapCatalog(require('../data/wiki.json'));
assert.ok(maps.find(m=>m.id==='town').bounds.x0>100);
assert.ok(maps.find(m=>m.id==='w1').bounds.x1<100);
assert.ok(!maps.find(m=>m.id==='w1').gates.some(g=>g.label===null));
assert.ok(!JSON.stringify(positionOf(instance)).includes('password'));
console.log('PASS: room consistency, stale/recycling positions, isolated room IDs, invalid coordinates, verified bounds');
