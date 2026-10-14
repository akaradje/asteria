'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {ResultLedger}=require('../src/result-ledger'),{ActionJournal}=require('../src/runtime/action-journal');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-refine-load-'));
async function main(){
 const before={equip:{weapon:'w',armor:'a',wing:'wing'},refine:{w:6,a:2},coins:1000},load={...before,coins:3},at=100000,session=at+60001,proof={at:session+1,sessionStartedAt:session,rev:8};
 const fresh=(n,target={id:'w'},kind='refine')=>{const l=new ResultLedger(root,n,at);l.begin(kind,target,before,at);return l;};
 let l=fresh('same'),j=new ActionJournal(root,'same');j.importLedger(l.view(),'old');assert(j.pending());
 assert(l.reconcileRefineLoad(load,proof));assert.equal(l.rows[0].status,'reconciled_no_increase');assert.equal(l.rows[0].id.slice(0,12).length,12);assert(!l.blocking('refine'));assert.equal(l.rows[0].cost,undefined,'do not invent cost from unrelated coin changes');assert.equal(l.rows[0].reconciliation.costKnown,false);
 j.importLedger(l.view(),'new');assert(j.pending(),'legacy state readback cannot settle an exact paid outcome');assert.equal(j.rows[0].status,'OBSERVED');assert.equal(j.rows[0].build,'old','preserve transaction original build');assert.equal(new ResultLedger(root,'same').rows[0].status,'reconciled_no_increase');assert.equal(l.reconcileRefineLoad(load,proof),false,'terminal old row never replays');
 l=fresh('up');assert(l.reconcileRefineLoad({...load,refine:{w:7,a:2}},proof));assert.equal(l.rows[0].status,'reconciled_increase');j.importLedger(l.view(),'old');assert.equal(j.rows[0].status,'OBSERVED','current level increase is not an exact historical cost receipt');
 l=fresh('legacy',{});assert(l.reconcileRefineLoad(load,proof),'untargeted legacy checks every non-wing equipped item');assert.equal(l.rows[0].reconciliation.refine.length,2);
 for(const [n,state,p] of [['same-session',load,{...proof,sessionStartedAt:at}],['not-ended',load,{...proof,sessionStartedAt:at+59000}],['late',load,{...proof,at:session+120001}],['before-session',load,{...proof,at:session}],['missing-map',{...load,refine:null},proof],['missing-key',{...load,equip:{},refine:{}},proof],['decrease',{...load,refine:{w:5,a:2}},proof],['bad-type',{...load,refine:{w:'6',a:2}},proof]]){l=fresh(n);assert.equal(l.reconcileRefineLoad(state,p),false,n);assert(l.blocking('refine'),n+' stays quarantined');}
 l=fresh('legacy-partial',{});assert(!l.reconcileRefineLoad({...load,equip:{weapon:'w'},refine:{w:6}},proof),'all possible legacy targets required');
 l=fresh('craft',{id:'w'},'craft');assert(!l.reconcileRefineLoad(load,proof),'only refinement supported');assert(l.pending());
 l=new ResultLedger(root,'zero',at);l.begin('refine',{id:'w'},{equip:{weapon:'w'},refine:{}},at);assert(l.reconcileRefineLoad({equip:{weapon:'w'},refine:{}},proof),'explicit equipped ID establishes zero');
 // Exercise the installed native response hook, including old-page rejection.
 const source=fs.readFileSync(path.join(__dirname,'../src/instance.js'),'utf8'),start=source.indexOf('    const loadPage=this.page;'),end=source.indexOf('    // Telemetry:',start),hook=source.slice(start,end);
 const requestStart=source.indexOf("    this.page.on('request', r => {",end),requestEnd=source.indexOf('      try {',requestStart),captureHook=source.slice(requestStart,requestEnd)+'    });';
 const createRequire=require('module').createRequire(path.join(__dirname,'../src/instance.js'));
 const callbacks={},page={on:(name,fn)=>{callbacks[name]=fn;}},actor={page,root,storageSlot:'hook',actorIdentity:{actorId:'actor-'+ 'a'.repeat(32)},character:{id:24},socialInbox:{generation:0},catalog:()=>({build:'fixture',items:{},world:{}}),bagSessionStartedAt:Date.now()-1000,cache:{dir:path.join(root,'cache','fixture')},credentials:{username:'hook'}};
 const old=new ResultLedger(root,actor.actorIdentity.actorId);old.begin('refine',{id:'w'},before,Date.now()-120000);
 vm.runInNewContext('(function(){'+hook+captureHook+'}).call(actor)',{actor,require:createRequire,path,api:{BASE:'https://asteria-online.io'},URL,Date});
 const callback=callbacks.response,response=(url='https://asteria-online.io/api/save',headers={'x-char':'24'})=>{const request={url:()=>url,method:()=> 'GET',headers:()=>headers};callbacks.request(request);return {url:()=>url,request:()=>request,ok:()=>true,json:async()=>({save:{...load,lv:120,job:'knight',bag:[]},rev:9})};};
 actor.page={};await callback(response());assert(!actor.developmentLedger,'stale page cannot reconcile');actor.page=page;
 await callback(response('https://other.example/api/save'));assert(!actor.developmentLedger,'unrelated origin cannot reconcile');
 await callback(response(undefined,{'x-char':'other'}));assert(!actor.developmentLedger,'wrong native character request cannot bind a readback');
 await callback(response());assert.equal(actor.developmentLedger.rows[0].status,'reconciled_no_increase');assert.equal(actor.bagJournal.rows[0].status,'OBSERVED');assert(actor.bagJournal.pending(),'legacy paid ambiguity remains quarantined');
 console.log('PASS authoritative fresh-session refinement reconciliation, durable audit/no invented cost/no replay, legacy complete evidence, missing/decreased/stale data quarantine and real response hook page/origin guards');
}
main().finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}).catch(e=>{console.error(e);process.exitCode=1;});
