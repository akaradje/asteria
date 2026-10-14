'use strict';
const crypto=require('node:crypto');
const loopback=h=>['127.0.0.1','localhost','::1'].includes(h);
function create({host,port,password,random=()=>crypto.randomBytes(32).toString('hex')}={}){
 if(!loopback(host)&&!password)throw Error('Network panel requires authentication');
 const hosts=new Set([host,...(loopback(host)?['127.0.0.1','localhost','::1']:[])].map(h=>(h.includes(':')?'['+h+']':h)+':'+port));
 const token=random();
 function origin(req){
  const h=req.headers.host;if(!hosts.has(h))return 'untrusted_host';
  if(req.headers['sec-fetch-site']==='cross-site')return 'cross_site_request';
  if(req.headers.origin&&req.headers.origin!=='http://'+h)return 'untrusted_origin';
  return null;
 }
 function mutation(req){
  const blocked=origin(req);if(blocked)return blocked;
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return 'json_content_type_required';
  const given=Buffer.from(String(req.headers['x-asteria-control']||'')),expected=Buffer.from(token);
  if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))return 'control_token_required';
  return null;
 }
 return {origin,mutation,token};
}
function publicTeam(members){return members.map(m=>({slot:m.slot,job:m.job||null,charName:m.charName||null,verifiedAt:m.verifiedAt||null}));}
module.exports={create,publicTeam};
