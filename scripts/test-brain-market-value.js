'use strict';
const assert=require('node:assert/strict'),value=require('../src/planning/market-value');
 assert.equal(value.surplus({owned:20,ownNeed:3,teamNeed:5,held:2,buffer:2,complete:true,kind:'material'}).n,8);assert.equal(value.surplus({owned:20,complete:false}).n,0);assert.equal(value.surplus({owned:3,kind:'gear',complete:true}).n,0);
 assert.equal(value.listingValue({price:10000,n:5,tax:.05,fee:100,saleProbability:1,unsoldValue:0,capitalCost:0,opportunityCost:0}).netIfSold,9400);assert.equal(value.listingValue({price:100,n:1,tax:0,fee:0,saleProbability:1,unsoldValue:0,capitalCost:0,opportunityCost:0}).expectedValue,100);
 assert.equal(value.listingValue({price:100,n:1}).known,false);assert.equal(value.acquisition({buyPrice:100,availableCopper:150,reservedCopper:100,travelMs:0,buyMs:1,craftMs:10,equipMs:2,verifyMs:1,farmMs:1000}).choice,'farm');assert.equal(value.acquisition({buyPrice:0}).choice,'observe');
console.log('PASS pure market reserve, surplus, fees, unknown estimates and acquisition');
