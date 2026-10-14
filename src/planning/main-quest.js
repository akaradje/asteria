'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const cache=new Map();
function catalog(root,build){
 const key=root+':'+build;if(cache.has(key))return cache.get(key);
 if(!/^[\w-]{1,80}$/.test(build||''))throw Error('quest build unavailable');
 const html=fs.readFileSync(path.join(root,'cache',build,'asteria-online.io/asteria-online-visual-polish.html'),'utf8');
 const version=Number(html.match(/const QUEST_VERSION\s*=\s*(\d+)/)?.[1]),a=html.indexOf('const QUESTS = ['),b=html.indexOf('\n];',a);
 if(!version||a<0||b<0)throw Error('quest schema unavailable');
 const code=html.slice(a+'const QUESTS = '.length,b+2),quests=vm.runInNewContext(code,{__L:s=>s},{timeout:1000});
 if(!Array.isArray(quests)||quests.length>500||quests.some(q=>typeof q.k!=='string'||typeof q.title!=='string'||!Number.isFinite(q.need)||q.need<1||!['kill','wolf','talk','leaf','collect','enter','level','job','promote','ascend'].includes(q.kind)))throw Error('quest table requires review');
 const result={version,revision:crypto.createHash('sha256').update(code).digest('hex').slice(0,16),quests};
 if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
function assess(i,wiki,{now=Date.now(),requirements=[],includeBoss=false,board=null}={}){
 const s=i.lastSave||{},build=i.catalog().build||path.basename(i.cache?.dir||'');
 let data;try{data=catalog(i.root,build);}catch(e){return {status:'blocked',reason:e.message,candidate:null};}
 const base={build,revision:data.revision,version:data.version,total:data.quests.length,saveAt:i.lastSaveAt,index:s.qIndex};
 if(!Number.isInteger(s.qIndex)||s.qIndex<0||s.qv!==data.version)return {...base,status:'blocked',reason:'quest save version requires migration',candidate:null};
 if(s.qIndex===data.quests.length)return {...base,status:'complete',reason:'all main quests completed in actual save',candidate:null};
 const q=data.quests[s.qIndex];if(!q)return {...base,status:'blocked',reason:'quest index outside reviewed table',candidate:null};
 const view={...base,key:q.k,title:q.title,kind:q.kind,have:Math.min(q.need,Number(s.qHave)||0),need:q.need,reward:q.reward,status:'waiting',candidate:null};
 if(!i.lastSaveAt||now-i.lastSaveAt>30000||now-i.lastSaveAt< -5000)return {...view,reason:'fresh quest save required'};
 const survival=i.survivalStatus,held=survival&&(survival.recovering||!Number.isFinite(survival.until)||survival.until>now);
 if(i.status&&i.status!=='playing'||i.teamControl||i.recycling||i.choresBusy||i.livePos?.dead||i.survivalRecovery||held)return {...view,reason:'safety or team owns navigation'};
 if(!i.livePos?.at||now-i.livePos.at>10000||now-i.livePos.at< -5000)return {...view,reason:'fresh quest position required'};
 if(q.kind==='collect'&&requirements.some(r=>r.name===q.item&&Number(s.materials?.[q.item]||0)<q.need+Number(r.want||0)))return {...view,reason:'quest would consume reserved crafting material'};
 const blocked=i.brain?.blocked?.(now)||{},maps=wiki?.maps?.maps||[],monsters=wiki?.monsters?.monsters||[];
 const target=monsters.find(m=>m.id===q.targetId&&(m.kind==='normal'||includeBoss&&['boss','miniboss'].includes(m.kind)))|| (q.kind==='collect'?monsters.find(m=>m.kind==='normal'&&(m.dropTable||[]).some(d=>d.item===q.item)):null);
 if(!['kill','wolf','collect','enter'].includes(q.kind))return {...view,reason:'quest requires client condition or NPC; retain primary plan'};
 if(q.kind!=='enter'&&!target)return {...view,reason:'boss quest follows authoritative primary boss schedule'};
 const elite=target&&target.kind!=='normal',boardFresh=board&&now-board._receivedAt>=-5000&&now-board._receivedAt<45000;
 if(elite&&!boardFresh)return {...view,reason:'fresh server boss board required for main quest'};
 const room=i.livePos.room,choices=maps.filter(m=>m.kind==='field'&&m.levelMin<=s.lv&&!blocked[m.id]&&(q.kind==='enter'?m.id===q.mapId:(m.monsters?.[target.kind]||[]).includes(target.id))&&(!elite||board.list?.some(b=>b.id===target.id&&b.map===m.id&&b.up&&!b.next)));
 choices.sort((a,b)=>Number(b.id===room)-Number(a.id===room)||a.levelMin-b.levelMin);const map=choices[0];
 if(!map||target&&target.level>s.lv)return {...view,reason:'no verified safe quest route'};
 const candidate={kind:'main-quest',questKey:q.k,questIndex:s.qIndex,questVersion:data.version,questRevision:data.revision,mapId:map.id,mapName:map.name,monsterId:target?.id,monsterKind:target?.kind||'normal',alive:true,score:1800,label:'เควสหลัก: '+q.title+' '+view.have+'/'+q.need,reason:'verified current quest; primary crafting and boss deadline retain priority'};
 return {...view,status:'eligible',reason:candidate.reason,candidate};
}
module.exports={catalog,assess};
