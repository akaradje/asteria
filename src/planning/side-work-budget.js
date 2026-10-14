'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const fresh=require('../runtime/freshness').fresh;
const key=g=>g?.monsterKind==='normal'&&['card-collection','campaign-side','craft-work','team-gather','wing','promotion'].includes(g.kind)&&[g.mapId,g.monsterId,g.material||g.cardId].every(Boolean)?[g.mapId,g.monsterId,g.material||g.cardId].join(':'):null;
function output(s,g){return g.income&&g.material==='Copper'?Number(s.coins)||0:g.cardId?(s.cards?.[g.cardId]||0)+Number(!!s.cardAlbum?.[g.cardId])+Object.values(s.sockets||{}).reduce((n,r)=>n+(Array.isArray(r)?r.filter(id=>id===g.cardId).length:0),0):Number(s.materials?.[g.material])||0;}
// A dry random drop is an opportunity-cost decision, not proof AUTO is broken.
// Charge only fresh observed field time; never take a paid/team/boss owner.
function filter(i,candidates,now=Date.now()){
 const build=i.catalog().build,name=i.character?.name||i.credentials?.charName;
 if(!name)return candidates;
 let memo=i.sideWorkBudget;
 if(!memo){const file=path.join(i.root,'logs/side-work-budget',crypto.createHash('sha256').update(name).digest('hex').slice(0,24)+'.json');let data;try{data=JSON.parse(fs.readFileSync(file));}catch{data={build,rows:{},history:[]};}memo=i.sideWorkBudget={file,data,previous:null,writtenAt:0};}
 const d=memo.data;
 if(d.build!==build){d.history=[...(d.history||[]),{build:d.build,rows:d.rows}].slice(-3);d.build=build;d.rows={};memo.previous=null;}
 const g=i.goal,k=key(g),s=i.lastSave||{},p=i.livePos;
 const free=!i.teamControl&&!i.dailyTeamPending&&!i.dailyWorkStatus?.ownsNavigation&&!i.pendingTravel&&!i.choresBusy&&!i.recycling&&!i.survivalRecovery&&!i.v2?.trial?.active()&&(!i.teamTradeStatus?.phase||['IDLE','CONFIRMED','CANCELLED'].includes(i.teamTradeStatus.phase))&&!i.v2?.journal?.pending()&&!i.developmentLedger?.blocking('craft');
 const valid=k&&free&&i.v2?.sourceCoherence?.matches===true&&fresh(i.lastSaveAt,30000,now)&&fresh(p?.at,10000,now)&&p.room===g.mapId&&!p.dead&&Array.isArray(s.autoTargets)&&s.autoTargets.length===1&&s.autoTargets[0]===g.monsterId;
 let changed=false;
 if(valid){
  const sample={key:k,at:i.lastSaveAt,kills:s.bestiary?.[g.monsterId]||0,output:output(s,g)},prev=memo.previous;
  if(prev?.at!==sample.at){memo.previous=sample;
   if(prev?.key===k&&sample.at>prev.at&&sample.at-prev.at<=30000){
    const r=d.rows[k]||={quietMs:0,dryMs:0,until:0};
    r.quietMs=sample.kills>prev.kills||sample.output>prev.output?0:r.quietMs+sample.at-prev.at;
    r.dryMs=sample.output>prev.output?0:r.dryMs+sample.at-prev.at;r.at=sample.at;
    if(r.quietMs>=300000||r.dryMs>=1200000){r.until=now+600000;r.reason=r.quietMs>=300000?'ไม่มีผลฆ่าหรือของเป้าหมาย 5 นาที':'ฆ่าได้แต่ไม่ได้ของเป้าหมายในเวลาที่วัด 20 นาที · สลับงานคั่น';r.quietMs=r.dryMs=0;changed=true;}
   }
  }
 }else memo.previous=null;
 d.rows=Object.fromEntries(Object.entries(d.rows||{}).filter(([,r])=>now-(r.at||0)<86400000).sort((a,b)=>b[1].at-a[1].at).slice(0,40));
 const held=Object.entries(d.rows).filter(([,r])=>r.until>now);
 i.campaignWorkStatus={at:now,build,objective:k,blocked:held.map(([target,r])=>({target,until:r.until,reason:r.reason})),quietMs:d.rows[k]?.quietMs||0,dryMs:d.rows[k]?.dryMs||0,evidence:'fresh_exclusive_target_save_deltas; dry_drop_is_not_a_game_failure'};
 if(changed||now-memo.writtenAt>=30000){fs.mkdirSync(path.dirname(memo.file),{recursive:true});const result=require('../runtime/telemetry-file').writeTelemetry(memo.file,d);if(result.ok)memo.writtenAt=now;}
 return candidates.filter(c=>!(d.rows[key(c)]?.until>now));
}
module.exports={filter,key,output};
