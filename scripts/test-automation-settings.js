'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),a=require('../src/runtime/automation-settings');
const html=fs.readFileSync('cache/9e935de/asteria-online.io/asteria-online-visual-polish.html','utf8');
const start=html.indexOf('  const autoMode ='),end=html.indexOf('  const AUTO_MODE_IC',start);assert(start>0&&end>start);
assert(html.slice(html.indexOf("} else if (setTab === 'loot')"),html.indexOf("} else if (setTab === 'sound')")).includes("sw('optOffBot'"),'current native offline control is in loot, not potion');
function fixture({legacy=false,missingChip=false}={}){
 const auto={skillOff:['user_off'],bossSk:['holy_light'],skills:false,buffs:false,basic:false,heal:false,order:'mine',od:'off',radius:16,potPct:35,hpPot:'Red Potion',mpPot:'Blue Potion'},context={auto};vm.createContext(context);vm.runInContext(html.slice(start,end)+'\nthis.cycle=cycleAutoMode;',context);
 let tab='account',clicks=0;const getTab=legacy?'auto':'combat',cls=fn=>({contains:fn});
 const chip=id=>({disabled:false,classList:cls(k=>k==='am-'+(auto.skillOff.includes(id)?'off':auto.bossSk.includes(id)?'boss':'on')),click(){clicks++;context.cycle(id);}});
 const names={optSkills:['skills',getTab],optBuffs:['buffs',getTab],optBasic:['basic',getTab],optHeal:['heal','potion'],optPotHand:['ph','potion'],optOffBot:['offBot','loot']},segs={order:getTab,od:getTab,radius:getTab,hpPot:'potion',mpPot:'potion',potPct:'potion'};
 const document={getElementById(id){const n=names[id];if(!n||tab!==n[1])return null;return {disabled:false,get checked(){return !!auto[n[0]];},click(){clicks++;auto[n[0]]=!auto[n[0]];}};},querySelector(q){
  let m=q.match(/^\[data-set-tab="(.*?)"\]$/);if(m)return [getTab,'potion','loot'].includes(m[1])?{click(){tab=m[1];}}:null;
  m=q.match(/^\[data-seg="(.*?)"\] \[data-v="(.*?)"\]$/);if(m&&tab===segs[m[1]])return {disabled:false,classList:cls(k=>k==='on'&&String(auto[m[1]])===m[2]),click(){clicks++;auto[m[1]]=['radius','potPct'].includes(m[1])?Number(m[2]):m[2];}};
  m=q.match(/^\[data-auto-sk="(.*?)"\]$/);if(m&&tab===getTab&&!(missingChip&&m[1]==='holy_light'))return chip(m[1]);return null;
 }};
 return {auto,run:(fn,plan)=>JSON.parse(JSON.stringify(vm.runInNewContext('('+fn.toString()+')('+JSON.stringify(plan)+')',{document}))),get clicks(){return clicks;},missing(){missingChip=true;},restore(){missingChip=false;}};
}
for(const legacy of [false,true]){const f=fixture({legacy}),out=f.run(a.configure,{radius:28,potPct:70,offlineBot:true});assert.equal(out.status,'applied');assert.equal(f.auto.order,'smart');assert.equal(f.auto.od,'boss');assert(f.auto.skills&&f.auto.buffs&&f.auto.basic&&f.auto.heal);assert.deepEqual(f.auto.skillOff,['user_off']);assert.deepEqual(f.auto.bossSk,['holy_light']);assert.equal(out.expected.mp,'auto');const clicks=f.clicks;f.run(a.configure,{radius:28,potPct:70,offlineBot:true});assert.equal(f.clicks,clicks,'already selected settings do not flood saves');
 let state=f.run(a.manaSkills,{conserve:true,skills:['holy_light','lumen_ray','user_off'],held:[]});assert.deepEqual(state.held,[{id:'holy_light',mode:'boss'},{id:'lumen_ray',mode:'on'}]);assert(f.auto.skillOff.includes('lumen_ray'),'on -> boss -> off needs two native cycles');assert(f.auto.skillOff.includes('holy_light'));const count=f.clicks;state=f.run(a.manaSkills,{conserve:true,skills:['holy_light','lumen_ray','user_off'],held:state.held});assert.equal(f.clicks,count,'low MP repeats do not cycle held skills back on');
 f.missing();state=f.run(a.manaSkills,{conserve:false,held:state.held});assert.deepEqual(state.held,[{id:'holy_light',mode:'boss'}],'missing UI keeps restoration pending');assert(!f.auto.skillOff.includes('lumen_ray'));f.restore();state=f.run(a.manaSkills,{conserve:false,held:state.held});assert.equal(state.held.length,0);assert(f.auto.bossSk.includes('holy_light'),'restore original boss restriction');assert(f.auto.skillOff.includes('user_off'),'leave originally disabled skills off');
 const save={autoOpt:{...f.auto,hp:f.auto.hpPot,mp:f.auto.mpPot},offBot:f.auto.offBot},settings={expected:out.expected};assert(a.observed(settings,save,10).confirmed);assert(!a.observed(settings,{...save,autoOpt:{...save.autoOpt,order:'mine'}},11).confirmed,'clicks alone do not prove native save');
}
const missing=vm.runInNewContext('('+a.configure.toString()+')({})',{document:{querySelector:()=>null}});assert.equal(missing.status,'unsupported_combat_tab');
const recovery=fixture(),r=recovery.run(a.configure,{potPct:90,potHand:true});assert.equal(recovery.auto.ph,true);assert.equal(recovery.auto.potPct,90);assert.equal(r.expected.ph,true);
assert(!a.observed(r,{autoOpt:{...recovery.auto,hp:'auto',mp:'auto',ph:false}},Date.now()).confirmed,'click is not proof that manual recovery potion setting saved');
recovery.run(a.configure,{potPct:70,potHand:true});assert.equal(recovery.auto.potPct,70,'restore field threshold');
const current=require('../machines/fleet-client-release.json').build,native=fs.readFileSync('cache/'+current+'/asteria-online.io/asteria-online-visual-polish.html','utf8');assert(native.includes("sw('optPotHand', auto.potHand)")&&native.includes('!auto.on && auto.potHand && !player.dead && running')&&native.includes('auto.potHand = e.target.checked; saveGame()'),'loaded native supports manual potion control, effect and save');
console.log('PASS native three-state cycle, current/legacy tabs, split potion controls, idempotence, pending restoration, native save confirmation');
