'use strict';
const {fresh}=require('./team-workboard');
function plan(i,g,now=Date.now()){
 const cat=i.catalog(),gu=cat.world?.GUILD,board=i.teamWorkboard,me=g?.members?.find(m=>m.name===i.credentials?.charName);
 const result={at:now,build:cat.build,guild:g?.id?{id:g.id,name:g.name,lv:g.lv,funds:g.funds,total:g.total,next:g.next,runes:g.runes,checkedAt:g._receivedAt}:null,donations:[],rune:null};
 if(!gu||!g?.id||!me||!fresh(g._receivedAt,30000,now)||!fresh(i.lastSaveAt,30000,now))return {...result,reason:'รอข้อมูลสมาชิก กองทุน และเซฟสดก่อนใช้ทรัพยากร'};
 const allRecipeNames=new Set((require('../economy').loadWiki(i.root)?.crafting?.recipes||[]).flatMap(r=>Object.keys(r.cost||{}))),protectedNames=new Set([...(board?.protectedNames||[]),...require('./team-workboard').project(i).needs.map(r=>r.name),...(board?.demands||[]).map(r=>r.name),...(board?.assignments||[]).map(r=>r.material),...(i.endgameCampaign?.requirements||[]).map(r=>r.name),...Object.keys(i.v2?.reservations?.totals(cat.build)||{}),...allRecipeNames]);
 const teamFresh=board?.complete&&board.build===cat.build&&fresh(board.at,15000,now);
 if(teamFresh)for(const [name,n]of Object.entries(i.lastSave.materials||{})){const value=gu.matValue(name);if(n>0&&value>0&&value<20&&!protectedNames.has(name)&&!['Pure Crystal','Iron Ore','Sunsteel Ore','Frost Ore','Dark Iron','Abyss Steel'].includes(name)&&!i.lastSave.locks?.includes(name))result.donations.push({name,quantity:Math.min(20,n),gp:Math.min(20,n)*value});}
 if(i.credentials?.charName===(i.guildRuneWriter||require('../../machines/fleet.json').leader)&&['leader','officer'].includes(me.rank)&&Number.isFinite(g.funds)&&g.runes){const priority=['ward','vigor','might'];const options=priority.filter(k=>gu.RUNES[k]&&Number.isInteger(g.runes[k])&&g.runes[k]<Math.min(g.lv,gu.MAX_RUNE)).map(k=>({key:k,from:g.runes[k],to:g.runes[k]+1,cost:gu.runeCost(g.runes[k]+1)})).filter(r=>Number.isFinite(r.cost)&&r.cost<=g.funds);options.sort((a,b)=>a.from-b.from||priority.indexOf(a.key)-priority.indexOf(b.key));result.rune=options[0]||null;}
 return {...result,reason:result.rune?'อัปรูนหนึ่งขั้นจากกองทุนจริง ตรวจระดับก่อนทำต่อ':!teamFresh?'ทีมไม่ครบ/ข้อมูลเก่า งดบริจาคเพื่อกันของเพื่อน':result.donations.length?'บริจาคเฉพาะของทั่วไปที่ไม่มีเควสหรือสูตรในทีมต้องใช้':'เก็บของพัฒนาตัวละครไว้ · รอ GP หรือรูนถึงเงื่อนไข'};
}
module.exports={plan};
