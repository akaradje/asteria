'use strict';
const fs=require('fs');
function resumeReport(file,now=Date.now()){
 const original=JSON.parse(fs.readFileSync(file,'utf8'));
 if(original.status!=='running'||String(original.startedAt)!==original.runId||!Number.isFinite(original.targetEndAt)||original.targetEndAt<=original.startedAt)throw Error('No valid running soak to resume');
 let report=original;
 try{const temporary=JSON.parse(fs.readFileSync(file+'.tmp','utf8'));if(temporary.runId===original.runId&&temporary.status==='running'&&temporary.lastSample?.at>original.lastSample?.at)report=temporary;}catch{}
 report.recorderRestarts=(report.recorderRestarts||0)+1;
 report.measurementGaps=[...(report.measurementGaps||[]),{from:report.lastSample?.at||report.startedAt,to:now,reason:'recorder stopped; interval not measured'}];
 report.longTermVerified=false;return report;
}
module.exports={resumeReport};
