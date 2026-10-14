'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const id=x=>typeof x==='string'&&x.length>0&&x.length<=240;
// Dedicated local database: it never migrates or rewrites payment/actor journals.
class EvidenceStore{
 constructor(root){
  const {DatabaseSync}=require('node:sqlite');const file=path.join(root,'logs/game-knowledge/evidence.db');fs.mkdirSync(path.dirname(file),{recursive:true});this.db=new DatabaseSync(file);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
   CREATE TABLE IF NOT EXISTS brain_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   INSERT OR IGNORE INTO brain_meta VALUES('schema','1');
   CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,attempt INTEGER NOT NULL,success INTEGER,hash TEXT,status TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,build TEXT NOT NULL,at INTEGER NOT NULL,manifest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS facts(id TEXT NOT NULL,generation TEXT NOT NULL,domain TEXT NOT NULL,level TEXT NOT NULL,value TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(id,generation));
   CREATE INDEX IF NOT EXISTS facts_generation ON facts(generation,domain);
   CREATE TABLE IF NOT EXISTS unknowns(id TEXT PRIMARY KEY,domain TEXT NOT NULL,reason TEXT NOT NULL,firstAt INTEGER NOT NULL,lastAt INTEGER NOT NULL,nextCheck INTEGER NOT NULL,owner TEXT NOT NULL,status TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS invalidations(id TEXT PRIMARY KEY,generation TEXT NOT NULL,domain TEXT NOT NULL,at INTEGER NOT NULL,reason TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS scoped_facts(id TEXT PRIMARY KEY,fact_key TEXT NOT NULL,scope TEXT NOT NULL,build TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS scoped_fact_lookup ON scoped_facts(fact_key,scope,build,at);
   CREATE TABLE IF NOT EXISTS mechanic_dependencies(id TEXT PRIMARY KEY,body TEXT NOT NULL);`);
  if(this.db.prepare("SELECT value FROM brain_meta WHERE key='schema'").get().value!=='1'){this.db.close();throw Error('Unsupported knowledge schema');}
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 attempt(source,{at,hash=null,ok=false}={}){
  if(!id(source)||!Number.isSafeInteger(at)||at<0||ok&&(!hash||!/^[a-f0-9]{64}$/.test(hash)))throw Error('Invalid source observation');
  const old=this.db.prepare('SELECT * FROM sources WHERE id=?').get(source);if(old&&at<old.attempt)return false;
  this.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET attempt=excluded.attempt,success=excluded.success,hash=excluded.hash,status=excluded.status').run(source,at,ok?at:old?.success??null,ok?hash:old?.hash??null,ok?'received':'unavailable');return true;
 }
 unknown(key,domain,reason,at){
  if(!id(key)||!id(domain)||!id(reason)||!Number.isSafeInteger(at))throw Error('Invalid unknown');
  this.db.prepare("INSERT INTO unknowns VALUES(?,?,?,?,?,?,?,'open') ON CONFLICT(id) DO UPDATE SET lastAt=excluded.lastAt,nextCheck=excluded.nextCheck,reason=excluded.reason,status='open'").run(key,domain,reason,at,at,at+300000,'knowledge-review');
 }
 publish({build,at,sourceHashes,facts,unknowns=[],changes=[]}){
  if(!id(build)||!Number.isSafeInteger(at)||!Array.isArray(facts)||facts.length>20000||!sourceHashes||!Object.keys(sourceHashes).length||Object.values(sourceHashes).some(x=>!/^[a-f0-9]{64}$/.test(x)))throw Error('Invalid knowledge generation');
  const keys=new Set();for(const f of facts){const encoded=JSON.stringify(f.value);if(!id(f.id)||!id(f.domain)||!['DISCOVERED','PARSED'].includes(f.level)||!Array.isArray(f.evidence)||!f.evidence.length||f.evidence.some(e=>!Object.hasOwn(sourceHashes,e))||keys.has(f.id)||typeof encoded!=='string'||encoded.length>200000)throw Error('Invalid or duplicate static fact');keys.add(f.id);}
  const generation=digest({build,sourceHashes,facts});
  return this.transaction(()=>{
   const old=this.active();if(old&&at<old.at)throw Error('Knowledge clock moved backwards');
   this.db.prepare('INSERT OR IGNORE INTO generations VALUES(?,?,?,?)').run(generation,build,at,JSON.stringify(sourceHashes));
   const insert=this.db.prepare('INSERT OR IGNORE INTO facts VALUES(?,?,?,?,?,?)');
   for(const f of facts){
    insert.run(f.id,generation,f.domain,f.level,JSON.stringify(f.value),JSON.stringify(f.evidence));
    if(Buffer.byteLength(JSON.stringify(f.value))<=65536)this.observe({key:f.id,domain:f.domain,scope:'public_rule',build,source:f.evidence.join('+'),authority:f.domain==='announcements'?'announcement':f.evidence.length===1&&f.evidence[0]==='wiki'?'wiki_rule':'client_rule',at,expiresAt:at+600000,value:f.value,dependencies:f.evidence.map(e=>'source:'+e),evidenceId:generation+':'+digest(f.id)});
    this.dependency({id:f.id,dependencies:f.evidence.map(e=>'source:'+e)});
   }
   for(const u of unknowns)this.unknown(u.id,u.domain,u.reason,at);
   // Absence never silently resolves a previous unknown. Resolution needs a reviewed proof.
   for(const c of changes){if(!id(c.domain)||!id(c.reason))throw Error('Invalid changed dependency');this.db.prepare('INSERT OR IGNORE INTO invalidations VALUES(?,?,?,?,?)').run(digest([generation,c]),generation,c.domain,at,c.reason);}
   this.db.prepare("INSERT INTO brain_meta VALUES('active',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({generation,build,at}));return generation;
  });
 }
 resolveUnknown(key,{evidenceId,generation,at}={}){
  const active=this.active();if(!active||active.generation!==generation||!Number.isSafeInteger(at)||at<active.at||!id(evidenceId))throw Error('Current reviewed evidence required');
  // This API records a review reference, not a claim of runtime execution.
  return this.db.prepare("UPDATE unknowns SET status=?,lastAt=? WHERE id=? AND status='open'").run('reviewed:'+evidenceId,at,key).changes===1;
 }
 active(){const r=this.db.prepare("SELECT value FROM brain_meta WHERE key='active'").get();return r?JSON.parse(r.value):null;}
 observe(fact){const f=require('./fact-authority').validate(fact);this.db.prepare('INSERT INTO scoped_facts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at,body=excluded.body WHERE excluded.at>=scoped_facts.at').run(f.id,f.key,f.scope,f.build,f.at,JSON.stringify(f));return f.id;}
 resolve(options){if(!id(options?.key)||!id(options.scope)||!id(options.build))throw Error('Exact fact context required');const active=this.active();if(options.scope==='public_rule'&&active&&!this.db.prepare('SELECT id FROM facts WHERE id=? AND generation=?').get(options.key,active.generation))return {state:'UNKNOWN',value:null,evidenceIds:[],reason:'Fact absent from current generation'};let rows=this.db.prepare('SELECT body FROM scoped_facts WHERE fact_key=? AND scope=? AND build=? ORDER BY at DESC LIMIT 512').all(options.key,options.scope,options.build).map(r=>JSON.parse(r.body));if(rows.length===512)return {state:'UNKNOWN',value:null,evidenceIds:[],reason:'Scoped evidence budget exceeded; narrow query required'};if(options.scope==='public_rule'&&active){
   const manifest=JSON.parse(this.db.prepare('SELECT manifest FROM generations WHERE id=?').get(active.generation).manifest);
   rows=rows.filter(f=>f.evidenceId.startsWith(active.generation+':')&&f.dependencies.every(d=>{
    if(!d.startsWith('source:'))return true;
    const source=d.slice(7),s=this.db.prepare('SELECT * FROM sources WHERE id=?').get(source);
    return s?.status==='received'&&s.hash===manifest[source]&&s.success<= (options.now??Date.now());
   }));
  }return require('./fact-authority').resolve(rows,options);}
 dependency(node){if(!id(node?.id)||!Array.isArray(node.dependencies)||node.dependencies.length>64||node.dependencies.some(d=>!id(d)))throw Error('Invalid dependency');this.db.prepare('INSERT INTO mechanic_dependencies VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(node.id,JSON.stringify({id:node.id,dependencies:node.dependencies}));}
 affected(changed){if(!Array.isArray(changed)||changed.length>128||changed.some(d=>!id(d)))throw Error('Invalid changed facts');return require('./fact-authority').affected(this.db.prepare('SELECT body FROM mechanic_dependencies').all().map(r=>JSON.parse(r.body)),changed);}
 query({domain,limit=20}={}){const active=this.active();if(!active)return [];if(!id(domain)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded exact-domain query required');return this.db.prepare('SELECT id,level,value,evidence FROM facts WHERE generation=? AND domain=? ORDER BY id LIMIT ?').all(active.generation,domain,limit).map(r=>({...r,value:JSON.parse(r.value),evidence:JSON.parse(r.evidence),generation:active.generation,build:active.build}));}
 view(now=Date.now(),maxAgeMs=600000){
  const active=this.active(),sources=this.db.prepare('SELECT * FROM sources ORDER BY id').all().map(s=>({...s,ageMs:s.success===null?null:now-s.success,fresh:s.status==='received'&&s.success!==null&&now>=s.success&&now-s.success<=maxAgeMs}));
  const domains=active?this.db.prepare('SELECT domain,level,COUNT(*) AS count FROM facts WHERE generation=? GROUP BY domain,level').all(active.generation):[];
  return {version:1,active,sources,domains,unknownCount:this.db.prepare("SELECT COUNT(*) AS n FROM unknowns WHERE status='open'").get().n,unknowns:this.db.prepare("SELECT id,domain,reason,owner,nextCheck FROM unknowns WHERE status='open' ORDER BY firstAt LIMIT 20").all(),recentChanges:this.db.prepare('SELECT domain,at,reason FROM invalidations ORDER BY at DESC LIMIT 20').all(),scope:'observed_sources_only',runtimeVerified:false};
 }
 close(){this.db.close();}
}
function publishCollection(root,{build,at,collected,fingerprints,notices,compatibility}={}){
 const store=new EvidenceStore(root);try{
  const names=['client','world','network','wiki'],hashes={};
  for(let n=0;n<names.length;n++){const r=collected[n],ok=r?.status==='fulfilled';const hash=ok?crypto.createHash('sha256').update(r.value).digest('hex'):null;store.attempt(names[n],{at,ok,hash});if(ok)hashes[names[n]]=hash;}
  if(fingerprints&&Object.keys(hashes).length===4){
   const facts=Object.entries(fingerprints).map(([name,value])=>({id:'fingerprint:'+name,domain:name,level:'PARSED',value,evidence:name==='wikiRules'?['wiki']:name==='network'?['network']:['client','world']}));
   const unknowns=[];
   const atlas=require('./mechanic-atlas').compile({client:collected[0].value,world:collected[1].value,network:collected[2].value,build});
   for(const row of atlas.rows){
    facts.push({id:row.id,domain:'atlas:'+row.domain,level:'DISCOVERED',value:row,evidence:[...new Set(row.references.map(r=>r.source))].length?[...new Set(row.references.map(r=>r.source))]:['client','world','network']});
    unknowns.push({id:'atlas-review:'+row.domain,domain:row.domain,reason:'Native action contracts and role benefit require evidence'});
   }

   for(const n of notices?.notes||[]){facts.push({id:'notice:'+n.id,domain:'announcements',level:'PARSED',value:{content:n.content,visibility:n.visibility,availability:n.availability},evidence:['client']});if(n.visibility==='runtime_gate_unknown')unknowns.push({id:'visibility:'+n.id,domain:'announcements',reason:'Native visibility gate not verified'});}
   if(!notices?.coverage?.complete)unknowns.push({id:'notices:coverage',domain:'announcements',reason:'Notice parse incomplete or unavailable'});
   // Schema discovery does not assert mechanic support or invent adapters.
   const wiki=JSON.parse(collected[3].value);
   const compiled=require('./wiki-facts').compile(wiki);facts.push(...compiled.facts);unknowns.push(...compiled.unknowns);
   for(const key of Object.keys(wiki).slice(0,1000)){facts.push({id:'wiki-domain:'+key,domain:'wiki',level:'DISCOVERED',value:{key},evidence:['wiki']});unknowns.push({id:'mechanic-review:'+key,domain:'wiki',reason:'Discovered domain requires runtime capability review'});}
   const changes=Object.entries(compatibility||{}).filter(([,v])=>v.state==='review_required').map(([domain])=>({domain,reason:'Mechanic dependency fingerprint changed'}));
   store.publish({build,at,sourceHashes:hashes,facts,unknowns,changes});
  }
  return store.view(at);
 }finally{store.close();}
}
function project(snapshot,now=Date.now(),maxAgeMs=600000){if(!snapshot)return null;return {...snapshot,sources:(snapshot.sources||[]).map(s=>({...s,ageMs:s.success===null?null:now-s.success,fresh:s.status==='received'&&Number.isFinite(s.success)&&now>=s.success&&now-s.success<=maxAgeMs})),evaluatedAt:now};}
module.exports={EvidenceStore,publishCollection,project};
