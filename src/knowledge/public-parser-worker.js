'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread){try{const result={notes:require('./patch-notes').extractPatchNotes(workerData.html),facts:require('../game-knowledge').extract(workerData.html,workerData.world)};parentPort.postMessage({ok:true,result});}catch{parentPort.postMessage({ok:false,error:'public_parser_failure'});}}
async function parse(html,world,{timeoutMs=30000}={}){
 if(typeof html!=='string'||typeof world!=='string'||html.length>8000000||world.length>8000000)throw Error('Bounded public source required');
 let worker;try{return await new Promise((resolve,reject)=>{worker=new Worker(__filename,{workerData:{html,world},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});const timer=setTimeout(()=>reject(Error('Public parsing deadline; coverage unknown')),timeoutMs);worker.once('message',r=>{clearTimeout(timer);r.ok?resolve(r.result):reject(Error(r.error));});worker.once('error',()=>{clearTimeout(timer);reject(Error('Bounded public worker failed; coverage unknown'));});worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Public worker terminated; coverage unknown'));});});}finally{if(worker)await worker.terminate();}
}
module.exports={parse};
