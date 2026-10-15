'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function stagedHtml(root,build,collected,now){
 try{
  const pin=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'),'utf8'));
  if(pin.build!==build||!Number.isFinite(pin.at)||pin.at>now||now-pin.at>300000||pin.files?.length!==3)return null;
  const identity=require('./knowledge/loaded-source').capture(root,build);
  for(const [key,index]of [['client',0],['world',1],['network',2]])if(identity.sourceHashes[key]!==pin.files[index].sha256)return null;
  if(collected[1].status!=='fulfilled'||collected[2].status!=='fulfilled'||hash(collected[1].value)!==identity.sourceHashes.world||hash(collected[2].value)!==identity.sourceHashes.network)return null;
  const text=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
  return text.length<=8000000&&/<html|<!doctype/i.test(text)?text:null;
 }catch{return null;}
}
function extract(html, world) {
  const links = {};
  for (const block of html.matchAll(/const\s+(?:[A-Z_]*MAP_LINKS)\s*=\s*\{([^;]+)\};/g)) {
    for (const m of block[1].matchAll(/([a-z]\d+):\{prev:(null|'[^']+'),next:(null|'[^']+')\}/g)) {
      links[m[1]] = {prev:m[2]==='null'?null:m[2].slice(1,-1),next:m[3]==='null'?null:m[3].slice(1,-1)};
    }
  }
  const townGates = {};
  const fieldGates = {};
  const fieldBlock=html.match(/const\s+FIELD_GATES\s*=\s*\{([^;]+)\};/);
  if(fieldBlock)for(const m of fieldBlock[1].matchAll(/(home|previous|next):\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g))fieldGates[m[1]]={x:Number(m[2]),z:Number(m[3])};
  for (const m of html.matchAll(/kind:\s*'worldMap',\s*targetMap:\s*'([a-z]\d+)'[^\n]*?x:\s*TOWN\.cx\s*([+-])?\s*([\d.]+)?\s*,\s*z:\s*(-?[\d.]+)/g)) {
    townGates[m[1]] = {x:160+(m[2]==='-'?-1:1)*Number(m[3]||0),z:Number(m[4])};
  }
  const sections = {
    routes: JSON.stringify({links,townGates,fieldGates}),
    worldTables: world,
    bossMechanics: html.split('\n').filter(l=>/mskill|MONSTER_SKILLS|ground_aoe|cone_breath|gateStep/.test(l)).join('\n'),
    investment: html.split('\n').filter(l=>/function.*(?:refine|enchant|card)|data-cardin|Ancient Rune|SHOP_TIER_PRICE|weaponOpts|BAG_PRICES/i.test(l)).join('\n'),
    client:html,
  };
  return {routes:{links,townGates,fieldGates,status:'observed_client_tables',limits:'Coordinates use known TOWN.cx=160; new syntax requires review'},fingerprints:Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,hash(v)]))};
}
class GameKnowledge {
  constructor(root, {fetcher=fetch, now=Date.now, intervalMs=300000, log=()=>{}}={}) {
    this.root=root;this.dir=path.join(root,'logs','game-knowledge');this.fetch=fetcher===fetch?require('./runtime/public-reference-fetch').fetchPublic:fetcher;this.now=now;this.intervalMs=intervalMs;this.log=log;this.busy=false;this.nextAt=0;
    try {this.state=JSON.parse(fs.readFileSync(path.join(this.dir,'state.json'),'utf8'));}catch{this.state={version:1,history:[]};}
    this.lastPolledBuild=this.state.loadedBuild;
    this.systemIdentity=require('./knowledge/system-version').inventory(root);
  }
  save(){fs.mkdirSync(this.dir,{recursive:true});const result=require('./runtime/telemetry-file').writeTelemetry(path.join(this.dir,'state.json'),this.state);if(!result.ok)this.log('game knowledge persistence deferred: '+result.code);}
  recordEvidence(args){try{this.state.evidenceStore=require('./knowledge/evidence-store').publishCollection(this.root,args);this.state.evidenceStoreError=null;}catch{this.state.evidenceStoreError='knowledge_store_write_failed';this.log('knowledge evidence store unavailable; facts not promoted');}}
  async text(url,timeoutMs=20000){this.httpCache ||= new Map();const cached=this.httpCache.get(url),conditional=!url.includes('/api/');const headers=conditional&&cached?.etag?{'If-None-Match':cached.etag}:{};const r=await this.fetch(url,{cache:'no-store',headers,signal:AbortSignal.timeout(timeoutMs)});if(r.status===304){if(!conditional||!cached)throw Error('unmatched conditional source response');return cached.text;}if(!r.ok)throw Error('game knowledge HTTP '+r.status);if(r.url&&new URL(r.url).origin!=='https://asteria-online.io')throw Error('unexpected game knowledge source origin');const t=await r.text();if(t.length>8000000)throw Error('game knowledge source too large');const etag=r.headers?.get?.('etag');if(conditional&&etag){this.httpCache.set(url,{text:t,etag});while(this.httpCache.size>4)this.httpCache.delete(this.httpCache.keys().next().value);}return t;}
  refreshVersion(loadedBuild){
    try{const version=require('./knowledge/system-version').inspect(this.root,loadedBuild,{knowledge:this.state,loadedSystemRevision:this.systemIdentity.revision,now:this.now()});
      if(this.state.lastError){version.aligned=false;version.reasons=[...(version.reasons||[]),'latest knowledge collection failed; cached facts retained'];}
      this.state.systemVersion=version;this.state.systemVersionError=null;
    }catch(e){this.state.systemVersionError=e.message;this.state.systemVersion=null;}
  }
  previousSources(snapshot){
    if(!require('./knowledge/build-id').valid(snapshot?.id,100))return null;
    const result={};for(const [key,file]of Object.entries({html:'client.html',world:'world.js',network:'network.js',wiki:'wiki.json'})){try{const text=fs.readFileSync(path.join(this.dir,snapshot.id,file),'utf8');if(text.length<=8000000)result[key]=key==='wiki'?JSON.parse(text):text;}catch{}}
    return result;
  }
  async poll(loadedBuild) {
    // A page generation change needs current knowledge immediately. Keep the
    // normal interval and failed-fetch backoff for repeat calls of that build.
    const loadedChanged=!!loadedBuild&&loadedBuild!==this.lastPolledBuild;
    if(this.busy||!loadedChanged&&this.now()<this.nextAt)return false;
    // A new process must not display the preceding process's code identity
    // while network collection is pending. Freshness/native-source checks still
    // apply to cached knowledge; this does not claim a new server observation.
    this.refreshVersion(loadedBuild);
    this.lastPolledBuild=loadedBuild;
    this.busy=true;this.nextAt=this.now()+this.intervalMs;
    try {
      const origin='https://asteria-online.io';
      const h=JSON.parse(await this.text(origin+'/api/health'));
      if(!h.ok||typeof h.build!=='string'||!require('./knowledge/build-id').valid(h.build))throw Error('invalid health build');
      this.state.checkedAt=this.now();this.state.liveBuild=h.build;this.state.loadedBuild=loadedBuild;
      this.state.updatePending=!!loadedBuild&&h.build!==loadedBuild;
      // Collect reference material independently from approving it for live actions.
      // Refused/new-schema Wiki data still belongs in the release report.
      const names=['html','world','network','wiki'],urls=['/asteria-online-visual-polish.html','/asteria-world-system.js','/asteria-net.js','/wiki/data.json'];
      // Multi-megabyte reference files compete with live game/work traffic.
      // Keep health probes at20s; allow a bounded45s for each static collection.
      const collected=await Promise.allSettled(urls.map(url=>this.text(origin+url,45000)));
      // Source attempts are persisted even when one reference cannot be read.
      this.recordEvidence?.({build:h.build,at:this.now(),collected});
      let stagedFallback=false;
      if(collected[0].status==='rejected'){
       const text=stagedHtml(this.root,h.build,collected,this.now());
       if(text!==null){collected[0]={status:'fulfilled',value:text};stagedFallback=true;}
      }
      this.state.collection={at:this.now(),sources:Object.fromEntries(collected.map((r,i)=>[names[i],r.status==='fulfilled'?{status:'received'}:{status:'unavailable',reason:String(r.reason.message).slice(0,160)}]))};
      if(stagedFallback)this.state.collection.sources.html={status:'verified_staged_cache',reason:'HTML fetch failed; recent exact release hash and independently downloaded world/network match; final live build confirmation still required'};
      if(collected.some(r=>r.status==='rejected'))throw Error('incomplete update collection: '+names.filter((_,i)=>collected[i].status==='rejected').join(', '));
      const [html,world,network,wikiText]=collected.map(r=>r.value);
      if(!/<html|<!doctype/i.test(html))throw Error('invalid game client');
      if(!/AsteriaWorld/.test(world))throw Error('invalid world tables');
      if(!/AsteriaNet/.test(network))throw Error('invalid network client');
      const rawWiki=JSON.parse(wikiText);if(!rawWiki||typeof rawWiki!=='object'||Array.isArray(rawWiki))throw Error('invalid wiki document');
      const confirm=JSON.parse(await this.text(origin+'/api/health'));
      if(!confirm.ok||confirm.build!==h.build)throw Error('build changed during collection; retry next round');
      const noticeFile=path.join(this.dir,'notices.json');let priorNotices=null;
      try{priorNotices=JSON.parse(fs.readFileSync(noticeFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('notice history unreadable; original retained for repair');}
      const noticeService=require('./knowledge/notices');
      const parsed=await require('./knowledge/public-parser-worker').parse(html,world);
      const noticeBook=noticeService.reconcile(priorNotices,parsed.notes,{at:this.now(),build:h.build});
      fs.mkdirSync(this.dir,{recursive:true});
      const noticeSaved=require('./runtime/telemetry-file').writeTelemetry(noticeFile,noticeBook);
      this.state.notices=noticeService.summary(noticeBook);if(!noticeSaved.ok)this.state.notices.persistenceError=noticeSaved.code;
      const facts=parsed.facts,previous=this.state.current;
      const sourceHashes={client:hash(html),world:hash(world),network:hash(network)};
      facts.fingerprints.network=sourceHashes.network;facts.fingerprints.wikiRules=hash(wikiText);
      this.state.sourceCoherence=require('./knowledge/loaded-source').inspect(this.root,loadedBuild,sourceHashes,{liveBuild:h.build});
      // Source identity and loaded-page identity are distinct. Per-actor guards pin
      // their own generation; this coherence report compares the staged disk source.
      this.state.updatePending=!!loadedBuild&&!this.state.sourceCoherence.matches;
      if(this.state.sourceCoherence.matches){try{this.state.wiki=await require('./knowledge/wiki-sync').refresh(this.root,{build:loadedBuild,fetcher:this.fetch,now:this.now,sourceText:wikiText});this.state.wikiError=null;}catch(e){this.state.wikiError=e.message;this.state.wikiFailedAt=this.now();}}
      else this.state.wikiError='reference archived; loaded client source must match before promotion';
      const changed=previous?Object.keys(facts.fingerprints).filter(k=>previous.fingerprints[k]!==facts.fingerprints[k]):[];
      const id=h.build+'-'+hash(JSON.stringify([sourceHashes,facts.fingerprints.wikiRules])).slice(0,16);
      const reportService=require('./knowledge/update-report');
      const report=previous?.id===id&&previous.updateReport?null:reportService.analyse({previous:this.previousSources(previous),current:{html,world,network,wiki:rawWiki},build:h.build,previousBuild:previous?.build});
      const summary=report?reportService.summarize(report):previous.updateReport;
      const snapshot={domainCompatibility:require('./knowledge/domain-contracts').compare(previous?.fingerprints,facts.fingerprints),id,build:h.build,at:this.now(),discoveredAt:previous?.id===id?(previous.discoveredAt||previous.at):this.now(),...facts,sourceHashes,changed:previous?.id===id?previous.changed:changed,updateReport:summary,
        capabilities:{routes:Object.keys(facts.routes.townGates).length?'observed':'review_required',boss:'review_required',investment:'review_required'},
        evidence:'downloaded_client_sources',serverMechanicsVerified:false};
      if(!previous||previous.id!==id){
        const folder=path.join(this.dir,id);fs.mkdirSync(folder,{recursive:true});
        fs.writeFileSync(path.join(folder,'client.html'),html);fs.writeFileSync(path.join(folder,'world.js'),world);
        fs.writeFileSync(path.join(folder,'network.js'),network);fs.writeFileSync(path.join(folder,'wiki.json'),wikiText);
        fs.writeFileSync(path.join(folder,'update-report.json'),JSON.stringify(report,null,2));
        fs.writeFileSync(path.join(folder,'facts.json'),JSON.stringify(snapshot,null,2));
        this.state.history=[{id,build:h.build,at:snapshot.at,changed,counts:summary.wikiDiff?.counts,coverage:summary.coverage?.complete},...(this.state.history||[])].slice(0,100);
        this.log(`game knowledge: ${previous?'changed':'baseline'} build=${h.build}, sections=${changed.join(',')||'baseline'}; mechanics require verification`);
      }
      this.state.current=snapshot;this.state.lastError=null;
      this.recordEvidence?.({build:h.build,at:this.now(),collected,fingerprints:facts.fingerprints,notices:noticeBook,compatibility:snapshot.domainCompatibility});
      this.refreshVersion(loadedBuild);
      this.save();return snapshot;
    } catch(e){this.state.lastError=e.message;this.state.failedAt=this.now();if(this.state.notices)this.state.notices={...this.state.notices,fresh:false,lastAttemptAt:this.now(),status:'collection_failed',errors:[{code:'collection_failed',message:String(e.message).slice(0,160)}]};this.nextAt=this.now()+Math.min(this.intervalMs,30000);this.refreshVersion(loadedBuild);this.save();this.log('game knowledge: '+e.message);return false;}
    finally{this.busy=false;}
  }
  view(){const {updateReport,...current}=this.state.current||{};return {evidenceStore:require('./knowledge/evidence-store').project(this.state.evidenceStore,this.now()),evidenceStoreError:this.state.evidenceStoreError||null,liveBuild:this.state.liveBuild,loadedBuild:this.state.loadedBuild,updatePending:this.state.updatePending,checkedAt:this.state.checkedAt,lastError:this.state.lastError,notices:this.state.notices||null,wiki:this.state.wiki||null,wikiError:this.state.wikiError||null,systemVersion:this.state.systemVersion||null,systemVersionError:this.state.systemVersionError||null,sourceCoherence:this.state.sourceCoherence||null,collection:this.state.collection||null,updates:updateReport||null,current:this.state.current?current:null,history:this.state.history?.slice(0,5)};}
}
module.exports={GameKnowledge,extract,stagedHtml};
