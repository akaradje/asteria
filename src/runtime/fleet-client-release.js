'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {keyFor}=require('../assetcache');
const origin='https://asteria-online.io';
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const bootUrls=[origin+'/asteria-i18n.js',origin+'/asteria-audio.js','https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
function dictionaryUrl(body){const match=/\.\/asteria-i18n-dict\.js\?v=[A-Za-z0-9_-]+/.exec(body.toString());return match?new URL(match[0],origin+'/').href:null;}
function dependencyAllowed(url){return bootUrls.includes(url)||new URL(url).origin===origin&&/^\/asteria-(?:i18n-dict|i18n|audio|world-system|net)\.js\?v=[A-Za-z0-9_-]{1,80}$/.test(new URL(url).pathname+new URL(url).search);}
function versionedBootUrls(html){return [...new Set([...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>new URL(m[1],origin+'/').href).filter(url=>new URL(url).origin===origin&&/^\/asteria-(?:i18n|audio|world-system|net)\.js$/.test(new URL(url).pathname)&&new URL(url).search))];}
function validateDependency(item){
 if(!dependencyAllowed(item.url))throw Error('Unexpected boot dependency URL');
 new(require('vm').Script)(item.body.toString());
 const name=new URL(item.url).pathname,s=item.body.toString();
 const symbols=name.endsWith('/asteria-i18n.js')?['root.__L','root.__i18nDom']:name.endsWith('/asteria-audio.js')?['AsteriaAudio']:name.endsWith('/asteria-world-system.js')?['AsteriaWorld']:name.endsWith('/asteria-net.js')?['AsteriaNet']:name.includes('asteria-i18n-dict.js')?['AsteriaI18nDict']:['THREE'];
 if(!symbols.every(key=>s.includes(key)))throw Error('Required boot dependency exports missing: '+name);
}
function inspect(root,health){
 const file=path.join(root,'machines/fleet-client-release.json');
 if(!fs.existsSync(file))return null;
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.version!==1||!require('../knowledge/build-id').valid(r.build)||r.files?.length!==3)throw Error('Invalid fleet client release');
 if(!health?.ok||health.build!==r.build)throw Error('Fleet client release differs from live server; stage the current release on both machines before launching');
 for(const f of r.files){const u=new URL(f.url);if(u.origin!==origin)throw Error('Unexpected fleet client origin');const p=path.join(root,'cache',r.build,keyFor(u.href));if(digest(fs.readFileSync(p))!==f.sha256)throw Error('Fleet client file fingerprint mismatch: '+u.pathname);}
 if(!Array.isArray(r.dependencies)||!bootUrls.every(url=>r.dependencies.filter(d=>d.url===url).length===1))throw Error('Required boot dependencies are not staged');
 for(const f of r.dependencies){if(!dependencyAllowed(f.url))throw Error('Unexpected boot dependency URL');const body=fs.readFileSync(path.join(root,'cache',r.build,keyFor(f.url)));if(digest(body)!==f.sha256)throw Error('Boot dependency fingerprint mismatch');}
 const dictionary=dictionaryUrl(fs.readFileSync(path.join(root,'cache',r.build,keyFor(bootUrls[0]))));if(dictionary&&!r.dependencies.some(d=>d.url===dictionary))throw Error('Language dictionary dependency is not staged');
 for(const url of versionedBootUrls(fs.readFileSync(path.join(root,'cache',r.build,keyFor(r.files[0].url)),'utf8'))){const entry=r.dependencies.find(d=>d.url===url),plain=r.files.concat(r.dependencies).find(d=>d.url===origin+new URL(url).pathname);if(!entry||!plain||entry.sha256!==plain.sha256)throw Error('Exact versioned boot source is not staged or differs');}
 const marker=JSON.parse(fs.readFileSync(path.join(root,'cache',r.build,'asteria-online.io/_root.json'),'utf8'));
 if(marker.target!==r.files[0].url)throw Error('Fleet root document differs from release');
 return r;
}
async function stage(root,{fetcher=fetch,now=Date.now}={}){
 async function get(url){const r=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Fleet source HTTP '+r.status);const body=Buffer.from(await r.arrayBuffer());if(body.length>8000000)throw Error('Fleet source too large');return {url:r.url||url,body};}
 const health=JSON.parse((await get(origin+'/api/health')).body);
 if(!health.ok||!require('../knowledge/build-id').valid(health.build))throw Error('Invalid health build');
 const items=[];for(const url of [origin+'/',origin+'/asteria-world-system.js',origin+'/asteria-net.js'])items.push(await get(url));
 if(!/<html|<!doctype/i.test(items[0].body.toString())||!items[1].body.includes('AsteriaWorld')||!items[2].body.includes('AsteriaNet'))throw Error('Unexpected client source');
 const dependencies=[];for(const url of bootUrls){const item=await get(url);validateDependency(item);dependencies.push(item);}
 const dictionary=dictionaryUrl(dependencies[0].body);if(dictionary){const item=await get(dictionary);validateDependency(item);dependencies.push(item);}
 for(const url of versionedBootUrls(items[0].body.toString())){const item=await get(url);validateDependency(item);const plain=items.concat(dependencies).find(d=>d.url===origin+new URL(url).pathname);if(!plain||digest(item.body)!==digest(plain.body))throw Error('Versioned boot source differs from reviewed canonical source');dependencies.push(item);}
 const confirm=JSON.parse((await get(origin+'/api/health')).body);if(!confirm.ok||confirm.build!==health.build)throw Error('Server changed during staging; no release published');
 const r={version:1,build:health.build,at:now(),files:items.map(x=>({url:x.url,sha256:digest(x.body)})),dependencies:dependencies.map(x=>({url:x.url,sha256:digest(x.body)}))};
 for(const x of items.concat(dependencies)){if(items.includes(x)&&new URL(x.url).origin!==origin)throw Error('Unexpected redirect');const p=path.join(root,'cache',r.build,keyFor(x.url));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',x.body);fs.renameSync(p+'.tmp',p);}
 const marker=path.join(root,'cache',r.build,'asteria-online.io/_root.json');fs.writeFileSync(marker,JSON.stringify({target:r.files[0].url,at:r.at}));
 const file=path.join(root,'machines/fleet-client-release.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(r,null,2));fs.renameSync(file+'.tmp',file);inspect(root,health);return r;
}
async function prepare(root,{health,fetcher=fetch,now=Date.now,log=()=>{}}={}){
 // A pin verifies a release; it must not prevent startup after a server update.
 try{const r=inspect(root,health);if(r){
   let knowledge;try{knowledge=JSON.parse(fs.readFileSync(path.join(root,'logs/game-knowledge/state.json')));}catch{}
   const recent=knowledge&&!knowledge.lastError&&knowledge.current?.build===health?.build&&Number.isFinite(knowledge.checkedAt)&&now()-knowledge.checkedAt>=0&&now()-knowledge.checkedAt<900000;
   const source=recent&&knowledge.current.sourceHashes;
   const stale=source&&[['client',0],['world',1],['network',2]].some(([name,index])=>source[name]&&source[name]!==r.files[index].sha256);
   if(!stale)return r;
   log('client release refresh: same-build source fingerprints changed');
 }}catch(e){log('client release refresh: '+e.message);}
 let lastError;
 for(let attempt=1;attempt<=2;attempt++){
  try{const r=await stage(root,{fetcher,now});log('client release verified: '+r.build);return r;}
  catch(e){lastError=e;if(!/Server changed during staging/.test(e.message))throw e;}
 }
 throw lastError;
}
module.exports={stage,inspect,prepare};
