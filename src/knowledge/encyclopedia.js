'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const pointer=s=>String(s).replace(/~/g,'~0').replace(/\//g,'~1');
const ADAPTERS=[
 ['travel','เดินทางและกลับเมือง','maps',['travelTo','returnToTown'],'position_room_changed'],
 ['class','เลื่อนอาชีพและ High Class','classes',['advanceJob','chooseJob'],'fresh_save_job_changed'],
 ['skills','สเตตัสและสกิล','classes',['spendStatPoints','spendSkillPoints'],'fresh_save_points_and_levels'],
 ['equipment','อุปกรณ์และชุด','items',['equipItems','recoverStoredUpgrades'],'fresh_save_equipped_id'],
 ['craft','คราฟและปีก','crafting',['craftAtExchange'],'fresh_save_item_and_cost_delta'],
 ['refine','ตีบวก','systems',['refineEquipped'],'fresh_save_refine_and_cost_delta'],
 ['enchant','ออฟอาวุธ','systems',['enchantWeapon'],'fresh_save_options_and_cost_delta'],
 ['cards','ฝังการ์ด','systems',['insertPlannedCard'],'socket_changed_and_consumed_card'],
 ['pets','สัตว์เลี้ยง','systems',['wearBestPet','petWear'],'fresh_pet_id'],
 ['quests','เควสและของรายวัน','quests',['workQuestBoard','claimDailies','claimLogin'],'quest_progress_and_reward_delta'],
 ['economy','ซื้อขาย คลัง และยา','items',['buyItem','sellItems','stashItems','restockPotions'],'inventory_and_currency_delta'],
 ['party','ปาร์ตี้และประสานทีม','systems',['partyInvite','partyAcceptPending'],'server_party_roster'],
 ['boss','บอสและหลบกลไก','monsters',['queryBosses','engageWorldBoss'],'server_damage_and_boss_reward'],
 ['dungeon','ดันเจี้ยน','systems',['dungeonStart','dungeonJoin','prepareDungeon'],'server_completed_and_reward'],
 ['tower','หอคอย','systems',['towerStart','towerJoin','towerState'],'server_floor_and_result'],
 ['guild','กิลด์และดันกิลด์','systems',['guildInvite','donateToGuild','enterGuildHall','guildDungeonStart'],'server_guild_state_and_reward'],
 ['guild-war','สงครามกิลด์','systems',['guildWarQuery','guildWarJoin'],'server_war_result'],
 ['premium','บริการพรีเมียมและการทดสอบ','systems',['managePremium','claimTester'],'entitlement_and_reward_delta'],
];
function compile(wiki,cat,{build,sourceHash,adapterNames=[]}={}){
 const articles=[],edges=[];
 function add(domain,group,key,facts){const id=domain+'/'+group+'/'+pointer(facts?.id||facts?.resultId||key),name=facts?.name||facts?.result||facts?.title||key;articles.push({id,domain,group,key:String(key),name:String(name),facts,fingerprint:digest(facts),source:{url:'https://asteria-online.io/wiki/data.json',pointer:'/'+domain+'/'+pointer(group)+'/'+pointer(key),hash:sourceHash,build,status:'reference'}});return id;}
 for(const domain of ['classes','monsters','maps','items','crafting','quests','systems'])for(const[group,value]of Object.entries(wiki[domain]||{})){
  if(Array.isArray(value))value.forEach((facts,index)=>add(domain,group,index,facts));
  else if(value&&typeof value==='object'&&domain!=='systems')for(const[key,facts]of Object.entries(value))add(domain,group,key,facts);
  else add(domain,group,'rule',value);
 }
 const named=new Map(articles.filter(a=>a.domain==='items'&&a.group==='equipment').map(a=>[a.name,a.id]));
 const recipes=articles.filter(a=>a.domain==='crafting'&&a.group==='recipes');
 const recipeNames=new Map(recipes.map(a=>[a.facts.result,a.id]));
 for(const a of recipes){if(named.has(a.facts.result))edges.push({from:a.id,to:named.get(a.facts.result),kind:'produces'});for(const[name,quantity]of Object.entries(a.facts.cost||{}))edges.push({from:a.id,to:recipeNames.get(name)||named.get(name)||'resource/'+name,kind:'requires',quantity});}
 const monsterArticles=articles.filter(a=>a.domain==='monsters');const byMonster=new Map(monsterArticles.map(a=>[a.facts.id,a]));
 for(const a of articles.filter(a=>a.domain==='maps'&&a.group==='maps'))for(const ids of Object.values(a.facts.monsters||{}))for(const id of ids)if(byMonster.has(id))edges.push({from:byMonster.get(id).id,to:a.id,kind:'spawns_in'});
 for(const a of monsterArticles)for(const d of a.facts.dropTable||[])edges.push({from:a.id,to:named.get(d.item)||'resource/'+d.item,kind:'drops',ratePct:d.ratePct});
 const names=new Set(adapterNames),capabilities=ADAPTERS.map(([id,name,domain,methods,proof])=>({id,name,domain,methods,proof,scope:['boss','cards','guild-war'].includes(id)?'guarded_action_adapter':'action_adapter',adapterImplemented:methods.length>0&&methods.every(m=>names.has(m)),status:methods.length>0&&methods.every(m=>names.has(m))?'adapter_present_requires_outcomes':'missing_adapter',serverVerified:false,referenceArticles:articles.filter(a=>a.domain===domain).length}));
 const domains=Object.fromEntries(['classes','monsters','maps','items','crafting','quests','systems'].map(k=>[k,articles.filter(a=>a.domain===k).length]));
 return {version:2,build,revision:digest([build,sourceHash,cat?.wingRecipes,articles.map(a=>a.fingerprint),capabilities]),sourceHash,source:wiki._source||{url:'https://asteria-online.io/wiki/data.json',fetchedAt:null},articles,edges,capabilities,domains,recipeValidation:{wings:cat?.wingRecipes?.length||0,verified:cat?.wingRecipes?.filter(r=>r.verified).length||0},limits:'Wiki facts are references; adapter existence is not evidence that the activity has been completed'};
}
function query(book,{q='',domain='',limit=30}={}){const needle=String(q).toLocaleLowerCase().slice(0,100);return book.articles.filter(a=>(!domain||a.domain===domain)&&(!needle||(a.name+' '+a.key+' '+JSON.stringify(a.facts)).toLocaleLowerCase().includes(needle))).slice(0,Math.max(1,Math.min(100,limit))).map(a=>({...a}));}
function diff(previous,current){const old=new Map((previous?.articles||[]).map(a=>[a.id,a]));const changed=current.articles.filter(a=>old.has(a.id)&&old.get(a.id).fingerprint!==a.fingerprint).map(a=>({id:a.id,domain:a.domain,name:a.name}));const ids=new Set(current.articles.map(a=>a.id));return {added:current.articles.filter(a=>!old.has(a.id)).map(a=>a.id),removed:[...old.keys()].filter(id=>!ids.has(id)),changed,affectedDomains:[...new Set(changed.map(a=>a.domain))]};}
function save(root,book){const dir=path.join(root,'logs','encyclopedia',book.revision.slice(0,24));fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'book.json');if(!fs.existsSync(file)){const temp=file+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';fs.writeFileSync(temp,JSON.stringify(book));fs.renameSync(temp,file);}return file;}
module.exports={compile,query,diff,save,digest,ADAPTERS};
