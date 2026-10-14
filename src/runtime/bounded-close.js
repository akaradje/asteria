'use strict';
async function boundedClose(fn,timeoutMs=20000){let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned context cleanup timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}}
module.exports={boundedClose};
