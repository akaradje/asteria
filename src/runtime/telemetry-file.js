'use strict';
const fs=require('fs'),path=require('path');
let sequence=0;
// Readers can briefly prevent replacement on Windows. Keep the last complete
// snapshot and let the next publication retry; never truncate the live file.
function writeTelemetry(file,data){
 const temporary=file+'.'+process.pid+'.'+(++sequence)+'.tmp';
 try{
  fs.writeFileSync(temporary,JSON.stringify(data));
  fs.renameSync(temporary,file);
  return {ok:true};
 }catch(error){
  if(!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
  return {ok:false,file:path.basename(file),code:error.code};
 }finally{
  try{fs.unlinkSync(temporary);}catch{}
 }
}
module.exports={writeTelemetry};
