'use strict';
function aligned(fleet,revision,build,now=Date.now()){
 if(typeof revision!=='string'||!revision||typeof build!=='string'||!build)return false;
 return ['windows','tum'].every(machine=>{
  const host=fleet.machines?.[machine],v=host?.version,snapshotAt=Date.parse(host?.snapshotAt);
  return host?.running===true&&Number.isFinite(snapshotAt)&&snapshotAt<=now&&now-snapshotAt<45000&&v?.build===build&&v.sourceRevision===revision&&v.loadedSystemRevision===revision&&v.aligned===true&&Number.isFinite(v.at)&&v.at<=now&&now-v.at<600000;
 });
}
module.exports={aligned};
