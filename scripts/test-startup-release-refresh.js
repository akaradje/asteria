'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {prepare,inspect}=require('../src/runtime/fleet-client-release');
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-startup-'));
 try{
  let build='new1',reads=0,racing=false;
  const fetcher=async url=>{let text;if(url.endsWith('/api/health')){reads++;text=JSON.stringify({ok:true,build:racing&&reads===1?'old':build});}else text=url.includes('asteria-i18n-dict.js')?'window.AsteriaI18nDict = {};':url.endsWith('/asteria-i18n.js')?'const root={};root.__L=()=>{};root.__i18nDom=()=>{};const dict="./asteria-i18n-dict.js?v=test";':url.endsWith('/asteria-audio.js')?'const AsteriaAudio={};':url.includes('/three.min.js')?'const THREE={};':url.endsWith('/asteria-world-system.js')?'AsteriaWorld':url.endsWith('/asteria-net.js')?'AsteriaNet':'<!doctype html><html></html>';return {ok:true,url,arrayBuffer:async()=>Buffer.from(text)};};
  assert.equal((await prepare(root,{health:{ok:true,build},fetcher})).build,build,'missing pin stages verified release');
  assert.equal(inspect(root,{ok:true,build}).dependencies.length,4,'language/audio/Three/dictionary ready before any page launches');
  const keyFor=require('../src/assetcache').keyFor,i18n=path.join(root,'cache',build,keyFor('https://asteria-online.io/asteria-i18n.js'));fs.unlinkSync(i18n);await assert.rejects(Promise.resolve().then(()=>inspect(root,{ok:true,build})),/ENOENT/);await prepare(root,{health:{ok:true,build},fetcher});assert(fs.existsSync(i18n),'missing language dependency repaired');
  await assert.rejects(prepare(root,{health:null,fetcher:async url=>url.endsWith('/asteria-i18n.js')?{ok:false,status:503}:fetcher(url)}),/HTTP 503/,'dependency failure stops before publishing a broken release');
  await assert.rejects(prepare(root,{health:null,fetcher:async url=>url.endsWith('/asteria-i18n.js')?{ok:true,url,arrayBuffer:async()=>Buffer.from('const htmlErrorPage=1;')}:fetcher(url)}),/exports missing/,'200 response without native dependency exports cannot pass');
  const previous=reads;await prepare(root,{health:{ok:true,build},fetcher});assert.equal(reads,previous,'valid pin does not download again');
  fs.mkdirSync(path.join(root,'logs/game-knowledge'),{recursive:true});fs.writeFileSync(path.join(root,'logs/game-knowledge/state.json'),JSON.stringify({checkedAt:Date.now(),current:{build,sourceHashes:{client:'changed-live-content'}}}));
  await prepare(root,{health:{ok:true,build},fetcher});assert(reads>previous,'fresh same-build source difference restages instead of retaining old pin');
  build='new2';assert.equal((await prepare(root,{health:{ok:true,build},fetcher})).build,build,'server update refreshes stale pin');
  fs.appendFileSync(path.join(root,'cache/new2/asteria-online.io/asteria-net.js'),'corrupt');await prepare(root,{health:{ok:true,build},fetcher});assert.equal(inspect(root,{ok:true,build}).build,build,'corrupt file repaired');
  build='new3';reads=0;racing=true;assert.equal((await prepare(root,{health:{ok:true,build},fetcher})).build,build,'one racing update retries verified staging');assert.equal(reads,4);
  await assert.rejects(prepare(root,{health:null,fetcher:async()=>{throw Error('offline');}}),/offline/,'offline never falls back to old pin');
  reads=0;await assert.rejects(prepare(root,{health:null,fetcher:async url=>url.endsWith('/api/health')?{ok:true,url,arrayBuffer:async()=>Buffer.from(JSON.stringify({ok:true,build:'race'+(++reads)}))}:fetcher(url)}),/changed during/);assert.equal(reads,4,'retry bounded');
  console.log('PASS startup missing/stale/corrupt pin refresh, cache reuse, racing update retry, offline refusal, bounded retries');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
