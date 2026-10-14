'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),retry=require('../src/runtime/campaign-retry');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'craft-wait-'));try{
 const now=Date.now(),result={ok:false,sent:false,reason:'game update pending; loaded build differs'};let r={target:'wing',failures:30,reason:result.reason};
 for(let n=0;n<30;n++)r=retry.failed(r,'wing',result,now+n);assert.equal(r.failures,0);assert.equal(r.state,'waiting-build');assert.equal(r.blockedChecks,60);assert(r.safeSideWork);assert.equal(r.nextAt,now+29+600000);
 const uncertain=retry.failed(null,'wing',{...result,sent:true});assert.notEqual(uncertain.state,'waiting-build');assert(!uncertain.safeSideWork,'a dispatched command is never marked harmless update wait');
 fs.mkdirSync(path.join(root,'logs/game-knowledge'),{recursive:true});const file=path.join(root,'logs/game-knowledge/state.json'),i={root,catalog:()=>({build:'old'})};fs.writeFileSync(file,JSON.stringify({updatePending:true,liveBuild:'new',checkedAt:now}));assert.equal(retry.updateBlock(i,now).liveBuild,'new');fs.writeFileSync(file,JSON.stringify({updatePending:false,liveBuild:'old',checkedAt:now}));assert(retry.updateBlock(i,now).ok);assert.equal(retry.updateBlock(i,now+600001),null,'stale knowledge cannot prove update resolved');
 const vm=require('vm'),ctx={Date,state:{members:[]},esc:String,fmt:String};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/public/fleet-layout.js','utf8'),ctx);const ui=ctx.campaignSummary({endgameCampaign:{active:true,target:'wing',retry:{...r,failures:30}}});assert(ui.includes('ยังไม่ได้ส่งคำสั่งคราฟ'));assert(!ui.includes('ติดขัด 30'));
 console.log('PASS update wait is not a craft failure; legacy counter classification, sent/uncertain outcome protection, fresh matching build only and truthful UI');
}finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
