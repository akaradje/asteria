'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {watch}=require('./patch-notes-watch');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-note-watch-'));
const file=path.join(root,'logs','patch-notes-seen.json');
async function main(){
 let now=1000000,posts=[],lines=[],calls=0;
 const note={id:'new',date:'2026-10-03',title:'Recipe update',items:[{t:'Forge',d:'Changed cost'}]};
 let parsed={status:'parsed',notes:[note],declaration:'PATCH_NOTES_ALL',coverage:{complete:true,notesParsed:1,notesReturned:1}};
 const opts={root,now:()=>now,fetcher:async()=>{calls++;return {ok:true,text:async()=>'<html>fixture</html>'};},parse:()=>parsed,announce:text=>posts.push(text),logger:text=>lines.push(text)};
 fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,JSON.stringify({seen:['historical'],checkedAt:'old-success'}));
 assert.equal((await watch(opts)).status,'checked');assert.equal(posts.length,1);assert(posts[0].includes('Recipe update'));
 let saved=JSON.parse(fs.readFileSync(file));assert.deepEqual(saved.seen,['new','historical']);assert.equal(saved.lastError,null);
 now+=1000;await watch(opts);assert.equal(posts.length,1,'same parsed ID is not announced twice');
 saved=JSON.parse(fs.readFileSync(file));const successfulAt=saved.checkedAt;
 for(const status of ['missing','unsupported','truncated']){
  parsed={status,notes:[],coverage:{complete:false}};now+=1000;lines=[];
  assert.equal((await watch(opts)).status,'unavailable');
  const rejected=JSON.parse(fs.readFileSync(file));assert.equal(rejected.checkedAt,successfulAt);assert.deepEqual(rejected.seen,saved.seen);assert(rejected.lastError.includes(status));assert.equal(posts.length,1);assert(!lines.some(line=>line.includes('no new')),'unknown data cannot claim no updates');
 }
 const unavailable=await watch({...opts,fetcher:async()=>({ok:false,status:503,text:async()=>{throw Error('must not read error body');}})});
 assert.equal(unavailable.error,'patch notes HTTP 503');assert.equal(JSON.parse(fs.readFileSync(file)).checkedAt,successfulAt);
 const network=await watch({...opts,fetcher:async()=>{throw Error('offline');}});assert.equal(network.status,'unavailable');assert.equal(posts.length,1);
 parsed={status:'parsed',notes:[{...note,id:'newer'}],coverage:{complete:true}};now+=1000;
 assert.equal((await watch(opts)).newNotes,1);assert.deepEqual(JSON.parse(fs.readFileSync(file)).seen,['newer','new','historical']);assert.equal(posts.length,2);assert(calls>=5);
 assert(!/\beval\s*\(|new\s+Function\s*\(/.test(fs.readFileSync('scripts/patch-notes-watch.js','utf8')),'legacy entry point cannot execute downloaded notes');
 console.log('PASS legacy watcher parsed-ID dedup, retained history, checkedAt freshness, HTTP/network/schema failures and no false no-update claim');
}
main().finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});}).catch(error=>{console.error(error);process.exitCode=1;});
