'use strict';
const assert=require('assert/strict'),vm=require('vm'),{GameInstance}=require('../src/instance');
function fixture({text='Promote',ready=true,disabled=false,save={}}={}){
 const i={lastSave:{job:'monk',lv:99,jobLv:50,coins:200000,materials:{},...save},lastSaveAt:Date.now(),opened:0,selected:[],log(){},catalog(){return {world:{HIGH_CLASSES:{highmonk:{from:'ironlotus'}},ASCEND:{open:true,lv:99,jobLv:50,coins:100000,items:{Core:1}}}};},async openGamePanel(){this.opened++;return {ok:true};},async closeGamePanel(){},async chooseJob(targets){this.selected.push(...targets);this.lastSave.job=targets[0];return {pick:targets[0]};}};
 const button={innerText:text,disabled,closest(){return ready?{}:null;},click(){}};
 i.eval=async js=>vm.runInNewContext(js,{document:{getElementById(){return button;}}});return i;
}
(async()=>{const english=fixture();const result=await GameInstance.prototype.advanceJob.call(english);assert(result.ok);assert.deepEqual(english.selected,['ironlotus']);
 const preview=fixture({text:'View third class',ready:false});assert.equal((await GameInstance.prototype.advanceJob.call(preview)).reason,'not-ready');assert.equal(preview.selected.length,0);
 const disabled=fixture({disabled:true});assert.equal((await GameInstance.prototype.advanceJob.call(disabled)).reason,'not-ready');
 const under=fixture({save:{lv:59}});assert.equal((await GameInstance.prototype.advanceJob.call(under)).reason,'class-requirements-missing');assert.equal(under.opened,0);
 const stale=fixture();stale.lastSaveAt-=31000;assert.equal((await GameInstance.prototype.advanceJob.call(stale)).reason,'fresh-save-required');assert.equal(stale.opened,0);
 const high=fixture({save:{job:'ironlotus'}});assert.equal((await GameInstance.prototype.advanceJob.call(high)).reason,'high-class-requirements-missing');assert.equal(high.opened,0);
 const full=fixture({save:{bag:Array(16).fill('item'),bagTier:0}});const originalCatalog=full.catalog;full.catalog=()=>{const c=originalCatalog();c.world.bagCap=tier=>16+8*tier;return c;};assert.equal((await GameInstance.prototype.advanceJob.call(full)).reason,'promotion-bag-space-required');assert.equal(full.opened,0);
 console.log('PASS English ready promotion, preview/disabled rejection, fresh-save and level gates, High Class material protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
