'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const r=require('../src/runtime/free-rewards'),p=require('../src/power-plan');
async function main(){
 const text=fs.readFileSync('cache/fd417f6/asteria-online.io/asteria-online-visual-polish.html','utf8');assert(r.sourceReviewed(text));assert(!r.sourceReviewed(text.replace("NET.social('gpull', { n, how })","NET.social('gpull', { n, how: 'coin' })")));
 const liveBuild=JSON.parse(fs.readFileSync('machines/fleet-client-release.json')).build;
 const liveText=fs.readFileSync('cache/'+liveBuild+'/asteria-online.io/asteria-online-visual-polish.html','utf8');
 assert(r.sourceReviewed(liveText),'the pinned fleet build must have individually reviewed native reward capabilities');
 const giftStart=liveText.indexOf('function giftReceived(m){'),giftEnd=liveText.indexOf('/* ---------- Field events + achievements',giftStart);
 assert(giftStart>=0&&giftEnd>giftStart);
 assert(!r.sourceReviewed(liveText.slice(0,giftStart)+liveText.slice(giftStart,giftEnd).replace('NET.setRev(m.rev);','NET.setRev(m.rev); player.coins += 999999;')+liveText.slice(giftEnd)),'a changed gift economy must not inherit reviewed reveal-only approval');
 assert(!r.sourceReviewed(liveText.replace("NET.social('gpull', { n, how })","NET.social('gpull', { n, how: 'coin' })")),'current gacha payment mutation remains rejected');
 const catalog=[{id:'mag',slot:'wing',gacha:1,price:0,stats:{matkPct:.05}},{id:'phys',slot:'wing',gacha:1,price:0,stats:{atkPct:.05}},{id:'chat',slot:'chat',cbt:1,price:0,stats:{}}];
 assert.equal(p.ownedPremiumPlan(catalog,{owned:['mag','phys','chat'],worn:{}},'mage',{}).items.find(x=>x.slot==='wing').id,'mag');assert.equal(p.ownedPremiumPlan(catalog,{owned:['mag','phys'],worn:{}},'ranger',{}).items[0].id,'phys');assert.equal(p.premiumPlan(catalog,{owned:[],coins:999,worn:{}},'mage',{}).items.length,0,'zero price does not make unowned gacha purchasable');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-rewards-'));let state={mail:{list:[{id:1,items:{ticket:11},got:false},{id:2,items:{ticket:0},got:true}]},ach:{done:{lv10:true},got:{},pts:5},gst:{pulls:0,tickets:0,free:1,pity:0,dust:0},prem:{owned:['chat'],worn:{},coins:50}};let commands=[],unknown=false;
 const i={root,character:{name:'Test'},credentials:{job:'mage'},lastSave:{job:'novice'},cache:{dir:path.join(root,'cache','fd417f6')},catalog:()=>({world:{PREMIUM:catalog}}),eval:async()=>true};
 const read=async(_i,_c,t)=>({...JSON.parse(JSON.stringify(state[t])),_receivedAt:Date.now()});
 const send=async(_i,k,v)=>{commands.push([k,v]);if(k==='mailget'){state.mail.list[0].got=true;state.gst.tickets=11;}if(k==='achclaim')state.ach.got[v.id]=true;if(k==='gpull'){state.gst.pulls+=v.n;state.gst.pity+=v.n;if(v.how==='ticket')state.gst.tickets-=v.n;else state.gst.free=0;state.gst.res=Array.from({length:v.n},()=>({id:'mag',r:'s'}));state.prem.owned=['mag','chat'];}if(k==='prwear')state.prem.worn[v.slot]=v.id;if(unknown&&k==='gpull')throw Error('timeout after native send');return {ok:true};};
 try{
  const waits=[],opts={read,send,check:async()=>true,sleep:async ms=>waits.push(ms)};let out=await r.run(i,opts);assert.equal(out.status,'checked');assert.equal(out.pulled,12);assert.equal(out.gacha.tickets,0);assert.equal(out.premium.worn.wing,'mag');assert.equal(out.premium.worn.chat,'chat');assert.equal(out.premium.coins,50);assert.deepEqual(out.claimedMail,[1]);assert.deepEqual(out.claimedAchievements,['lv10']);assert(commands.filter(x=>x[0]==='gpull').every(x=>['ticket','free'].includes(x[1].how)));assert.deepEqual(waits,[2500,2500,2500],'native reveal is paced before the next pull');
  assert.deepEqual(commands.filter(x=>x[0]==='gpull').map(x=>x[1]),[{n:10,how:'ticket'},{n:1,how:'ticket'},{n:1,how:'free'}],'ten first, then remaining singles, then free pull');
  assert.equal(out.results.length,12);
  const receiptRow={kind:'gpull',payload:{n:10,how:'ticket'},before:{pulls:0,tickets:35}};
  const nativeReceipt={pulls:10,tickets:25,res:Array.from({length:10},()=>({id:'mag',r:'s'}))};
  assert.equal(r.pullReceipt(receiptRow,[nativeReceipt,{pulls:10,tickets:25,recent:[[123,'s','mag','new']]}]).length,10,'preserve original response when gq overwrites latest gst');
  assert.deepEqual(r.pullReceipt(receiptRow,[{...nativeReceipt,pulls:20},{pulls:10,tickets:25,recent:[[123,'s','mag','new']]}]),[],'history tuples and unrelated counters are not item receipts');
  const before=commands.length;out=await r.run(i,opts);assert.equal(out.pulled,0);assert.equal(commands.length,before,'already received rewards and worn items are not repeated');
  state.gst.tickets=1;unknown=true;out=await r.run(i,opts);assert.equal(out.status,'uncertain_no_replay');const pulls=commands.filter(x=>x[0]==='gpull').length;unknown=false;out=await r.run(i,opts);assert.equal(out.status,'checked');assert.equal(commands.filter(x=>x[0]==='gpull').length,pulls,'fresh counters reconcile response loss without a second pull');
  state.gst.tickets=1;const noResult=async()=>{throw Error('unknown before/after send');};out=await r.run(i,{...opts,send:noResult});assert.equal(out.status,'uncertain_no_replay');state.prem.worn={};out=await r.run(i,opts);assert.equal(out.status,'uncertain_no_replay');assert.equal(out.premium.worn.wing,'mag','uncertain gacha must not block wearing existing owned rewards');assert.equal(out.gacha.tickets,1,'show real remaining tickets while reconciliation is held');assert.equal(commands.filter(x=>x[0]==='gpull').length,pulls,'unchanged counters do not authorize replay');
  assert.equal(r.confirmed({kind:'gpull',payload:{n:10,how:'ticket'},before:{pulls:3,tickets:20}},{gst:{pulls:13,tickets:20}}),false,'pull echo without ticket delta is not proof');
  let dispatched=0,flushes=0;const n={online:true,isConnected:()=>true,pause:false,handlers:{resave(){}},flush:async()=>{flushes++;},social:()=>{dispatched++;}};const real={eval:code=>vm.runInNewContext(code,{window:{AsteriaNet:n}})};
  assert.equal((await r.dispatch(real,'gpull',{n:1,how:'coin'})).ok,false);assert.equal(dispatched,0);await r.dispatch(real,'gpull',{n:10,how:'ticket'});assert.equal(flushes,1);assert.equal(dispatched,1);n.pause=true;await r.dispatch(real,'gpull',{n:1,how:'ticket'});assert.equal(dispatched,1);
  console.log('free rewards: PASS source mutation, server receipts, ticket/free only, owned role equipment, cosmetic slots, ambiguity no replay, native flush/session guards');
 }finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
