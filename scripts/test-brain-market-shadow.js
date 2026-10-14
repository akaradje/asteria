'use strict';
const a=require('node:assert/strict'),m=require('../src/planning/market-shadow');
const claims=[{id:'wing',resource:'Horn',n:3},{id:'wing',resource:'Horn',n:3},{id:'helper',resource:'Horn',n:2}];
a.equal(m.reserved(claims).totals.Horn,5);a.equal(m.reserved([...claims,{id:'wing',resource:'Horn',n:4}]).known,false);
a.equal(m.classify({item:'Horn',kind:'stack',owned:7,claims,requirementsComplete:true}).surplus,2);
a.equal(m.classify({item:'Horn',kind:'stack',owned:7,claims}).surplus,0);
a.equal(m.classify({item:'sword',kind:'gear',owned:3,claims:[],requirementsComplete:true}).surplus,0);
a.equal(m.history([{price:1,n:1}]).known,false);a.equal(m.history([10,10,10,10,10000].map(price=>({price,n:1}))).outliers,1);
const board={at:100,generation:1,tax:0,fee:0,max:10,list:[{id:'l',mine:false,item:'Horn',kind:'stack',price:600,n:3,unitPrice:200}],rowsValid:true,queryComplete:false};
let v=m.analyze({board,generation:1,now:110,wallet:900,reserveCopper:400,heldCopper:0,needs:[{item:'Horn'},{item:'Other'}]});
a.equal(v.parameters.fee,0);a.equal(v.buys[0].reason,'preserve_progression_reserve');a.equal(v.buys[1].reason,'query_incomplete');a.equal(v.claimedIncome,0);a.equal(v.executable,false);
a.equal(m.analyze({board,generation:2,now:110}).state,'WAIT_NATIVE_BOARD');a.equal(m.analyze({board,generation:1,now:40000}).state,'WAIT_NATIVE_BOARD');
console.log('PASS market shadow reservation dedup/conflict, exact-copy gate, outliers, stack budget, native zero rules, stale scope');

const {listing}=require('../src/observability/market-state'),native={id:1,item:'Horn',kind:'stack',n:1,price:10,expires:200};
a.equal(listing({...native,mine:1}).mine,true);a.equal(listing({...native,mine:0}).mine,false);a.equal(listing(native).mine,null);
a.equal(m.analyze({board:{...board,list:[{...board.list[0],mine:null}]},generation:1,now:110}).offers.length,0,'unknown owner is not a competing-seller quote');
