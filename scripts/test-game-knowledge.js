'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {GameKnowledge,extract}=require('../src/game-knowledge');
(async()=>{
 const transport=require('../src/runtime/public-reference-fetch'),url='https://asteria-online.io/wiki/data.json';let attempts=0;
 const runner=(file,args,opts,cb)=>{attempts++;assert(['curl','curl.exe'].includes(file));assert(!args.includes('--insecure')&&!args.includes('--location'));assert(opts.timeout<=13000&&opts.maxBuffer<=8001024);cb(null,'{"native":true}\nASTERIA_PUBLIC_URL:'+url+'\nASTERIA_PUBLIC_STATUS:200');};
 const timeout=Object.assign(Error('body timed out'),{name:'TimeoutError'});
 const fallback=await transport.fetchPublic(url,{}, {fetcher:async()=>({ok:true,status:200,url,text:async()=>{throw timeout;}}),runner});
 assert.equal(await fallback.text(),'{"native":true}');assert.equal(fallback.referenceTransport,'bounded_public_curl');assert.equal(attempts,1);
 const refusal=await transport.fetchPublic(url,{}, {fetcher:async()=>({ok:false,status:403}),runner});assert.equal(refusal.status,403);assert.equal(attempts,1,'HTTP refusal cannot trigger another transport');
 await assert.rejects(()=>transport.fetchPublic('https://asteria-online.io/api/private',{}, {fetcher:async()=>{throw timeout;},runner}));assert.equal(attempts,1);
 await assert.rejects(()=>transport.download(url,{runner:(file,args,opts,cb)=>cb(null,'{}\nASTERIA_PUBLIC_URL:https://elsewhere.invalid/wiki/data.json\nASTERIA_PUBLIC_STATUS:200')}),/mismatch/);
 const changed=await transport.fetchPublic(url,{}, {fetcher:async()=>({ok:true,status:200,url,text:async()=>'{"changed":true}'}),runner:()=>{throw Error('unexpected fallback');}});assert.equal(await changed.text(),'{"changed":true}','new bytes must reach existing build/schema verification');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asteria-knowledge-'));
 try{
  let build='abc123',clock=1000,world='root.AsteriaWorld = {value:1};',network='window.AsteriaNet = {};',wiki={items:{equipment:[]},crafting:{recipes:[]},monsters:{monsters:[]}},fail=false,missingWiki=false,race=false,healthReads=0;
  const html="<!doctype html><html>const MAP_LINKS = {d4:{prev:'d3',next:null}};\nconst HC_MAP_LINKS = {d4:{prev:'d3',next:'c1'}};\n{kind: 'worldMap', targetMap: 'r1', x: TOWN.cx + 40, z: -18}</html>";
  const fetcher=async url=>({ok:!fail&&!(missingWiki&&url.endsWith('/wiki/data.json')),status:fail||missingWiki&&url.endsWith('/wiki/data.json')?502:200,text:async()=>url.endsWith('/api/health')?JSON.stringify({ok:true,build:race&&++healthReads>1?'raced':build}):url.endsWith('/wiki/data.json')?JSON.stringify(wiki):url.endsWith('/asteria-net.js')?network:url.endsWith('.js')?world:html});
  const k=new GameKnowledge(root,{fetcher,now:()=>clock,intervalMs:100});
  const a=await k.poll('old');assert.equal(a.routes.links.d4.next,'c1');assert.deepEqual(a.routes.townGates.r1,{x:200,z:-18});assert.equal(k.state.updatePending,true);
  assert.equal(await k.poll('old'),false);clock+=101;await k.poll('old');assert.equal(k.state.history.length,1);
  world='root.AsteriaWorld = {value:2};';clock+=101;const b=await k.poll('old');assert.ok(b.changed.includes('worldTables'));assert.equal(k.state.history.length,2);
  const report=JSON.stringify(b.updateReport);clock+=101;const unchanged=await k.poll('old');assert.equal(JSON.stringify(unchanged.updateReport),report);assert.deepEqual(unchanged.changed,b.changed,'unchanged poll preserves last actual release changes');
  wiki={...wiki,newMechanic:{cost:123}};network='window.AsteriaNet = {newProtocol:true};';clock+=101;const c=await k.poll('abc123');assert(c.updateReport.wikiDiff.domains.some(d=>d.domain==='newMechanic'&&d.counts.added===1));assert(c.updateReport.sourceChanges.network.changed);assert(k.state.updatePending,'same build changed bytes require verification');
  const archived=path.join(root,'logs/game-knowledge',c.id);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(archived,'wiki.json'))),wiki);assert(fs.existsSync(path.join(archived,'update-report.json')));assert(!fs.existsSync(path.join(root,'data/wiki.json')),'unverified reference cannot become promoted rules');
  const historyLength=k.state.history.length;missingWiki=true;clock+=101;assert.equal(await k.poll('abc123'),false);assert.equal(k.state.current.id,c.id);assert.equal(k.state.collection.sources.wiki.status,'unavailable');assert.equal(k.state.history.length,historyLength);missingWiki=false;
  race=true;healthReads=0;clock+=101;assert.equal(await k.poll('abc123'),false);assert.match(k.state.lastError,/build changed/);assert.equal(k.state.current.id,c.id);race=false;
  assert(!Object.hasOwn(k.view().current,'updateReport'));assert(k.view().updates,'one bounded report in runtime view');
  const old=k.state.current.id;k.state.systemVersion={loadedSystemRevision:'prior-process',aligned:true};fail=true;clock+=101;
  const version=require('../src/knowledge/system-version'),inspect=version.inspect;
  try{version.inspect=(project,loaded,opts)=>({loadedSystemRevision:opts.loadedSystemRevision,aligned:true,reasons:[]});assert.equal(await k.poll('old'),false);assert.equal(k.state.current.id,old);assert.match(k.state.lastError,/502/);
    assert.equal(k.state.systemVersion.loadedSystemRevision,k.systemIdentity.revision,'failed collection must not report the prior process code identity');assert.equal(k.state.systemVersion.aligned,false,'failed reference collection cannot approve cached facts');
  }finally{version.inspect=inspect;}
  assert.equal(new GameKnowledge(root).state.current.id,old);
  assert.equal(extract("process.exit();",'malicious source').routes.links.d4,undefined);
  const directRequests=[],directRoot=path.join(root,'direct-client');const direct=new GameKnowledge(directRoot,{now:()=>clock,fetcher:async url=>{directRequests.push(url);if(url==='https://asteria-online.io/')throw Error('homepage alias unavailable');return fetcher(url);}});fail=false;assert(await direct.poll('abc123'),'source collection uses the same canonical client endpoint as the verified release, independently of homepage alias failure');assert(directRequests.includes('https://asteria-online.io/asteria-online-visual-polish.html'));assert(!directRequests.includes('https://asteria-online.io/'));
  const staged=require('../src/game-knowledge').stagedHtml,crypto=require('crypto'),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),dir=path.join(root,'cache/staged/asteria-online.io');
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'machines'),{recursive:true});
  for(const [file,body]of [['asteria-online-visual-polish.html',html],['asteria-world-system.js',world],['asteria-net.js',network]])fs.writeFileSync(path.join(dir,file),body);
  const pin={build:'staged',at:clock,files:[html,world,network].map(body=>({sha256:sha(body)}))},collection=[{status:'rejected'},{status:'fulfilled',value:world},{status:'fulfilled',value:network}];
  fs.writeFileSync(path.join(root,'machines/fleet-client-release.json'),JSON.stringify(pin));
  assert.equal(staged(root,'staged',collection,clock),html,'recent exact staged HTML can recover a failed duplicate download');
  assert.equal(staged(root,'other',collection,clock),null);assert.equal(staged(root,'staged',collection,clock+300001),null);assert.equal(staged(root,'staged',collection,clock-1),null);
  assert.equal(staged(root,'staged',[collection[0],{status:'fulfilled',value:world+'changed'},collection[2]],clock),null,'same-build changed world cannot authorize cached HTML');
  fs.writeFileSync(path.join(dir,'asteria-online-visual-polish.html'),html+'corrupted');assert.equal(staged(root,'staged',collection,clock),null,'changed cache hash never authorizes fallback');
  console.log('game knowledge: baseline, diffs, persistence, failure preservation, throttle, safe extraction passed');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

{const {GameKnowledge}=require('../src/game-knowledge'),trace=[],fake={busy:false,now:()=>100,nextAt:0,lastPolledBuild:'b',intervalMs:300000,state:{},refreshVersion:b=>trace.push(b),text:async()=>{fake.beforeFetch=[...trace];throw Error('fixture fetch offline');},save(){},log(){}};GameKnowledge.prototype.poll.call(fake,'b').then(()=>{assert.deepEqual(fake.beforeFetch,['b'],'current code identity checked before network fetch');console.log('PASS loaded code identity refreshed before pending network collection');}).catch(e=>{console.error(e);process.exitCode=1;});}
