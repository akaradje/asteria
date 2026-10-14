'use strict';
const crypto=require('node:crypto');
// Static JSON only. Each record points back to its exact source location.
function compile(wiki,{maxFacts=10000,maxBytes=8000000}={}){
 const facts=[],domains={},unknowns=[];let bytes=0,truncated=false;
 const escape=x=>String(x).replace(/~/g,'~0').replace(/\//g,'~1');
 function emit(pointer,value,domain){
  const body=JSON.stringify({pointer,value});if(facts.length>=maxFacts||bytes+Buffer.byteLength(body)>maxBytes){truncated=true;return;}
  bytes+=Buffer.byteLength(body);facts.push({id:'wiki-entry:'+crypto.createHash('sha256').update(pointer).digest('hex'),domain:'wiki:'+domain,level:'PARSED',value:{pointer,value},evidence:['wiki']});domains[domain]=(domains[domain]||0)+1;
 }
 function walk(value,pointer,domain,depth){
  if(truncated)return;if(depth>16){truncated=true;return;}
  if(value===null||typeof value!=='object'){emit(pointer,value,domain);return;}
  const keys=Object.keys(value);if(keys.length===0){emit(pointer,value,domain);return;}
  const encoded=JSON.stringify(value);
  // Prefer an entire entity/rule record; split containers and oversized records.
  const scalarChildren=keys.some(k=>value[k]===null||typeof value[k]!=='object');
  if(depth>=3&&scalarChildren&&Buffer.byteLength(encoded)<=32000){emit(pointer,value,domain);return;}
  for(const k of keys)walk(value[k],pointer+'/'+escape(k),domain,depth+1);
 }
 for(const [domain,value]of Object.entries(wiki||{})){if(domain.startsWith('_'))continue;walk(value,'/'+escape(domain),domain,1);}
 if(truncated)unknowns.push({id:'wiki:fact-budget',domain:'wiki',reason:'Fact extraction bounded; coverage incomplete'});
 return {facts,domains,unknowns,complete:!truncated,bytes,scope:'parsed_wiki_records_not_native_verification'};
}
module.exports={compile};
