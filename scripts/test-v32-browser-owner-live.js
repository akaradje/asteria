'use strict';
// Controlled, empty headless Chromium. No game, authentication or farm APIs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const owners=require('../src/registry/browser-ownership'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function child(root){const owner={session:crypto.randomUUID()},pool=new(require('../src/browserpool').BrowserPool)({headless:true,noDraw:true,noGpu:true,splitBrowsers:true,minAcquireGapMs:1});await pool.acquire({width:320,height:200},{root,owner});fs.writeFileSync(path.join(root,'ready.json'),JSON.stringify({session:owner.session,pid:process.pid}));setInterval(()=>{},10000);}
async function main(){
 if(process.argv[2]==='--worker')return child(process.argv[3]);
 if(process.argv[2]!=='--controlled')throw Error('Use --controlled to test only the owned empty browser');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-empty-owner-')),worker=cp.spawn(process.execPath,[__filename,'--worker',root],{windowsHide:true,stdio:'ignore'});
 let exited=false;worker.once('exit',()=>{exited=true;});
 try{
  const until=Date.now()+30000;while(!fs.existsSync(path.join(root,'ready.json'))&&Date.now()<until&&!exited)await sleep(100);
  assert(fs.existsSync(path.join(root,'ready.json')),'empty owned browser did not initialize');
  const ready=JSON.parse(fs.readFileSync(path.join(root,'ready.json')));assert.equal(ready.pid,worker.pid);
  assert.equal((await owners.reconcile(root,ready.session)).closed,false,'do not kill a live controller');
  worker.kill('SIGKILL');const wait=Date.now()+5000;while(!exited&&Date.now()<wait)await sleep(100);assert(exited);
  const proof=await owners.reconcile(root,ready.session);assert.equal(proof.closed,true,JSON.stringify(proof));
  assert.equal((await owners.reconcile(root,ready.session)).closed,true,'native close reconciliation is idempotent');
  console.log(JSON.stringify({result:'PASS',platform:process.platform,scope:'empty_owned_headless_browser_only',checks:['real_browser_pid_and_marker','live_controller_protected','abrupt_controller_exit','all_registered_browser_children_closed','restart_idempotency'],gameOpened:false}));
 }finally{
  if(!exited)worker.kill('SIGKILL');const r=path.resolve(root);assert.equal(path.dirname(r),path.resolve(os.tmpdir()));
  const dir=path.join(root,'logs/browser-owners'),rows=fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,n)))):[];
  if(rows.every(row=>row.closed===true))fs.rmSync(r,{recursive:true,force:true});
  else console.log(JSON.stringify({retainedControlledEvidence:root,reason:'native_cleanup_not_yet_confirmed'}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
