'use strict';
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text=x=>typeof x==='string'&&x.length>0&&x.length<=240;
const authorities=new Set(['native_state','native_receipt','client_rule','wiki_rule','announcement','hypothesis']);
// A source is authoritative only within its scope. A public client cannot
// override a wallet receipt; a wallet receipt cannot prove a general drop rule.
function validate(f){
 if(!f||!text(f.key)||!text(f.domain)||!text(f.source)||!text(f.build)||!text(f.scope)||!authorities.has(f.authority)||!Number.isSafeInteger(f.at)||f.at<0||!Number.isSafeInteger(f.expiresAt)||f.expiresAt<f.at||!Array.isArray(f.dependencies)||f.dependencies.length>64||f.dependencies.some(d=>!text(d))||!text(f.evidenceId))throw Error('Invalid scoped fact');
 if(f.value===undefined||Buffer.byteLength(JSON.stringify(f.value))>65536)throw Error('Invalid bounded fact value');
 if(['native_state','native_receipt'].includes(f.authority)&&(!text(f.actorId)||!text(f.session)||!Number.isSafeInteger(f.generation)||f.generation<1||!Number.isSafeInteger(f.rev)||f.rev<0))throw Error('Native identity/revision required');
 const native=['native_state','native_receipt'].includes(f.authority);
 return {...f,id:hash([f.key,f.scope,f.source,f.build,f.actorId??null,f.session??null,f.generation??null,f.rev??null,native?f.at:0,f.value,f.evidenceId])};
}
function resolve(rows,{key,scope,build,actorId=null,session=null,generation=null,now=Date.now(),purpose='rule'}={}){
 const matches=rows.filter(f=>f.key===key&&f.scope===scope&&f.build===build&&f.at<=now&&f.expiresAt>=now&&(!f.actorId||f.actorId===actorId&&f.session===session&&f.generation===generation));
 const permitted=purpose==='state'?new Set(['native_state','native_receipt']):purpose==='receipt'?new Set(['native_receipt']):new Set(['client_rule','wiki_rule','announcement']);
 const latest=new Map();for(const f of matches.filter(f=>permitted.has(f.authority))){const k=[f.source,f.authority,f.actorId,f.session,f.generation].join(':');const prev=latest.get(k);if(!prev||(f.rev??0)>(prev.rev??0)||(f.rev??0)===(prev.rev??0)&&f.at>prev.at)latest.set(k,f);}
 const selected=[...latest.values()];if(!selected.length)return {state:'UNKNOWN',value:null,evidenceIds:[],reason:'No current scoped authoritative evidence'};
 const distinct=new Set(selected.map(f=>hash(f.value)));
 if(distinct.size>1)return {state:'CONFLICT',value:null,evidenceIds:selected.map(f=>f.id),reason:'Sources disagree; no model majority override'};
 return {state:'OBSERVED',value:selected[0].value,evidenceIds:selected.map(f=>f.id),expiresAt:Math.min(...selected.map(f=>f.expiresAt)),executable:false};
}
function affected(nodes,changed){
 const pending=new Set(changed),hits=new Set();let more=true;
 while(more){more=false;for(const node of nodes)if(!hits.has(node.id)&&(node.dependencies||[]).some(d=>pending.has(d))){hits.add(node.id);pending.add(node.id);more=true;}}
 return [...hits].sort();
}
module.exports={validate,resolve,affected};
