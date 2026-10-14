'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const copy=x=>JSON.parse(JSON.stringify(x));
class QuestOutcomes{
 constructor(root,identity,build){this.build=build;this.file=path.join(root,'logs','quest-outcomes',build,crypto.createHash('sha256').update(identity).digest('hex').slice(0,24)+'.json');try{this.data=JSON.parse(fs.readFileSync(this.file));}catch{this.data={rows:[]};}this.previous=null;this.intent=null;}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 begin(state,at=Date.now()){if(!state?.boardQuest||state.boardQuest.count<state.boardQuest.goal)return;this.intent={before:copy(state),at};}
 row(kind,detail,at){this.data.rows.unshift({kind,detail,at,evidence:'outgoing_client_save',serverVerified:false});this.data.rows=this.data.rows.slice(0,160);}
 observe(state,at=Date.now()){
  const before=this.previous;
  if(before&&Number.isInteger(state.qIndex)&&Number.isInteger(before.qIndex)&&state.qv===before.qv&&state.qIndex>before.qIndex)this.row('main_quest',{from:before.qIndex,to:state.qIndex},at);
  if(before?.daily?.day&&state.daily?.day===before.daily.day){for(let n=0;n<3;n++)if(state.daily.got?.[n]&&!before.daily.got?.[n])this.row('daily_reward',{index:n,day:state.daily.day},at);if(state.daily.all&&!before.daily.all)this.row('daily_bonus',{day:state.daily.day},at);}
  if(this.intent){const b=this.intent.before;
   if(at-this.intent.at>30000){this.row('board_unconfirmed',{reason:'no matching reward save within 30 seconds'},at);this.intent=null;}
   else if(at>this.intent.at&&!state.boardQuest&&state.daily?.day===b.daily?.day&&Number(state.daily?.board)>Number(b.daily?.board)){
    this.row('board_reward',{target:b.boardQuest.targetName||b.boardQuest.item,map:b.boardQuest.mapId,count:b.boardQuest.count,goal:b.boardQuest.goal,coinsDelta:(state.coins||0)-(b.coins||0),tokensDelta:(state.tokens||0)-(b.tokens||0),rewardCounter:state.daily.board},at);this.intent=null;
   }
  }
  this.previous=copy(state);this.data.checkedAt=at;this.data.current={qIndex:state.qIndex,qHave:state.qHave,qv:state.qv,board:state.boardQuest||null,daily:state.daily||null};this.save();
 }
 view(){return {build:this.build,checkedAt:this.data.checkedAt,current:this.data.current,awaitingClaim:!!this.intent,rows:this.data.rows.slice(0,30),evidence:'outgoing_client_save',serverVerified:false};}
}
module.exports={QuestOutcomes};
