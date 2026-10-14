'use strict';
const assert=require('node:assert/strict'),{estimate}=require('../src/planning/dependency-time');
const nodes=[{id:'a',depends:[],resources:['actor:a'],durationMs:10},{id:'b',depends:[],resources:['actor:b'],durationMs:20},{id:'trade',depends:['a','b'],resources:['actor:a','actor:b'],durationMs:5},{id:'craft',depends:['trade'],resources:['actor:b'],durationMs:3}];
assert.equal(estimate(nodes).etaMs,28);assert.equal(estimate(nodes.map(n=>({...n,resources:['one']}))).etaMs,38);assert.equal(estimate(nodes.map(n=>n.id==='b'?{...n,durationMs:null}:n)).etaMs,null);assert.equal(estimate([{id:'a',depends:['b'],resources:[],durationMs:1},{id:'b',depends:['a'],resources:[],durationMs:1}]).state,'cycle');assert.throws(()=>estimate([{id:'a',depends:['missing'],resources:[],durationMs:1}]));
assert.equal(estimate([{id:'a',depends:[],resources:['a'],durationMs:null},{id:'b',depends:[],resources:['a'],durationMs:2}]).nodes[1].finishMs,null);
console.log('PASS parallel helpers, exclusive shared owner, unknown critical path and dependency cycle');
