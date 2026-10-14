'use strict';
const http=require('node:http'),crypto=require('node:crypto');
function envelope(host,body,key,now=Date.now()){const value={version:1,host,at:now,nonce:crypto.randomUUID(),body};return {value,signature:crypto.sign(null,Buffer.from(JSON.stringify(value)),key).toString('base64')};}
function server(authority,{hosts,adminHost='windows',now=Date.now,onFeed,cooperation=()=>null}={}){
 const replay=new Map();return http.createServer(async(req,res)=>{const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(req.method==='GET'&&req.url==='/health')return reply(200,{service:'asteria-registry-authority',protocol:1,revision:authority.data.revision});
  if(req.method==='GET'&&req.url==='/fleet')return reply(200,require('./host-feed').publicFleet(authority.store.document('host-feeds')||{},now()));
  if(req.method!=='POST'||req.url!=='/rpc')return reply(404,{error:'unknown_route'});
  let stage='parse';try{let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>131072){reply(413,{error:'request_too_large'});req.destroy();return;}}
   const message=JSON.parse(text),v=message.value,h=hosts?.[v?.host];if(!h||v.version!==1||!Number.isFinite(v.at)||Math.abs(now()-v.at)>30000||typeof v.nonce!=='string'||v.nonce.length>80||typeof message.signature!=='string'||!crypto.verify(null,Buffer.from(JSON.stringify(v)),h.publicKey,Buffer.from(message.signature,'base64')))return reply(403,{error:'authority_auth_rejected'});
   const key=v.host+':'+v.nonce,hash=crypto.createHash('sha256').update(text).digest('hex'),old=replay.get(key);if(old){if(old.hash!==hash)return reply(409,{error:'nonce_conflict'});return reply(old.code,old.value);}
   const {method,args}=v.body||{};if(!['claim','status','owned','closed','prepare','drain','activate','complete','rollback','public','publish','admit','capacityLookup','capacityCancel','capacitySettled','enrollBegin','enrollVerified','enrollAssigned','enrollLoaded','enrollCancel','enrollStatus','enrollResume'].includes(method))throw Error('unknown_method');
   if(['prepare','drain','rollback','enrollBegin','enrollCancel'].includes(method)&&v.host!==adminHost)return reply(403,{error:'operator_scope_required'});
   if(method==='enrollBegin'&&(!hosts[args.host]||!hosts[args.host].names?.includes(args.name)))throw Error('Registered enrollment target required');
   if(['enrollVerified','enrollAssigned','enrollLoaded','enrollStatus','enrollResume'].includes(method)){const row=authority.enrollment().data.rows.find(r=>r.id===args.id);if(!row||row.host!==v.host)throw Error('Enrollment target signer required');}
   if(['claim','activate'].includes(method)){const claim=method==='activate'?args.claim:args;if(claim.host!==v.host)throw Error('host_mismatch');if(!h.names?.includes(claim.characterName))throw Error('unregistered_actor_assignment');}
   if(['status','owned','closed','admit','capacityLookup','capacityCancel','capacitySettled'].includes(method)&&args.host!==v.host)throw Error('host_mismatch');
   if(method==='admit'&&(!h.names?.includes(args.characterName)||!/^actor-[a-f0-9]{32}$/.test(args.actorId||'')||typeof args.session!=='string'||args.estimateMb<200||args.estimateMb>4000||args.floorMb<500))throw Error('Registered bounded admission required');
   if(method==='complete'&&authority.data.operations[args.id]?.targetHost!==v.host)throw Error('target_host_required');
   let output;if(method==='publish'){stage='feed_validation';const feed=require('./host-feed').validate(args,{host:v.host,names:h.names||[]},now()),feeds=authority.store.document('host-feeds')||{};if(feeds[v.host]?.at>feed.at)throw Error('Out of order feed');feeds[v.host]=feed;stage='feed_persistence';authority.store.putDocument('host-feeds',feeds);stage='feed_projection';onFeed?.(feed);stage='cooperation_projection';output={acceptedAt:now(),cooperation:cooperation(),projection:require('./host-feed').publicFleet(feeds,now())};}
   else output=method==='drain'||method==='rollback'?authority[method](args.id):method==='activate'?authority.activate(args.id,args.claim):method==='complete'?authority.complete(args.id,args.proof):method==='public'?authority.public():authority[method](args);
   const value={ok:true,result:output};replay.set(key,{hash,code:200,value});while(replay.size>256)replay.delete(replay.keys().next().value);reply(200,value);
  }catch{reply(409,{ok:false,error:'authority_precondition_failed',stage});}
 });
}
async function request(url,message){const target=new URL(url);if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/rpc'||target.username||target.password||target.search)throw Error('Private loopback registry endpoint required');const r=await fetch(target,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(10000)}),result=await r.json();if(!r.ok||result.ok!==true)throw Error(result.error||'authority_unavailable');return result.result;}
module.exports={envelope,server,request};
