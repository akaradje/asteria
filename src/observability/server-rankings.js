'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const CATEGORIES=['overall','power','level','rich','collector'];
function numeric(v){return typeof v==='number'&&Number.isFinite(v)?v:null;}
function row(value){if(!value||typeof value!=='object')return null;return {name:typeof value.name==='string'?value.name.slice(0,80):null,job:typeof value.job==='string'?value.job.slice(0,40):null,lv:numeric(value.lv),pos:numeric(value.pos),v:numeric(value.v),sub:Array.isArray(value.sub)?value.sub.slice(0,4).map(numeric):null};}
function normalize(frame,at=Date.now()){
 if(frame?.t!=='rank'||!CATEGORIES.includes(frame.cat)||!Number.isInteger(frame.n)||frame.n<0||!Array.isArray(frame.list))return null;
 const me=row(frame.me);if(me&&(!Number.isInteger(me.pos)||me.pos<1||me.pos>frame.n))return null;
 return {category:frame.cat,receivedAt:at,nextUpdateAt:numeric(frame.next),population:frame.n,me,leaders:frame.list.slice(0,10).map((r,i)=>({...row(r),pos:i+1})).filter(r=>r.name)};
}
class ServerRankings{
 constructor(root,character){this.character=character;this.file=path.join(root,'logs/rankings',crypto.createHash('sha256').update(character).digest('hex').slice(0,24)+'.json');this.categories={};try{const saved=JSON.parse(fs.readFileSync(this.file));if(saved.character===character)this.categories=saved.categories||{};}catch{}}
 observe(frame,at=Date.now()){const next=normalize(frame,at);if(!next)return false;const old=this.categories[next.category];if(old&&at<=old.receivedAt)return false;
 const history=(old?.history||[]).slice(-999);if(next.me&&(!history.length||history.at(-1).round!==next.nextUpdateAt||history.at(-1).pos!==next.me.pos||history.at(-1).value!==next.me.v))history.push({at,round:next.nextUpdateAt,pos:next.me.pos,value:next.me.v,population:next.population});
 this.categories[next.category]={...next,history};fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify({character:this.character,categories:this.categories}));fs.renameSync(temp,this.file);return true;}
 view(now=Date.now()){return {character:this.character,targetTop:10,categories:Object.fromEntries(CATEGORIES.map(cat=>{const r=this.categories[cat];if(!r)return [cat,null];const fresh=now-r.receivedAt>=-5000&&now-r.receivedAt<=360000;const benchmark=fresh?(r.leaders[9]||null):null;const older=r.history?.length>1?r.history.at(-2):null;return [cat,{...r,history:r.history.slice(-48),fresh,ageMs:now-r.receivedAt,rankChange:r.me&&older?older.pos-r.me.pos:null,placesToTarget:r.me?Math.max(0,r.me.pos-10):null,targetValue:benchmark?.v??null,valueGap:r.me&&benchmark&&r.me.v!==null&&benchmark.v!==null?Math.max(0,benchmark.v-r.me.v):null}];}))};}
}
async function refreshRankings(instance){if(!instance.character?.name||!instance.socialInbox)return;const now=Date.now();const store=instance.serverRankings||(instance.serverRankings=new ServerRankings(instance.root,instance.character.name));
 for(const cat of CATEGORIES){const frame=instance.socialInbox.last('rank:'+cat);if(frame)store.observe(frame,frame._receivedAt);}
 if(instance.rankQueryBusy||now<(instance.nextRankQueryAt||0))return;instance.nextRankQueryAt=now+60000;instance.rankQueryBusy=true;
 try{for(const cat of CATEGORIES){const prior=store.categories[cat];if(prior&&now-prior.receivedAt<300000)continue;await instance.socialSend('rankq',{cat});await new Promise(resolve=>setTimeout(resolve,1500));}}finally{instance.rankQueryBusy=false;}
}
module.exports={CATEGORIES,normalize,ServerRankings,refreshRankings};
