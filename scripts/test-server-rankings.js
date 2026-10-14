'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {SocialInbox}=require('../src/runtime/social-inbox'),{ServerRankings,normalize}=require('../src/observability/server-rankings');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-ranking-'));
try{const packet={t:'rank',cat:'overall',n:1119,next:300100,me:{pos:110,v:90.3,sub:[99,87,166,88],password:'discard'},list:Array.from({length:20},(_,i)=>({name:'Player'+i,lv:120,job:'monk',v:99-i/10,token:'discard'})),credentials:'discard'};
 const inbox=new SocialInbox();inbox.receive(JSON.stringify({t:'b',l:[packet,{t:'party',id:1}]}),100);const frame=inbox.last('rank:overall');assert.equal(frame.me.pos,110);assert.equal(frame.list.length,10);assert(!JSON.stringify(frame).includes('discard'));assert.equal(inbox.last('party').id,1);
 assert.equal(normalize({...packet,cat:'unknown'}),null);assert.equal(normalize({...packet,me:{pos:1120}}),null);assert.equal(normalize({...packet,n:-1}),null);
 const store=new ServerRankings(root,'ExampleAccount12');assert(store.observe(frame,100));assert(!store.observe(frame,99));let r=store.view(101).categories.overall;assert.equal(r.placesToTarget,100);assert(Math.abs(r.valueGap-7.8)<1e-9);assert.equal(r.history.length,1);assert(store.observe(frame,110));assert.equal(store.view(111).categories.overall.history.length,1);
 store.observe({...frame,me:{...frame.me,pos:90},next:600100},300100);r=store.view(300101).categories.overall;assert.equal(r.rankChange,20);assert.equal(r.history.length,2);assert.equal(store.view(700101).categories.overall.fresh,false);assert.equal(store.view(700101).categories.overall.valueGap,null,'stale packet has no actionable Top10 gap');assert.equal(store.view(700101).categories.overall.targetValue,null);
 assert.equal(new ServerRankings(root,'ExampleAccount12').view(300101).categories.overall.me.pos,90);assert.equal(new ServerRankings(root,'Other').view().categories.overall,null);store.observe({...frame,me:null},600101);assert.equal(store.view(600102).categories.overall.me,null);
 console.log('PASS authoritative per-character/category ranks, batching, privacy, restart history, target gaps, freshness and unranked state');
}finally{fs.rmSync(root,{recursive:true,force:true});}
