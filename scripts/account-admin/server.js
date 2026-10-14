'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..'),PUBLIC=path.join(__dirname,'public');
function createServer({root=ROOT,port=4714,source=require('./provider').provider(root),now=Date.now}={}){
 const sessions=new Map(),notesFile=path.join(root,'logs/account-admin/notes.json');let snapshot=null,flight=null;
 const headers={'Cache-Control':'no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
 function json(res,status,body){res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
 function notes(){try{const data=JSON.parse(fs.readFileSync(notesFile,'utf8'));return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch(e){if(e.code==='ENOENT')return {};throw Error('notes_unavailable');}}
 async function inventory(){if(snapshot&&now()-snapshot.receivedAt<30000)return snapshot.data;if(flight)return flight;flight=source.list().then(data=>{snapshot={receivedAt:now(),data};return data;}).finally(()=>flight=null);return flight;}
 async function body(req){let bytes=0,parts=[];for await(const part of req){bytes+=part.length;if(bytes>4096)throw Error('invalid_request');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
 const server=http.createServer(async(req,res)=>{
  const host='127.0.0.1:'+server.address().port,origin='http://'+host;
  if(!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)||req.headers.host!==host||['forwarded','x-forwarded-for','x-forwarded-host','via','tailscale-user-login'].some(h=>req.headers[h]))return json(res,403,{error:'local_only'});
  if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'origin_rejected'});
  let u;try{u=new URL(req.url,origin);}catch{return json(res,400,{error:'invalid_request'});}
  if(u.pathname==='/api/health'&&req.method==='GET')return json(res,200,{service:'asteria-account-admin',version:1,pid:process.pid,localOnly:true});
  const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if(assets[u.pathname]&&req.method==='GET'){
   if(u.pathname==='/'){
    for(const [key,s]of sessions)if(s.until<now())sessions.delete(key);
    if(sessions.size>100)return json(res,429,{error:'too_many_sessions'});
    const id=crypto.randomBytes(32).toString('hex');sessions.set(id,{until:now()+1800000,reveals:[]});
    res.setHeader('Set-Cookie',`asteria_accounts=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);
   }
   res.writeHead(200,{...headers,'Content-Type':u.pathname.endsWith('.js')?'text/javascript; charset=utf-8':u.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(PUBLIC,assets[u.pathname])));
  }
  const id=(req.headers.cookie||'').match(/(?:^|;\s*)asteria_accounts=([a-f0-9]{64})(?:;|$)/)?.[1],session=sessions.get(id);
  if(!session||session.until<now())return json(res,401,{error:'session_expired'});
  if(req.headers['x-accounts-request']!=='1')return json(res,403,{error:'request_header_required'});
  try{
   if(u.pathname==='/api/accounts'&&req.method==='GET'){
    const data=await inventory(),memo=notes();return json(res,200,{...data,rows:data.rows.map(r=>({...r,note:memo[r.id]?.note||'',group:memo[r.id]?.group||'normal',noteUpdatedAt:memo[r.id]?.at||null}))});
   }
   if(['/api/reveal','/api/notes'].includes(u.pathname)&&req.method==='POST'){
    if(req.headers.origin!==origin||!(req.headers['content-type']||'').startsWith('application/json'))return json(res,403,{error:'origin_and_json_required'});
    const value=await body(req),data=await inventory(),row=data.rows.find(r=>r.id===value.id);
    if(!row)return json(res,404,{error:'account_not_found'});
    if(u.pathname==='/api/reveal'){
     session.reveals=session.reveals.filter(at=>now()-at<60000);if(session.reveals.length>=20)return json(res,429,{error:'reveal_rate_limit'});session.reveals.push(now());
     const result=await source.reveal(row);return json(res,200,{username:typeof result.username==='string'?result.username:'',password:typeof result.password==='string'?result.password:null,kind:result.kind,clearAfterSeconds:30});
    }
    if(typeof value.note!=='string'||value.note.length>500||!['normal','priority','watch','hold'].includes(value.group))return json(res,400,{error:'invalid_note'});
    const memo=notes();memo[row.id]={note:value.note,group:value.group,at:new Date(now()).toISOString()};fs.mkdirSync(path.dirname(notesFile),{recursive:true});
    const tmp=notesFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(memo,null,2),{mode:0o600});fs.renameSync(tmp,notesFile);return json(res,200,{ok:true});
   }
   return json(res,404,{error:'not_found'});
  }catch(e){return json(res,503,{error:['account_changed','notes_unavailable','invalid_request'].includes(e.message)?e.message:'machine_unavailable'});}
 });
 return server;
}
if(require.main===module){const server=createServer();server.on('error',()=>{console.error('Account admin failed to bind its private port');process.exitCode=1;});server.listen(4714,'127.0.0.1',()=>console.log('Asteria account admin ready on local port 4714'));}
module.exports={createServer};
