'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
function inventory(root){
 const files=[];
 function walk(dir){if(!fs.existsSync(path.join(root,dir)))return;for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(/\.(js|html|css)$/.test(e.name))files.push(p);}}
 walk('src');
 if(fs.existsSync(path.join(root,'machines/runtime-v32.json')))files.push('machines/runtime-v32.json');
 for(const p of ['scripts/registry-authority.js','scripts/registry-host-agent.js','scripts/registry-bridge.py','scripts/v32-checks.js','scripts/v32-soak.js','scripts/build-expansion-release.js'])if(fs.existsSync(path.join(root,p)))files.push(p);
 for(const p of ['scripts/review-game-release.js','scripts/repair-worker.js','package.json','package-lock.json','scripts/run.js','scripts/control-fleet.js','scripts/build-architecture-release.js','scripts/test-version-release.js','scripts/fleet-exchange.py','scripts/fleet-panel-bridge.py','scripts/vps-panel-bridge.py','scripts/create-expansion-team.js','machines/windows/config.json','machines/tum/config.json','machines/vps/config.json','machines/expansion.json','machines/topology-v32.json','machines/host-teams.json','machines/equipment-goal.json','machines/daily-team-activities.json'])if(fs.existsSync(path.join(root,p)))files.push(p);
 const hashes=Object.fromEntries(files.sort().map(p=>[p,sha(fs.readFileSync(path.join(root,p)))]));
 // Unknown/new files stay in the farm boundary. Advisory command guards are
 // part of the runtime, while static web assets have no farm control ownership.
 const component=p=>['src/ai-advisor.js','src/auto-brain.js'].includes(p)?'ai':p.startsWith('src/public/')||p==='src/fleet-dashboard.js'?'web':['src/panel.js','src/runtime/panel-security.js'].includes(p)?'controller':'farm';
 const components=Object.fromEntries(['farm','ai','web','controller'].map(name=>{const part=Object.fromEntries(Object.entries(hashes).filter(([p])=>component(p)===name));return [name,{revision:sha(JSON.stringify(part)),hashes:part}];}));
 return {revision:components.farm.revision,hashes,components,fullRevision:sha(JSON.stringify(hashes))};
}
function inspect(root,build,{knowledge,loadedSystemRevision,now=Date.now()}={}){
 const economy=require('../economy'),cat=economy.loadCatalog(root,build),wiki=economy.loadWiki(root),identity=require('./loaded-source').capture(root,build);
 const k=knowledge||read(path.join(root,'logs/game-knowledge/state.json'));
 const co=require('./loaded-source').inspect(root,build,k?.current?.sourceHashes,{liveBuild:k?.liveBuild,identity});
 const wikiCurrent=wiki?._source?.verifiedBuild===build&&!k?.wikiError&&!k?.lastError;
 const liveFresh=Number.isFinite(k?.checkedAt)&&now-k.checkedAt>=-5000&&now-k.checkedAt<=600000;
 const release=read(path.join(root,'logs/system-audit/architecture-release.json')),code=inventory(root);
 const releaseFilesCurrent=release?.sourceRevision===code.revision&&release?.build===build&&['client','world','network'].every(key=>release?.gameSourceHashes?.[key]===identity.sourceHashes[key]);
 const ref=cat.world?.REFINE;
 let quest;try{const q=require('../planning/main-quest').catalog(root,build);quest={version:q.version,revision:q.revision,count:q.quests.length};}catch(e){quest={error:e.message};}
 let book;try{const b=require('./mastery-service').getBook(root,build);book={build:b.build,revision:b.revision,articles:b.articles.length,edges:b.edges.length,referenceBuild:b.source?.verifiedBuild};}catch(e){book={error:e.message};}
 const marker=kind=>require('./adapter-source').inspect(root,build,kind);
 const rows=[];
 const add=(id,facts,available=true,evidence='loaded_native_tables')=>rows.push({id,build,referenceBuild:wiki?._source?.verifiedBuild||null,status:available?'current_data':'review_required',facts,evidence,serverVerified:false});
 add('classes',{classes:Object.keys(cat.jobs||{}).length,highClasses:Object.keys(cat.world?.HIGH_CLASSES||{}).length,maxLevel:cat.world?.MAX_LV},Number.isInteger(cat.world?.MAX_LV)&&!!cat.jobs&&!cat.classSchemaError);
 add('skills',{classes:Object.keys(cat.jobs||{}).length,learnableSkills:[...new Set(Object.values(cat.jobs||{}).flatMap(j=>j.skills||[]))].length},!!cat.jobs&&!cat.classSchemaError,'loaded_client_base_and_high_class_tables');
 add('maps',{count:cat.world?.MAPS?.length||wiki?.maps?.maps?.length||0},!!wiki?.maps?.maps?.length);
 add('monsters',{count:cat.world?.MONSTERS?.length||0},!!cat.world?.MONSTERS?.length);
 add('equipment',{count:Object.keys(cat.items||{}).length,goal:require('../equipment-goal').policy(cat)},!!Object.keys(cat.items||{}).length);
 add('craft',{nativeRecipes:cat.nativeRecipes?.length||0},!!cat.nativeRecipes?.length,'reviewed_native_recipe_construction');
 add('wings',{recipes:cat.wingRecipes?.length||0,verified:cat.wingRecipes?.filter(r=>r.verified).length||0},!!cat.wingRecipes?.length&&cat.wingRecipes.every(r=>r.verified),'exact_wiki_and_loaded_client_formula');
 add('refine',{max:ref?.max,chance:ref?.chance,optionalStone:cat.world?.STONES?.refine||null,stonePolicy:'base odds; optional premium checkbox kept off'},Number.isInteger(ref?.max)&&Array.isArray(ref?.chance),'loaded_native_refine_rules');
 add('forge',{stageMax:cat.world?.FORGE?.STAGE?.max,optionalEnchantStone:cat.world?.STONES?.enchant||null,enchantPolicy:'separate current-handler review gate'},!!cat.world?.FORGE,'loaded_native_forge_rules');
 add('quests',quest,!quest.error,'loaded_quest_table_and_schema');
 add('storage',{bagTiers:cat.world?.BAG_PRICES?.length,storageTiers:cat.world?.STORE_PRICES?.length},!!cat.world?.bagCap&&!!cat.world?.storeCap);
 for(const [id,kind]of [['guild','guild'],['tower','daily-activity'],['dungeon','activity'],['boss','boss'],['cards','cards'],['guild-war','war']]){const q=marker(kind);add(id,{markersPresent:q.allowed,markerFingerprint:q.fingerprint},q.allowed,'loaded_client_call_sites_only_requires_runtime_outcome');}
 add('learning',{generation:k?.current?.id,encyclopedia:book},!!book.revision&&book.referenceBuild===build,'build_scoped_reference_and_learning_generation');
 const coverage={news:k?.notices?{complete:k.notices.coverage?.complete===true,fresh:k.notices.fresh===true,status:k.notices.status,revision:k.notices.revision}: {complete:false,fresh:false,status:'unobserved',revision:null},wiki:{complete:!!wikiCurrent,status:wikiCurrent?'current':'review_required'}};
 const reasons=[];
 if(!liveFresh||!co.matches)reasons.push('live/loaded client evidence missing, stale or mismatched');
 if(!wikiCurrent)reasons.push('Wiki not validated against this build');
 if(!releaseFilesCurrent)reasons.push('architecture manifest differs from current code/game source');
 if(loadedSystemRevision&&loadedSystemRevision!==code.revision)reasons.push('running system code differs from files on disk');
 if(rows.some(r=>r.status==='review_required'))reasons.push('some domains require data/schema review');
 return {version:1,at:now,build,liveBuild:k?.liveBuild,coverage,sourceHashes:identity.sourceHashes,sourceRevision:code.revision,componentRevisions:Object.fromEntries(Object.entries(code.components).map(([k,v])=>[k,v.revision])),loadedSystemRevision:loadedSystemRevision||null,architectureBuild:release?.build||null,architectureCurrent:releaseFilesCurrent,wikiBuild:wiki?._source?.verifiedBuild||null,wikiCurrent,liveFresh,sourceMatches:co.matches,dataCurrent:liveFresh&&co.matches&&wikiCurrent,aligned:reasons.length===0,reasons,domains:rows,encyclopedia:book,authorizesActions:false,serverVerified:false,limits:'Version/data alignment and call-site presence do not approve an adapter, prove a completed activity or replace current-build gameplay/soak evidence.'};
}
module.exports={inventory,inspect};
